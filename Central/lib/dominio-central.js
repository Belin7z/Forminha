/* ==========================================================
   DOMÍNIO DA FORMINHA — o endereço próprio da Central (ex.:
   forminha.com.br) e a base dos endereços das lojas
   (anadoces.forminha.com.br e anadoces-painel.forminha.com.br).
   • A Central fica na raiz; o "www." leva para a raiz.
   • Um registro coringa "*" no DNS manda todos os subdomínios para
     a Vercel: cada loja ganha o seu ao ser publicada (e as antigas,
     pelo botão em Configurações).
   Guardado em configuracoes 'dominio' = { raiz, adicionado_em,
   ativo_em (a Central já abre nele), coringa_em (o "*" já aponta) }.
   ========================================================== */
import { randomBytes } from "node:crypto";
import { ErroProvedor } from "./provedores.js";
import { ErroHttp } from "./erros.js";
import { CNAME_PADRAO, nomeNoDns, normalizarDominio, raizDoDominio, registroDoEndereco } from "./dominios.js";

// para onde um endereço da Vercel aponta: o CNAME dela ou um dos IPs dela
const CNAME_DA_VERCEL = /(^|\.)vercel-dns(-\d+)?\.com\.?$/i;
const IP_DA_VERCEL = /^(76\.76\.21|216\.198\.79|64\.29\.17|216\.150\.(1|16))\.\d{1,3}$/;

export function criarDominioCentral({ banco, preparar, vc, projeto, fetchFn = fetch }) {
  const semDominioNoSite = (erro) => { if (erro instanceof ErroProvedor && erro.status === 404) return null; throw erro; };
  const enderecos = (raiz) => [{ host: raiz, papel: "central" }, { host: `www.${raiz}`, papel: "atalho", redirecionar: raiz }];

  async function ler() {
    await preparar?.();
    const [l] = await banco.consultar("select valor from configuracoes where chave = 'dominio'");
    return l?.valor?.raiz ? l.valor : null;
  }
  async function gravar(valor) {
    if (!valor) return banco.consultar("delete from configuracoes where chave = 'dominio'");
    await banco.consultar("insert into configuracoes (chave, valor) values ('dominio', $1::jsonb) on conflict (chave) do update set valor = excluded.valor", [JSON.stringify(valor)]);
  }

  async function ligar(e) {
    try {
      await vc.adicionarDominio(projeto, { name: e.host, ...(e.redirecionar && { redirect: e.redirecionar, redirectStatusCode: 308 }) });
    } catch (erro) {
      if (!(erro instanceof ErroProvedor) || ![400, 409].includes(erro.status)) throw erro;
      if (await vc.dominioDoProjeto(projeto, e.host).catch(() => null)) return;
      if (erro.status === 409 || /already|in use|taken/i.test(erro.message)) {
        throw new ErroHttp(409, `O endereço ${e.host} já está ligado a outro site na Vercel. Tire de lá primeiro.`, { dominio: "Esse domínio já está em uso em outro site." });
      }
      throw new ErroHttp(422, "A Vercel não aceitou esse domínio. Confira se está escrito certo.", { dominio: "A Vercel não aceitou esse domínio." });
    }
  }
  const soltar = async (raiz) => { for (const e of enderecos(raiz).reverse()) await vc.removerDominio(projeto, e.host).catch(semDominioNoSite); };

  /** O coringa "*" já aponta para a Vercel? Pergunta a um DNS público por um nome inventado embaixo do domínio. */
  async function coringaAponta(raiz) {
    const nome = `teste-${randomBytes(4).toString("hex")}.${raiz}`;
    try {
      const r = await fetchFn(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(nome)}&type=A`, { headers: { accept: "application/dns-json" } });
      if (!r.ok) return false;
      const d = await r.json();
      return (d.Answer ?? []).some((a) => (a.type === 5 && CNAME_DA_VERCEL.test(a.data)) || (a.type === 1 && IP_DA_VERCEL.test(a.data)));
    } catch { return false; }
  }

  /**
   * A situação na Vercel e no DNS. Quando a raiz passa a funcionar, a Central passa a usar o endereço novo nos
   * links; quando o coringa aponta, as lojas podem ganhar o endereço delas. `conferir` pede de novo a verificação.
   */
  async function situacao({ conferir = false } = {}) {
    const cfg = await ler();
    if (!cfg) return { dominio: null, ativo: false, coringa: false, enderecos: [], mudou: false };
    const { raiz } = cfg;
    if (conferir) {
      for (const e of enderecos(raiz)) {
        const pd = await vc.dominioDoProjeto(projeto, e.host).catch(semDominioNoSite);
        if (!pd) await ligar(e); // alguém tirou pela Vercel: liga de novo
        else if (!pd.verified) await vc.verificarDominio(projeto, e.host).catch(() => null);
      }
    }
    const lista = await Promise.all(enderecos(raiz).map(async (e) => {
      const [pd, conf] = await Promise.all([
        vc.dominioDoProjeto(projeto, e.host).catch(semDominioNoSite),
        vc.configDoDominio(e.host, projeto).catch(() => null),
      ]);
      const verificado = Boolean(pd?.verified);
      const dnsOk = conf?.misconfigured === false;
      const registros = [{ ...registroDoEndereco(e.host, raiz, conf), ok: dnsOk }];
      if (pd && !verificado) {
        for (const v of pd.verification ?? []) registros.push({ tipo: String(v.type ?? "TXT").toUpperCase(), nome: nomeNoDns(v.domain, raiz), valor: v.value, ok: false });
      }
      return { host: e.host, site: e.papel, atalho: e.papel === "atalho", ligado: Boolean(pd), ok: Boolean(pd) && verificado && dnsOk, registros };
    }));
    const coringa = await coringaAponta(raiz);
    lista.push({ host: `*.${raiz}`, site: "lojas", atalho: false, ligado: true, ok: coringa, registros: [{ tipo: "CNAME", nome: "*", valor: CNAME_PADRAO, ok: coringa }] });

    const agora = new Date().toISOString();
    const novo = { ...cfg };
    if (lista[0].ok && !cfg.ativo_em) novo.ativo_em = agora;
    if (coringa && !cfg.coringa_em) novo.coringa_em = agora; // fica marcado: uma falha passageira do DNS não tira as lojas
    const mudou = novo.ativo_em !== cfg.ativo_em || novo.coringa_em !== cfg.coringa_em;
    if (mudou) await gravar(novo);
    const todos = lista.every((e) => e.ok);
    return {
      dominio: raiz, adicionado_em: novo.adicionado_em ?? null, ativo: Boolean(novo.ativo_em), coringa: Boolean(novo.coringa_em),
      situacao: todos ? "ok" : lista[0].ok ? "parcial" : "aguardando", url: novo.ativo_em ? `https://${raiz}` : null, enderecos: lista, mudou,
    };
  }

  /** Liga (ou troca) o domínio da Forminha na Central. */
  async function definir(dados) {
    const nome = normalizarDominio(dados?.dominio);
    if (raizDoDominio(nome) !== nome) {
      const msg = `Use o domínio principal, sem nada antes. Exemplo: ${raizDoDominio(nome)}`;
      throw new ErroHttp(422, msg, { dominio: msg });
    }
    const antigo = await ler();
    const mesmo = antigo?.raiz === nome;
    if (antigo && !mesmo) await soltar(antigo.raiz);
    for (const e of enderecos(nome)) await ligar(e);
    await gravar(mesmo ? antigo : { raiz: nome, adicionado_em: new Date().toISOString(), ativo_em: null, coringa_em: null });
    return { ...(await situacao()), mudou: true };
  }

  /** Tira o domínio da Central: ela volta para o endereço da Vercel (que nunca deixou de funcionar). */
  async function remover() {
    const cfg = await ler();
    if (cfg) { await soltar(cfg.raiz); await gravar(null); }
    return { dominio: null, ativo: false, coringa: false, enderecos: [], mudou: Boolean(cfg) };
  }

  return { ler, situacao, definir, remover };
}
