/* ==========================================================
   LOJAS — tudo o que a Central faz com a loja de uma cliente:
   criar o banco, preparar as tabelas, publicar os 2 sites, convite,
   reativar, excluir, manter ativa, o link de redefinir senha, ligar
   o pagamento online (PIX automático + cartão pelo Mercado Pago) e o
   domínio próprio (ex.: suadoceria.com.br).
   Usado pelo botão "Nova loja" e pela criação automática depois
   do pagamento (lib/clientes.js).
   SEGURANÇA: só mexe em projetos da organização FORMINHA_ORG com
   nome no padrão "<código> · <nome>" — nunca nos outros da conta.
   Dois tipos de loja: com projeto próprio no Supabase (ref de 20 letras)
   ou no BANCO ÚNICO (banco-unico.js; o "ref" dela é o código), onde os
   2 sites servem todas as lojas e cada uma ganha os seus endereços.
   ========================================================== */
import { randomBytes } from "node:crypto";
import { ErroProvedor } from "./provedores.js";
import { FUNCOES, montarFuncao, versaoDasFuncoes } from "./funcoes.js";
import { enderecosDoDominio, enderecosNaForminha, nomeNoDns, normalizarDominio, normalizarSubdominio, raizDoDominio, registroDoEndereco } from "./dominios.js";
import { PADRAO_CODIGO, gerarCodigo, lerNomeDoProjeto, nomeDoProjeto, senhaAleatoria, slug } from "./codigo.js";
import { aplicarProxima, gerarConvite, gravarFicha, noProjeto, semear, situacao } from "./banco.js";
import { prefixoDosPedidos } from "./banco-unico.js";
import { EMAIL, ErroHttp } from "./erros.js";

const REF = /^[a-z]{20}$/;
const SENHA_LETRAS_E_NUMEROS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789";

/** Em que ponto a loja está, a partir do estado do projeto no Supabase (null = olhar o banco). */
export function etapaDoStatus(status) {
  if (status === "ACTIVE_HEALTHY") return null;
  if (["INACTIVE", "PAUSING"].includes(status)) return "pausada";
  if (["RESTORING", "RESTARTING", "UPGRADING", "RESIZING"].includes(status)) return "reativando";
  if (["INIT_FAILED", "RESTORE_FAILED", "PAUSE_FAILED", "REMOVED", "GOING_DOWN"].includes(status)) return "problema";
  return "criando";
}

function resumoDoBanco(s) {
  // sem seed = ainda preparando; sem os 2 sites = falta publicar. Migração nova numa loja pronta = "atualizar".
  const etapa = !s.semeada ? "tabelas" : !s.ficha?.loja?.url || !s.ficha?.painel?.url ? "sites" : "pronta";
  return {
    etapa, feitas: s.feitas, total: s.total, atualizar: s.semeada && s.pendentes.length > 0,
    email: s.ficha?.email ?? null, loja: enderecoLoja(s.ficha), painel: enderecoPainel(s.ficha),
    dominio: s.ficha?.dominio?.nome ?? null, dominio_ativo: Boolean(s.ficha?.dominio?.ativo_em),
    subdominio: s.ficha?.sub ? `${s.ficha.sub.rotulo}.${s.ficha.sub.raiz}` : null,
    suspensa: Boolean(s.ficha?.assinatura?.suspensa),
  };
}

// ficha.sub = o endereço embaixo do domínio da Forminha: { rotulo, raiz, adicionado_em, ativo_em, painel_ativo_em }
const hostDoSub = (sub, site) => enderecosNaForminha(sub.rotulo, sub.raiz).find((e) => e.site === site).host;

/** Endereço da loja para as clientes: o domínio próprio quando já funciona; depois, o da Forminha; senão, o da Vercel. */
export function enderecoLoja(ficha) {
  if (ficha?.dominio?.ativo_em) return `https://${ficha.dominio.nome}`;
  if (ficha?.sub?.ativo_em) return `https://${hostDoSub(ficha.sub, "loja")}`;
  return ficha?.loja?.url ?? null;
}
/** Endereço do painel: "painel.<domínio>" quando a dona escolheu e já funciona; depois, o da Forminha. */
export function enderecoPainel(ficha) {
  if (ficha?.dominio?.painel && ficha.dominio.painel_ativo_em) return `https://painel.${ficha.dominio.nome}`;
  if (ficha?.sub?.painel_ativo_em) return `https://${hostDoSub(ficha.sub, "painel")}`;
  return ficha?.painel?.url ?? null;
}

/** Os endereços de uma loja (sites, domínio próprio e o da Forminha): só eles podem chamar as funções dela pelo navegador. */
export function origensDaLoja(ficha) {
  const doDominio = ficha?.dominio?.nome ? enderecosDoDominio(ficha.dominio.nome, ficha.dominio).map((e) => `https://${e.host}`) : [];
  const daForminha = ficha?.sub ? enderecosNaForminha(ficha.sub.rotulo, ficha.sub.raiz).map((e) => `https://${e.host}`) : [];
  const lista = [ficha?.loja?.url, ficha?.painel?.url, ...doDominio, ...daForminha];
  return [...new Set(lista.filter(Boolean).map((u) => String(u).replace(/\/+$/, "")))];
}

/** Para onde os links dos e-mails de login podem voltar. */
const listaDeRetorno = (ficha) => origensDaLoja(ficha).map((o) => `${o}/**`).join(",");

/**
 * `urlCentral`: o endereço da Central (texto ou função, porque muda quando ela ganha domínio próprio).
 * `baseDasLojas`: função que devolve o domínio da Forminha ({ raiz, pronta }) ou null — com ele pronto, cada loja
 * ganha anadoces.<raiz> e anadoces-painel.<raiz>.
 */
export function criarLojas({ sb, vc, org, repoLoja, repoPainel, pastaLoja, pastaPainel, urlCentral = "", baseDasLojas = null, unico = null, fetchFn = fetch }) {
  const centralAgora = typeof urlCentral === "function" ? urlCentral : () => urlCentral;
  const doUnico = (loja) => loja?.tipo === "unico";
  /** Onde rodar o SQL da loja: o projeto dela, ou DENTRO dela no banco único (banco-unico.js). */
  const bd = (loja) => (doUnico(loja) ? { sql: unico.naLoja(loja.id), sqlBanco: unico.sqlBanco } : noProjeto(sb, loja.ref));
  /** O projeto do Supabase onde a loja mora (o dela, ou o banco único). */
  const refDoBanco = async (loja) => (doUnico(loja) ? (await unico.ler()).ref : loja.ref);
  const statusDoUnico = async () => (await sb.projeto((await unico.ler()).ref)).status;
  const base = async () => (baseDasLojas ? baseDasLojas().catch(() => null) : null);
  // o domínio da própria Central (e o que vier embaixo dele) não pode virar domínio de loja
  async function reservados() {
    let host = "";
    try { host = centralAgora() ? new URL(centralAgora()).hostname : ""; } catch { /* sem Central configurada */ }
    const lista = host && !/^(localhost|127\.0\.0\.1)$/.test(host) ? [raizDoDominio(host)] : [];
    const b = await base();
    return b?.raiz ? [...lista, b.raiz] : lista;
  }

  /** Loja do banco único pelo código (é o "ref" dela na Central). */
  async function doBancoUnico(codigo) {
    if (!unico || !(await unico.pronto())) return null;
    const [l] = await unico.sqlBanco("select id, codigo, nome, criada_em from public.lojas where codigo = $1", [codigo]);
    return l ? { tipo: "unico", ref: l.codigo, id: l.id, codigo: l.codigo, nome: l.nome, criada_em: l.criada_em, status: await statusDoUnico() } : null;
  }

  /** Busca a loja: projeto próprio (ref de 20 letras) ou banco único (o código). Confere que é MESMO uma loja da Forminha. */
  async function porRef(ref) {
    // o banco único inteiro (aparece na lista quando está pausado: dá para reativar por lá)
    if (ref === "banco-unico" && unico && (await unico.pronto())) {
      return { tipo: "unico", ref, codigo: "—", nome: "Banco único das lojas", status: await statusDoUnico() };
    }
    if (PADRAO_CODIGO.test(String(ref))) {
      const l = await doBancoUnico(String(ref));
      if (!l) throw new ErroHttp(404, "Loja não encontrada.");
      return l;
    }
    if (!REF.test(String(ref))) throw new ErroHttp(404, "Loja não encontrada.");
    let p;
    try { p = await sb.projeto(ref); } catch (e) { if (e.status === 404) throw new ErroHttp(404, "Loja não encontrada."); throw e; }
    const id = lerNomeDoProjeto(p?.name);
    if (!id || (p.organization_slug !== org && p.organization_id !== org)) throw new ErroHttp(404, "Loja não encontrada.");
    return { ref: p.ref ?? p.id, status: p.status, ...id };
  }

  async function estado(loja) {
    const base = { ref: loja.ref, codigo: loja.codigo, nome: loja.nome, status: loja.status, ...(doUnico(loja) && { banco_unico: true }) };
    const etapa = etapaDoStatus(loja.status);
    if (etapa) return { ...base, etapa };
    return { ...base, ...resumoDoBanco(await situacao(bd(loja))) };
  }

  /** As lojas do banco único de uma vez só (uma consulta, não uma por loja). */
  async function listarDoBancoUnico() {
    if (!unico || !(await unico.pronto())) return [];
    const status = await statusDoUnico().catch(() => "UNKNOWN");
    const etapa = etapaDoStatus(status);
    if (etapa) {
      return [{ ref: "banco-unico", codigo: "—", nome: "Banco único das lojas", status, banco_unico: true, etapa, criada_em: "" }];
    }
    const linhas = await unico.sqlBanco(`select l.id, l.codigo, l.nome, l.criada_em,
        (select c.valor from public.configuracoes c where c.loja_id = l.id and c.chave = 'forminha') as ficha,
        exists (select 1 from public.configuracoes c where c.loja_id = l.id and c.chave = 'loja') as semeada
      from public.lojas l`);
    const s = await situacao({ sql: unico.sqlBanco, sqlBanco: unico.sqlBanco });
    return linhas.map((l) => {
      const ficha = typeof l.ficha === "string" ? JSON.parse(l.ficha) : l.ficha;
      return { ref: l.codigo, codigo: l.codigo, nome: l.nome, status, banco_unico: true, criada_em: new Date(l.criada_em).toISOString(),
        ...resumoDoBanco({ semeada: l.semeada, ficha, feitas: s.feitas, total: s.total, pendentes: s.pendentes }) };
    });
  }

  async function listar() {
    const projetos = await sb.projetosDaOrg(org);
    const lista = await Promise.all(projetos.map(async (p) => {
      const id = lerNomeDoProjeto(p.name);
      if (!id) return null;
      const loja = { ref: p.ref ?? p.id, status: p.status, ...id };
      try { return { ...(await estado(loja)), criada_em: p.inserted_at ?? p.created_at ?? null }; }
      catch { return { ref: loja.ref, codigo: loja.codigo, nome: loja.nome, status: loja.status, etapa: "problema" }; }
    }));
    const doBanco = await listarDoBancoUnico().catch((e) => { console.error("[banco único]", e.message); return []; });
    return [...lista.filter(Boolean), ...doBanco].sort((a, b) => String(b.criada_em).localeCompare(String(a.criada_em)));
  }

  /**
   * Loja nova. Com o banco único pronto: uma linha nele (fica pronta em segundos). Senão: o projeto
   * "<código> · <nome>" no Supabase. O código pode vir pronto (a criação automática o guarda antes, para nunca duplicar).
   */
  async function criar(nome, codigo = gerarCodigo()) {
    if (unico && (await unico.pronto())) {
      const [l] = await unico.sqlBanco(`insert into public.lojas (codigo, nome, prefixo_pedido) values ($1, $2, $3)
        on conflict (codigo) do update set nome = excluded.nome returning id`, [codigo, nome, prefixoDosPedidos(nome)]);
      return { tipo: "unico", ref: codigo, id: l.id, codigo, nome, status: "ACTIVE_HEALTHY" };
    }
    const p = await sb.criarProjeto({ nome: nomeDoProjeto(codigo, nome), org, senhaBanco: senhaAleatoria() });
    return { ref: p.ref ?? p.id, codigo, nome };
  }

  /** Acha a loja pelo código (para retomar uma criação que caiu no meio). */
  async function porCodigo(codigo) {
    const u = await doBancoUnico(codigo).catch(() => null);
    if (u) return u;
    const p = (await sb.projetosDaOrg(org)).find((x) => lerNomeDoProjeto(x.name)?.codigo === codigo);
    return p ? { ref: p.ref ?? p.id, status: p.status, ...lerNomeDoProjeto(p.name) } : null;
  }

  /** A loja do banco único dona deste endereço (da loja ou do painel) ou deste código. */
  async function porEndereco(texto) {
    if (!unico || !(await unico.pronto())) return null;
    const t = String(texto ?? "").trim().split(":")[0];
    if (!t) return null;
    const [l] = await unico.sqlBanco(`select l.codigo from public.lojas l where l.codigo = $1
      union select l.codigo from public.loja_enderecos e join public.lojas l on l.id = e.loja_id where e.host = lower($1)`, [t]);
    return l ? doBancoUnico(l.codigo) : null;
  }

  /** Uma migração por chamada; quando acabam, o seed. Serve também para ATUALIZAR lojas antigas. */
  async function prepararPasso(loja, emailDona) {
    if (loja.status !== "ACTIVE_HEALTHY") throw new ErroHttp(409, "O banco desta loja ainda não está pronto. Aguarde um instante.");
    const r = await aplicarProxima(bd(loja));
    if (r.aplicada) return { etapa: "tabelas", feitas: r.feitas, total: r.total, aplicada: r.aplicada.nome };
    const s = await situacao(bd(loja));
    if (!s.semeada) {
      const email = String(emailDona ?? s.ficha?.email ?? "").trim().toLowerCase();
      if (!EMAIL.test(email)) throw new ErroHttp(422, "Informe o e-mail da dona da loja.", { email: "Informe o e-mail da dona da loja." });
      await semear(bd(loja), { nome: loja.nome, codigo: loja.codigo, email });
    }
    return estado(loja);
  }

  /* ---------- sites na Vercel ---------- */
  async function criarSite({ nomeBase, alternativo, repo, pasta, variaveis }) {
    for (const nome of [nomeBase, alternativo]) {
      try { const p = await vc.criarProjeto({ nome, repo, pasta, variaveis }); return { id: p.id, nome: p.name ?? nome }; }
      catch (e) { if (!(e instanceof ErroProvedor && e.status === 409) || nome === alternativo) throw e; }
    }
  }
  async function enderecoDoSite(site) {
    const lista = await vc.enderecos(site.id).catch(() => []);
    const vercelApp = lista.filter((d) => d.endsWith(".vercel.app")).sort((a, b) => a.length - b.length)[0];
    return `https://${vercelApp ?? `${site.nome}.vercel.app`}`;
  }

  /**
   * Banco único: a loja não ganha sites próprios — ganha os SEUS endereços nos dois sites de todas as lojas
   * (nome.vercel.app e nome-painel.vercel.app; o painel acha a loja trocando "-painel." por ".").
   */
  async function publicarNoBancoUnico(loja, ficha) {
    const c = await unico.pronto();
    if (!c) throw new ErroHttp(409, "O banco único não está pronto.");
    if (!ficha.loja?.url || !ficha.painel?.url) {
      const nomeBase = slug(loja.nome);
      let feito = false;
      for (const rotulo of [nomeBase, `${nomeBase}-${loja.codigo.toLowerCase().replace(/[^a-z0-9]/g, "")}`]) {
        const eLoja = { host: `${rotulo}.vercel.app`, site: "loja" }, ePainel = { host: `${rotulo}-painel.vercel.app`, site: "painel" };
        try { await ligarEndereco(c.loja, eLoja, loja); }
        catch (e) { if (e instanceof ErroHttp && rotulo === nomeBase) continue; throw e; }
        try { await ligarEndereco(c.painel, ePainel, loja); }
        catch (e) {
          await vc.removerDominio(c.loja.id, eLoja.host).catch(() => null);
          if (e instanceof ErroHttp && rotulo === nomeBase) continue;
          throw e;
        }
        ficha.loja = { id: c.loja.id, nome: c.loja.nome, url: `https://${eLoja.host}` };
        ficha.painel = { id: c.painel.id, nome: c.painel.nome, url: `https://${ePainel.host}` };
        await gravarFicha(bd(loja), { loja: ficha.loja, painel: ficha.painel });
        feito = true;
        break;
      }
      if (!feito) throw new ErroHttp(409, "Não achei um endereço livre para esta loja na Vercel. Tente de novo com outro nome de loja.");
    }
    await aplicarEnderecos(loja, ficha, { publicarPainel: false }); // o banco passa a reconhecer os endereços; o login aceita voltar para eles
    return ficha;
  }

  /** Cria e publica a loja e o painel (não duplica se chamado de novo) e ajusta o login das clientes. */
  async function publicar(loja) {
    if (loja.status !== "ACTIVE_HEALTHY") throw new ErroHttp(409, "O banco desta loja não está ativo.");
    const s = await situacao(bd(loja));
    if (s.pendentes.length || !s.semeada) throw new ErroHttp(409, "O banco da loja ainda não foi preparado.");
    const ficha = s.ficha ?? {};
    if (doUnico(loja)) {
      await publicarNoBancoUnico(loja, ficha);
      return automatizarSub(loja, ficha);
    }
    const supabaseUrl = `https://${loja.ref}.supabase.co`;
    const chave = await sb.chavePublica(loja.ref);
    const nomeBase = slug(loja.nome);
    const sufixo = loja.codigo.toLowerCase();
    if (!ficha.loja?.id) {
      const site = await criarSite({ nomeBase, alternativo: `${nomeBase}-${sufixo}`, repo: repoLoja, pasta: pastaLoja, variaveis: { SUPABASE_URL: supabaseUrl, SUPABASE_ANON_KEY: chave } });
      await vc.publicar({ projetoId: site.id, nome: site.nome, repo: repoLoja });
      ficha.loja = { ...site, url: await enderecoDoSite(site) };
      await gravarFicha(bd(loja), { loja: ficha.loja });
    }
    if (!ficha.painel?.id) {
      const site = await criarSite({ nomeBase: `${nomeBase}-painel`, alternativo: `${nomeBase}-${sufixo}-painel`, repo: repoPainel, pasta: pastaPainel,
        variaveis: { SUPABASE_URL: supabaseUrl, SUPABASE_ANON_KEY: chave, URL_LOJA: ficha.loja.url, ...(centralAgora() && { URL_CENTRAL: centralAgora() }) } });
      await vc.publicar({ projetoId: site.id, nome: site.nome, repo: repoPainel });
      ficha.painel = { ...site, url: await enderecoDoSite(site) };
      await gravarFicha(bd(loja), { painel: ficha.painel });
    }
    // login das clientes: links de e-mail voltam para a loja/painel; sem SMTP próprio no projeto, a conta já nasce confirmada
    await sb.configurarLogin(loja.ref, {
      site_url: enderecoLoja(ficha), uri_allow_list: listaDeRetorno(ficha),
      external_email_enabled: true, mailer_autoconfirm: true, password_min_length: 8, password_required_characters: SENHA_LETRAS_E_NUMEROS,
    });
    return automatizarSub(loja, ficha);
  }

  /** Com o domínio da Forminha pronto, a loja já ganha anadoces.<domínio> (se der errado, fica no da Vercel e dá para ligar depois). */
  async function automatizarSub(loja, ficha) {
    let final = ficha;
    const b = await base();
    if (b?.pronta && !ficha.sub) {
      try { final = (await ligarSub(loja, ficha, { raiz: b.raiz, rotulo: rotuloSugerido(ficha) })).ficha; }
      catch (e) { console.error("[endereço na Forminha]", e.message); }
    }
    return { etapa: "pronta", loja: enderecoLoja(final), painel: enderecoPainel(final) };
  }

  async function convite(loja, emailDona) {
    if (loja.status !== "ACTIVE_HEALTHY") throw new ErroHttp(409, "A loja está pausada. Reative antes de gerar um convite.");
    const s = await situacao(bd(loja));
    if (!s.ficha?.painel?.url) throw new ErroHttp(409, "A loja ainda não foi publicada.");
    const email = String(emailDona ?? s.ficha.email ?? "").trim().toLowerCase();
    if (!EMAIL.test(email)) throw new ErroHttp(422, "Informe o e-mail da dona da loja.", { email: "Informe o e-mail da dona da loja." });
    const codigo = await gerarConvite(bd(loja), email);
    return { link: `${enderecoPainel(s.ficha)}/#/convite/${codigo}`, email, loja: loja.nome, vale_dias: 7 };
  }

  /** Suporte: link para a dona criar uma senha nova (vale pouco tempo). A chave administrativa da loja é lida
      na hora, fica só na memória desta requisição e nunca vai para a tela nem para os registros. */
  async function linkRedefinirSenha(loja, emailDona) {
    if (loja.status !== "ACTIVE_HEALTHY") throw new ErroHttp(409, "A loja está pausada. Reative antes.");
    const s = await situacao(bd(loja));
    const destino = enderecoLoja(s.ficha);
    if (!destino) throw new ErroHttp(409, "A loja ainda não foi publicada.");
    const ref = await refDoBanco(loja);
    const segredo = await sb.chaveSecreta(ref);
    const cabecalhos = { apikey: segredo, "Content-Type": "application/json", ...(segredo.startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${segredo}` }) };
    let r;
    try {
      r = await fetchFn(`https://${ref}.supabase.co/auth/v1/admin/generate_link`, {
        method: "POST", headers: cabecalhos, body: JSON.stringify({ type: "recovery", email: emailDona, redirect_to: destino }),
      });
    } catch (e) { throw new ErroProvedor("Supabase", 0, `sem conexão (${e.message})`); }
    const d = await r.json().catch(() => ({}));
    if (r.status === 404 || /not found/i.test(d.msg ?? d.message ?? "")) throw new ErroHttp(409, "A dona ainda não criou o acesso dela. Envie o convite em vez de redefinir a senha.");
    if (!r.ok) throw new ErroProvedor("Supabase", r.status, d.msg ?? d.message ?? d.error_description ?? "não gerou o link");
    const link = d.action_link ?? d.properties?.action_link;
    if (!link) throw new ErroProvedor("Supabase", 0, "o link de redefinição não veio na resposta");
    return link;
  }

  async function reativar(loja) {
    if (!["INACTIVE", "PAUSING"].includes(loja.status)) throw new ErroHttp(409, "Esta loja não está pausada.");
    await sb.reativar(await refDoBanco(loja)); // no banco único, reativa o banco de todas as lojas
  }

  /**
   * Banco único: tira os endereços da loja dos sites de todas as lojas, apaga as fotos dela e a linha da loja
   * (que leva junto todos os dados, pelas ligações do banco). Logins que não são de mais nenhuma loja saem também.
   */
  async function excluirDoBancoUnico(loja) {
    const c = await unico.pronto();
    const enderecos = await unico.sqlBanco("select host from public.loja_enderecos where loja_id = $1", [loja.id]);
    for (const { host } of enderecos) {
      for (const site of [c.loja, c.painel]) await vc.removerDominio(site.id, host).catch(semDominioNoSite);
    }
    await apagarFotosDoBancoUnico(c.ref, loja.id).catch((e) => console.error("[fotos]", e.message));
    await unico.sqlBanco("delete from public.lojas where id = $1", [loja.id]);
    await unico.sqlBanco("delete from auth.users u where not exists (select 1 from public.perfis p where p.id = u.id)");
    await atualizarLoginDoBancoUnico();
    return { sites_apagados: [], enderecos_soltos: enderecos.map((e) => e.host) };
  }

  /** As fotos da loja ficam na pasta dela ("<id>/…") nos baldes "produtos" e "site". */
  async function apagarFotosDoBancoUnico(ref, id) {
    const segredo = await sb.chaveSecreta(ref);
    const cab = { apikey: segredo, "Content-Type": "application/json", ...(segredo.startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${segredo}` }) };
    for (const balde of ["produtos", "site"]) {
      const r = await fetchFn(`https://${ref}.supabase.co/storage/v1/object/list/${balde}`, { method: "POST", headers: cab, body: JSON.stringify({ prefix: `${id}/`, limit: 1000 }) });
      if (!r.ok) continue;
      const nomes = (await r.json().catch(() => [])).map((o) => `${id}/${o.name}`).filter((n) => !n.endsWith("/"));
      if (nomes.length) await fetchFn(`https://${ref}.supabase.co/storage/v1/object/${balde}`, { method: "DELETE", headers: cab, body: JSON.stringify({ prefixes: nomes }) });
    }
  }

  /** Apaga os 2 sites e o banco inteiro (dados, logins e fotos). Exige o código exato. */
  async function excluir(loja, codigoDigitado) {
    if (String(codigoDigitado ?? "").trim() !== loja.codigo) throw new ErroHttp(422, "Digite o código da loja exatamente como aparece para confirmar.", { codigo: "O código não confere." });
    if (doUnico(loja)) {
      if (!loja.id) throw new ErroHttp(409, "Escolha uma loja.");
      if (loja.status !== "ACTIVE_HEALTHY") throw new ErroHttp(409, "O banco único está pausado: reative primeiro (1–2 min).");
      return excluirDoBancoUnico(loja);
    }
    let ficha = null;
    if (loja.status === "ACTIVE_HEALTHY") ficha = (await situacao(bd(loja)).catch(() => null))?.ficha ?? null;
    else if (loja.status === "INACTIVE") throw new ErroHttp(409, "A loja está pausada: reative primeiro (1–2 min) para os sites dela também serem apagados.");
    for (const site of [ficha?.loja, ficha?.painel]) {
      if (site?.id) await vc.excluirProjeto(site.id).catch((e) => { if (e.status !== 404) throw e; });
    }
    await sb.excluirProjeto(loja.ref);
    return { sites_apagados: [ficha?.loja?.nome, ficha?.painel?.nome].filter(Boolean) };
  }

  /** Uma chamada leve para o Supabase grátis não pausar a loja; pausada -> reativa. */
  async function manterAtivas() {
    const resultado = { cutucadas: 0, reativadas: 0, falhas: 0 };
    for (const p of await sb.projetosDaOrg(org)) {
      if (!lerNomeDoProjeto(p.name)) continue;
      const ref = p.ref ?? p.id;
      try {
        if (p.status === "INACTIVE") { await sb.reativar(ref); resultado.reativadas += 1; continue; }
        if (p.status !== "ACTIVE_HEALTHY") continue;
        const chave = await sb.chavePublica(ref);
        const r = await fetchFn(`https://${ref}.supabase.co/rest/v1/rpc/loja_config`, { method: "POST", headers: { apikey: chave, Authorization: `Bearer ${chave}`, "Content-Type": "application/json" }, body: "{}" });
        if (r.ok) resultado.cutucadas += 1; else resultado.falhas += 1;
      } catch { resultado.falhas += 1; }
    }
    // o banco único: uma chamada só vale por todas as lojas dele
    const c = unico ? await unico.pronto().catch(() => null) : null;
    if (c) {
      try {
        const p = await sb.projeto(c.ref);
        if (p.status === "INACTIVE") { await sb.reativar(c.ref); resultado.reativadas += 1; }
        else if (p.status === "ACTIVE_HEALTHY") {
          const [l] = await unico.sqlBanco("select codigo from public.lojas order by criada_em limit 1");
          const chave = await sb.chavePublica(c.ref);
          const r = await fetchFn(`https://${c.ref}.supabase.co/rest/v1/rpc/loja_config`, {
            method: "POST", headers: { apikey: chave, Authorization: `Bearer ${chave}`, "Content-Type": "application/json", ...(l && { "x-loja": l.codigo }) }, body: "{}",
          });
          if (r.ok || !l) resultado.cutucadas += 1; else resultado.falhas += 1;
        }
      } catch { resultado.falhas += 1; }
    }
    return resultado;
  }


  /* ---------- pagamento online (Mercado Pago da dona) ---------- */

  /** A chave é do Mercado Pago mesmo? Devolve o apelido da conta (para mostrar "conectado a …"). */
  async function contaMercadoPago(token) {
    let r;
    try { r = await fetchFn("https://api.mercadopago.com/users/me", { headers: { Authorization: `Bearer ${token}` } }); }
    catch (e) { throw new ErroProvedor("Mercado Pago", 0, `sem conexão (${e.message})`); }
    if (r.status === 401 || r.status === 403) {
      throw new ErroHttp(422, "O Mercado Pago não aceitou essa chave. Copie o Access Token de produção inteiro.", { token: "O Mercado Pago não aceitou essa chave." });
    }
    if (!r.ok) throw new ErroProvedor("Mercado Pago", r.status, "não consegui conferir a chave agora");
    const d = await r.json().catch(() => ({}));
    return String(d.nickname || d.email || d.id || "").slice(0, 120);
  }

  /**
   * Liga o pagamento online da loja: confere a chave no Mercado Pago, deixa o banco em dia, instala as
   * funções, guarda a chave como segredo (só as funções leem) e liga PIX automático e cartão.
   * A chave nunca é gravada na Central nem devolvida.
   */
  async function conectarPagamento(loja, tokenMp) {
    const token = String(tokenMp ?? "").trim();
    if (!/^(APP_USR|TEST)-[\w-]{20,}$/.test(token)) {
      throw new ErroHttp(422, "Cole o Access Token do Mercado Pago (começa com APP_USR-).", { token: "Cole o Access Token (começa com APP_USR-)." });
    }
    if (loja.status !== "ACTIVE_HEALTHY") throw new ErroHttp(409, "A loja está pausada. Reative antes de ligar o pagamento online.");
    if (doUnico(loja)) return conectarPagamentoNoBancoUnico(loja, token);
    let s = await situacao(bd(loja));
    if (!s.ficha?.loja?.url) throw new ErroHttp(409, "Publique a loja antes de ligar o pagamento online.");
    const conta = await contaMercadoPago(token);
    for (let i = 0; i < s.pendentes.length; i++) await aplicarProxima(bd(loja)); // o banco precisa das regras de pagamento mais novas
    await atualizarFuncoes(loja);
    const segredo = randomBytes(24).toString("hex");
    s = await situacao(bd(loja));
    await sb.definirSegredos(loja.ref, { MP_ACCESS_TOKEN: token, SEGREDO_GATEWAY: segredo, ORIGENS_PERMITIDAS: origensDaLoja(s.ficha).join(",") });
    await sb.sql(loja.ref, "select public.central_conectar_gateway($1::jsonb)", [JSON.stringify({ segredo, conta, cartao: true })]);
    await gravarFicha(bd(loja), { pagamento_conectado_em: new Date().toISOString() });
    return { conectado: true, conta, pix: true, cartao: true };
  }

  /** Instala (ou atualiza) as funções do servidor na loja e anota a versão. */
  async function atualizarFuncoes(loja) {
    if (doUnico(loja)) throw new ErroHttp(409, "No banco único, as funções são de todas as lojas: atualize em Configurações → Banco único.");
    for (const nome of FUNCOES) await sb.implantarFuncao(loja.ref, nome, montarFuncao(nome));
    await gravarFicha(bd(loja), { funcoes_versao: versaoDasFuncoes() });
  }

  /** Quem chama pelo painel da loja é administradora dela? (o próprio banco da loja responde, com o login da pessoa) */
  async function conferirDona(loja, jwt) {
    const ref = await refDoBanco(loja);
    const chave = await sb.chavePublica(ref);
    let r;
    try {
      r = await fetchFn(`https://${ref}.supabase.co/rest/v1/rpc/admin_gateway`, {
        method: "POST", headers: { apikey: chave, Authorization: `Bearer ${jwt}`, "Content-Type": "application/json", ...(doUnico(loja) && { "x-loja": loja.codigo }) },
        body: JSON.stringify({ p: {} }),
      });
    } catch (e) { throw new ErroProvedor("Supabase", 0, `sem conexão (${e.message})`); }
    if (!r.ok) throw new ErroHttp(403, "Só a administradora da loja pode fazer isso. Entre de novo no painel.");
  }

  /* ---------- domínio próprio (ex.: suadoceria.com.br) ---------- */
  // ficha.dominio = { nome, painel (usar "painel.<domínio>"), adicionado_em, ativo_em, painel_ativo_em }

  const siteDoEndereco = (ficha, e) => (e.site === "painel" ? ficha.painel : ficha.loja);
  const semDominioNoSite = (erro) => { if (erro instanceof ErroProvedor && erro.status === 404) return null; throw erro; };

  async function fichaPublicada(loja) {
    if (loja.status !== "ACTIVE_HEALTHY") throw new ErroHttp(409, "A loja está pausada. Reative antes de mexer no domínio.");
    const s = await situacao(bd(loja));
    if (!s.ficha?.loja?.id || !s.ficha?.painel?.id) throw new ErroHttp(409, "Publique a loja antes de ligar um domínio próprio.");
    return s.ficha;
  }

  /**
   * Liga um endereço a um dos sites (se já estiver ligado nele, tudo certo). No banco único o site é de todas as
   * lojas: o endereço só serve se não for de OUTRA loja (senão uma loja tomaria o endereço da outra).
   */
  async function ligarEndereco(site, e, loja = null) {
    if (doUnico(loja)) {
      const [dono] = await unico.sqlBanco("select loja_id from public.loja_enderecos where host = $1", [e.host]);
      if (dono && dono.loja_id !== loja.id) {
        throw new ErroHttp(409, `O endereço ${e.host} já é de outra loja.`, { dominio: "Esse endereço já é de outra loja." });
      }
    }
    try {
      await vc.adicionarDominio(site.id, { name: e.host, ...(e.redirecionar && { redirect: e.redirecionar, redirectStatusCode: 308 }) });
    } catch (erro) {
      if (!(erro instanceof ErroProvedor) || ![400, 409].includes(erro.status)) throw erro;
      if (await vc.dominioDoProjeto(site.id, e.host).catch(() => null)) return;
      if (erro.status === 409 || /already|in use|taken/i.test(erro.message)) {
        throw new ErroHttp(409, `O endereço ${e.host} já está ligado a outro site na Vercel. Tire de lá primeiro.`, { dominio: "Esse domínio já está em uso em outro site." });
      }
      throw new ErroHttp(422, "A Vercel não aceitou esse domínio. Confira se está escrito certo.", { dominio: "A Vercel não aceitou esse domínio." });
    }
  }

  /** Tira os endereços dos sites (do último para o primeiro: o "www" aponta para o principal). */
  async function soltarEnderecos(ficha, lista) {
    for (const e of [...lista].reverse()) await vc.removerDominio(siteDoEndereco(ficha, e).id, e.host).catch(semDominioNoSite);
  }

  /** Cada endereço do domínio na Vercel: ligado? verificado? DNS certo? E os registros que a dona precisa criar. */
  async function lerEnderecos(ficha) {
    const d = ficha.dominio;
    const raiz = raizDoDominio(d.nome);
    return Promise.all(enderecosDoDominio(d.nome, d).map(async (e) => {
      const site = siteDoEndereco(ficha, e);
      const [pd, cfg] = await Promise.all([
        vc.dominioDoProjeto(site.id, e.host).catch(semDominioNoSite),
        vc.configDoDominio(e.host, site.id).catch(() => null),
      ]);
      const verificado = Boolean(pd?.verified);
      const dnsOk = cfg?.misconfigured === false;
      const registros = [{ ...registroDoEndereco(e.host, raiz, cfg), ok: dnsOk }];
      // domínio que já passou por outra conta da Vercel: ela pede um TXT para provar que é seu
      if (pd && !verificado) {
        for (const v of pd.verification ?? []) registros.push({ tipo: String(v.type ?? "TXT").toUpperCase(), nome: nomeNoDns(v.domain, raiz), valor: v.value, ok: false });
      }
      return { host: e.host, site: e.site, atalho: Boolean(e.redirecionar), ligado: Boolean(pd), ok: Boolean(pd) && verificado && dnsOk, registros };
    }));
  }

  function resumoDoDominio(ficha, enderecos = null) {
    const d = ficha.dominio;
    const base = { endereco_loja: enderecoLoja(ficha), endereco_painel: enderecoPainel(ficha) };
    if (!d?.nome) return { dominio: null, ...base };
    const principal = enderecos?.[0]?.ok ?? Boolean(d.ativo_em);
    const todos = enderecos ? enderecos.every((e) => e.ok) : false;
    return {
      dominio: d.nome, painel: Boolean(d.painel), raiz: raizDoDominio(d.nome), adicionado_em: d.adicionado_em ?? null,
      ativo: Boolean(d.ativo_em), situacao: todos ? "ok" : principal ? "parcial" : "aguardando",
      enderecos: enderecos ?? [], ...base,
    };
  }

  /**
   * Os lugares que precisam saber o endereço da loja: o login (links dos e-mails e para onde podem voltar),
   * as funções (volta do checkout do cartão, links do WhatsApp) e o painel (link "ver loja").
   */
  async function aplicarEnderecos(loja, ficha, { publicarPainel }) {
    if (doUnico(loja)) {
      // banco único: o banco passa a reconhecer os endereços da loja (x-loja) e o login aceita voltar para eles;
      // o painel acha o endereço da loja sozinho (config.js) e as funções leem os endereços no banco
      const hosts = [...new Set(origensDaLoja(ficha).map((o) => new URL(o).host))];
      await unico.sqlBanco(`with fora as (delete from public.loja_enderecos where loja_id = $1 and host <> all (select jsonb_array_elements_text($2::jsonb)) returning 1)
        insert into public.loja_enderecos (host, loja_id) select h, $1::uuid from jsonb_array_elements_text($2::jsonb) h
        on conflict (host) do nothing`, [loja.id, JSON.stringify(hosts)]);
      // o endereço principal: o link de acompanhamento nos avisos por WhatsApp
      await unico.sqlBanco("update public.lojas set endereco = $2 where id = $1", [loja.id, enderecoLoja(ficha)]);
      await atualizarLoginDoBancoUnico();
      return;
    }
    await sb.configurarLogin(loja.ref, { site_url: enderecoLoja(ficha), uri_allow_list: listaDeRetorno(ficha) });
    await sb.definirSegredos(loja.ref, { ORIGENS_PERMITIDAS: origensDaLoja(ficha).join(","), URL_LOJA: enderecoLoja(ficha) });
    if (publicarPainel) {
      await vc.definirVariavel(ficha.painel.id, "URL_LOJA", enderecoLoja(ficha));
      await vc.publicar({ projetoId: ficha.painel.id, nome: ficha.painel.nome, repo: repoPainel });
    }
  }

  /**
   * O endereço principal (ou o "painel.") ficou pronto e ainda não estava em uso? Passa a usar: login, funções e painel.
   * Devolve a ficha como ficou e se algo mudou.
   */
  async function ativarSePronto(loja, ficha, enderecos) {
    const d = ficha.dominio;
    const agora = new Date().toISOString();
    const novo = { ...d };
    if (enderecos[0]?.ok && !d.ativo_em) novo.ativo_em = agora;
    if (d.painel && enderecos.find((e) => e.site === "painel")?.ok && !d.painel_ativo_em) novo.painel_ativo_em = agora;
    const mudou = novo.ativo_em !== d.ativo_em || novo.painel_ativo_em !== d.painel_ativo_em;
    if (!mudou) return { ficha, mudou };
    const atualizada = { ...ficha, dominio: novo };
    await gravarFicha(bd(loja), { dominio: novo });
    await aplicarEnderecos(loja, atualizada, { publicarPainel: novo.ativo_em !== d.ativo_em });
    return { ficha: atualizada, mudou };
  }

  /** Situação do domínio da loja (se o DNS já ficou pronto, a loja já passa a usar o domínio). */
  async function dominio(loja) {
    const ficha = await fichaPublicada(loja);
    if (!ficha.dominio?.nome) return { ...resumoDoDominio(ficha), mudou: false };
    const enderecos = await lerEnderecos(ficha);
    const r = await ativarSePronto(loja, ficha, enderecos);
    return { ...resumoDoDominio(r.ficha, enderecos), mudou: r.mudou };
  }

  /**
   * Liga (ou troca) o domínio próprio: os endereços entram nos sites da Vercel e a resposta traz os registros
   * de DNS que faltam criar. O endereço da loja só muda quando o DNS estiver certo (em conferirDominio).
   */
  async function definirDominio(loja, dados) {
    const nome = normalizarDominio(dados?.dominio, { reservados: await reservados() });
    const usarPainel = dados?.painel !== false;
    let ficha = await fichaPublicada(loja);
    const antigo = ficha.dominio?.nome ? ficha.dominio : null;
    const mesmo = antigo?.nome === nome;
    if (antigo && !mesmo) await soltarEnderecos(ficha, enderecosDoDominio(antigo.nome, antigo));
    else if (mesmo && antigo.painel && !usarPainel) await soltarEnderecos(ficha, enderecosDoDominio(nome).filter((e) => e.site === "painel"));
    const novo = {
      nome, painel: usarPainel, adicionado_em: mesmo ? antigo.adicionado_em : new Date().toISOString(),
      ativo_em: mesmo ? antigo.ativo_em ?? null : null, painel_ativo_em: mesmo && usarPainel ? antigo.painel_ativo_em ?? null : null,
    };
    for (const e of enderecosDoDominio(nome, novo)) await ligarEndereco(siteDoEndereco(ficha, e), e, loja);
    const antes = { loja: enderecoLoja(ficha), painel: enderecoPainel(ficha) };
    ficha = { ...ficha, dominio: novo };
    await gravarFicha(bd(loja), { dominio: novo });
    await aplicarEnderecos(loja, ficha, { publicarPainel: antes.loja !== enderecoLoja(ficha) });
    const r = await conferirDominio(loja);
    return { ...r, mudou: r.mudou || r.endereco_loja !== antes.loja || r.endereco_painel !== antes.painel };
  }

  /**
   * Confere o domínio na Vercel (e pede de novo a verificação que estiver pendente). Quando o endereço principal
   * passa a funcionar, a loja passa a usá-lo em tudo; o mesmo para "painel.<domínio>".
   */
  async function conferirDominio(loja) {
    const ficha = await fichaPublicada(loja);
    const d = ficha.dominio;
    if (!d?.nome) throw new ErroHttp(409, "Esta loja não tem domínio próprio.");
    for (const e of enderecosDoDominio(d.nome, d)) {
      const site = siteDoEndereco(ficha, e);
      const pd = await vc.dominioDoProjeto(site.id, e.host).catch(semDominioNoSite);
      if (!pd) await ligarEndereco(site, e, loja); // alguém tirou pela Vercel: liga de novo
      else if (!pd.verified) await vc.verificarDominio(site.id, e.host).catch(() => null);
    }
    const enderecos = await lerEnderecos(ficha);
    const r = await ativarSePronto(loja, ficha, enderecos);
    return { ...resumoDoDominio(r.ficha, enderecos), mudou: r.mudou };
  }

  /** Tira o domínio próprio: a loja volta para o endereço da Vercel (que nunca deixou de funcionar). */
  async function removerDominio(loja) {
    let ficha = await fichaPublicada(loja);
    const d = ficha.dominio;
    if (!d?.nome) return { ...resumoDoDominio(ficha), mudou: false };
    await soltarEnderecos(ficha, enderecosDoDominio(d.nome, d));
    ficha = { ...ficha, dominio: null };
    await gravarFicha(bd(loja), { dominio: null });
    await aplicarEnderecos(loja, ficha, { publicarPainel: Boolean(d.ativo_em) });
    return { ...resumoDoDominio(ficha), mudou: true };
  }

  /* ---------- endereço na Forminha (anadoces.forminha.com.br) ---------- */

  /** O nome sugerido: o do site da loja na Vercel (já é único); se não servir, nome + código. */
  function rotuloSugerido(ficha) {
    let doEndereco = null; // "doce-da-bia" de https://doce-da-bia.vercel.app (no banco único, o site é de todas as lojas)
    try { doEndereco = new URL(ficha.loja?.url).hostname.split(".")[0]; } catch { /* sem endereço */ }
    for (const t of [doEndereco, ficha.loja?.nome, `${slug(ficha.nome ?? "loja")}-${String(ficha.codigo ?? "").toLowerCase()}`]) {
      try { return normalizarSubdominio(t); } catch { /* tenta o próximo */ }
    }
    return `loja-${randomBytes(3).toString("hex")}`;
  }

  async function lerEnderecosSub(ficha) {
    const { rotulo, raiz } = ficha.sub;
    return Promise.all(enderecosNaForminha(rotulo, raiz).map(async (e) => {
      const site = siteDoEndereco(ficha, e);
      const [pd, cfg] = await Promise.all([
        vc.dominioDoProjeto(site.id, e.host).catch(semDominioNoSite),
        vc.configDoDominio(e.host, site.id).catch(() => null),
      ]);
      const verificado = Boolean(pd?.verified);
      const dnsOk = cfg?.misconfigured === false;
      // o DNS das lojas é o coringa "*" do domínio da Forminha (criado uma vez, em Configurações)
      const registros = dnsOk ? [] : [{ tipo: "CNAME", nome: "*", valor: registroDoEndereco(e.host, raiz, null).valor, ok: false }];
      if (pd && !verificado) {
        for (const v of pd.verification ?? []) registros.push({ tipo: String(v.type ?? "TXT").toUpperCase(), nome: nomeNoDns(v.domain, raiz), valor: v.value, ok: false });
      }
      return { host: e.host, site: e.site, atalho: false, ligado: Boolean(pd), ok: Boolean(pd) && verificado && dnsOk, registros };
    }));
  }

  function resumoDoSub(ficha, b, enderecos = null) {
    const s = ficha.sub;
    const base = { raiz: b?.raiz ?? s?.raiz ?? null, pronta: Boolean(b?.pronta), endereco_loja: enderecoLoja(ficha), endereco_painel: enderecoPainel(ficha) };
    if (!s) return { ...base, subdominio: null, sugestao: rotuloSugerido(ficha), enderecos: [] };
    const todos = enderecos ? enderecos.every((e) => e.ok) : Boolean(s.ativo_em && s.painel_ativo_em);
    const principal = enderecos?.[0]?.ok ?? Boolean(s.ativo_em);
    return { ...base, raiz: s.raiz, subdominio: s.rotulo, host: hostDoSub(s, "loja"), ativo: Boolean(s.ativo_em),
      situacao: todos ? "ok" : principal ? "parcial" : "aguardando", enderecos: enderecos ?? [] };
  }

  /** Endereço pronto e ainda sem uso? Passa a usar (login, funções e painel), como no domínio próprio. */
  async function ativarSubSePronto(loja, ficha, enderecos) {
    const s = ficha.sub;
    const agora = new Date().toISOString();
    const novo = { ...s };
    if (enderecos.find((e) => e.site === "loja")?.ok && !s.ativo_em) novo.ativo_em = agora;
    if (enderecos.find((e) => e.site === "painel")?.ok && !s.painel_ativo_em) novo.painel_ativo_em = agora;
    const mudou = novo.ativo_em !== s.ativo_em || novo.painel_ativo_em !== s.painel_ativo_em;
    if (!mudou) return { ficha, mudou };
    const antes = enderecoLoja(ficha);
    const atualizada = { ...ficha, sub: novo };
    await gravarFicha(bd(loja), { sub: novo });
    await aplicarEnderecos(loja, atualizada, { publicarPainel: antes !== enderecoLoja(atualizada) });
    return { ficha: atualizada, mudou };
  }

  /** Liga (ou troca) anadoces.<raiz> e anadoces-painel.<raiz> nos sites da loja e confere. */
  async function ligarSub(loja, ficha, { raiz, rotulo }) {
    const antigo = ficha.sub ?? null;
    const mesmo = antigo?.rotulo === rotulo && antigo?.raiz === raiz;
    const lista = enderecosNaForminha(rotulo, raiz);
    const ligados = [];
    try {
      for (const e of lista) {
        await ligarEndereco(siteDoEndereco(ficha, e), e, loja);
        ligados.push(e);
      }
    } catch (erro) {
      if (!mesmo) await soltarEnderecos(ficha, ligados).catch(() => {}); // não deixa metade ligada
      if (erro instanceof ErroHttp && erro.status === 409) {
        throw new ErroHttp(409, `O endereço ${rotulo}.${raiz} já é de outro site. Escolha outro nome.`, { subdominio: "Esse endereço já é de outra loja." });
      }
      throw erro;
    }
    if (antigo && !mesmo) await soltarEnderecos(ficha, enderecosNaForminha(antigo.rotulo, antigo.raiz));
    const antes = { loja: enderecoLoja(ficha), painel: enderecoPainel(ficha) };
    const novo = mesmo ? antigo : { rotulo, raiz, adicionado_em: new Date().toISOString(), ativo_em: null, painel_ativo_em: null };
    const atual = { ...ficha, sub: novo };
    await gravarFicha(bd(loja), { sub: novo });
    // os endereços novos entram na lista de quem pode chamar a loja (e o antigo sai)
    await aplicarEnderecos(loja, atual, { publicarPainel: antes.loja !== enderecoLoja(atual) });
    const r = await ativarSubSePronto(loja, atual, await lerEnderecosSub(atual));
    return { ...r, mudou: r.mudou || enderecoLoja(r.ficha) !== antes.loja || enderecoPainel(r.ficha) !== antes.painel };
  }

  async function subdominio(loja) {
    const ficha = await fichaPublicada(loja);
    const b = await base();
    if (!ficha.sub) return { ...resumoDoSub(ficha, b), mudou: false };
    const enderecos = await lerEnderecosSub(ficha);
    const r = await ativarSubSePronto(loja, ficha, enderecos);
    return { ...resumoDoSub(r.ficha, b, enderecos), mudou: r.mudou };
  }

  async function definirSubdominio(loja, dados) {
    const ficha = await fichaPublicada(loja);
    const b = await base();
    if (!b?.raiz) throw new ErroHttp(409, "Primeiro ligue o domínio da Forminha em Configurações.");
    if (!b.pronta) throw new ErroHttp(409, "O registro coringa (*) do domínio da Forminha ainda não está pronto. Veja em Configurações.");
    const rotulo = dados?.subdominio ? normalizarSubdominio(dados.subdominio) : ficha.sub?.raiz === b.raiz ? ficha.sub.rotulo : rotuloSugerido(ficha);
    const r = await ligarSub(loja, ficha, { raiz: b.raiz, rotulo });
    return { ...resumoDoSub(r.ficha, b, await lerEnderecosSub(r.ficha)), mudou: r.mudou };
  }

  async function conferirSubdominio(loja) {
    const ficha = await fichaPublicada(loja);
    if (!ficha.sub) throw new ErroHttp(409, "Esta loja ainda não tem endereço na Forminha.");
    for (const e of enderecosNaForminha(ficha.sub.rotulo, ficha.sub.raiz)) {
      const site = siteDoEndereco(ficha, e);
      const pd = await vc.dominioDoProjeto(site.id, e.host).catch(semDominioNoSite);
      if (!pd) await ligarEndereco(site, e, loja);
      else if (!pd.verified) await vc.verificarDominio(site.id, e.host).catch(() => null);
    }
    return subdominio(loja);
  }

  async function removerSubdominio(loja) {
    let ficha = await fichaPublicada(loja);
    const s = ficha.sub;
    if (!s) return { ...resumoDoSub(ficha, await base()), mudou: false };
    const antes = enderecoLoja(ficha);
    await soltarEnderecos(ficha, enderecosNaForminha(s.rotulo, s.raiz));
    ficha = { ...ficha, sub: null };
    await gravarFicha(bd(loja), { sub: null });
    await aplicarEnderecos(loja, ficha, { publicarPainel: antes !== enderecoLoja(ficha) });
    return { ...resumoDoSub(ficha, await base()), mudou: true };
  }

  /**
   * Cópia de segurança dos dados da loja (todas as tabelas do banco dela, em JSON). As fotos ficam no
   * armazenamento do Supabase e não entram. Lojas muito grandes: use o painel do Supabase (Database → Backups).
   */
  async function copiaDaLoja(loja) {
    if (loja.status !== "ACTIVE_HEALTHY") throw new ErroHttp(409, "A loja está pausada. Reative antes de baixar a cópia.");
    // no banco único, isto roda DENTRO da loja: cada tabela devolve só as linhas dela
    const { sql } = bd(loja);
    const nomes = (await sql(`select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`)).map((l) => l.table_name).filter((n) => /^[a-z_][a-z0-9_]*$/.test(n));
    const tabelas = {};
    let tamanho = 0;
    for (const n of nomes) {
      const [l] = await sql(`select coalesce(json_agg(t), '[]'::json) as linhas from public."${n}" t`);
      tabelas[n] = typeof l?.linhas === "string" ? JSON.parse(l.linhas) : l?.linhas ?? [];
      tamanho += JSON.stringify(tabelas[n]).length;
      if (tamanho > 4_000_000) throw new ErroHttp(413, "Esta loja é grande demais para baixar por aqui. Use o painel do Supabase: Database → Backups.");
    }
    return { forminha: "loja", versao: 1, loja: { nome: loja.nome, codigo: loja.codigo, ref: loja.ref }, gerado_em: new Date().toISOString(),
      aviso: "Dados do banco da loja (pedidos, clientes, produtos, estoque…). As fotos ficam no armazenamento do Supabase.", tabelas };
  }

  /** Escreve na ficha "forminha" da loja (ex.: a situação da mensalidade). `ref`: o do projeto ou o código (banco único). */
  async function escreverFicha(ref, dados) {
    const loja = PADRAO_CODIGO.test(String(ref)) ? await doBancoUnico(String(ref)) : { ref };
    if (!loja) throw new ErroHttp(404, "Loja não encontrada.");
    await gravarFicha(bd(loja), dados);
  }

  /**
   * Banco único: o login de todas as lojas aceita voltar só para os endereços delas (links de e-mail, como o
   * "esqueci a senha"). A lista é refeita a partir dos endereços registrados no banco.
   */
  async function atualizarLoginDoBancoUnico() {
    const c = await unico.pronto();
    if (!c) return;
    const linhas = await unico.sqlBanco("select host from public.loja_enderecos order by host");
    await sb.configurarLogin(c.ref, { site_url: c.loja.url, uri_allow_list: linhas.map((l) => `https://${l.host}/**`).join(",") });
  }

  /**
   * Pagamento online no banco único: as funções são de todas as lojas; a chave do Mercado Pago da loja (e a chave de
   * integração que o aviso de pagamento usa) ficam guardadas CIFRADAS no banco — só as funções abrem.
   */
  async function conectarPagamentoNoBancoUnico(loja, token) {
    const s = await situacao(bd(loja));
    if (!s.ficha?.loja?.url) throw new ErroHttp(409, "Publique a loja antes de ligar o pagamento online.");
    const conta = await contaMercadoPago(token);
    const segredo = randomBytes(24).toString("hex");
    await unico.guardarSegredos(loja.id, { mp_token: token, segredo_gateway: segredo });
    await bd(loja).sql("select public.central_conectar_gateway($1::jsonb)", [JSON.stringify({ segredo, conta, cartao: true })]);
    await gravarFicha(bd(loja), { pagamento_conectado_em: new Date().toISOString() });
    return { conectado: true, conta, pix: true, cartao: true };
  }

  /* ---------- avisos por WhatsApp (Meta) ---------- */

  /** A chave e o número são da Meta mesmo? Devolve o número e o nome que aparecem para o cliente. */
  async function contaWhatsapp(token, telefoneId) {
    let r;
    try {
      r = await fetchFn(`https://graph.facebook.com/v21.0/${encodeURIComponent(telefoneId)}?fields=display_phone_number,verified_name`, { headers: { Authorization: `Bearer ${token}` } });
    } catch (e) { throw new ErroProvedor("Meta", 0, `sem conexão (${e.message})`); }
    const d = await r.json().catch(() => ({}));
    if ([400, 401, 403, 404].includes(r.status)) {
      throw new ErroHttp(422, "A Meta não aceitou essa chave com esse número. Confira o token e o ID do número de telefone.", { token: "A Meta não aceitou essa chave." });
    }
    if (!r.ok) throw new ErroProvedor("Meta", r.status, "não consegui conferir agora");
    return { numero: String(d.display_phone_number ?? "").slice(0, 40), nome: String(d.verified_name ?? "").slice(0, 120) };
  }

  /**
   * Liga os avisos por WhatsApp da loja: confere na Meta e guarda a chave onde as funções leem (segredos do projeto
   * da loja, ou cifrada no banco único). A chave nunca volta para a tela.
   */
  async function conectarWhatsapp(loja, dados) {
    const token = String(dados?.token ?? "").trim();
    const telefoneId = String(dados?.telefone_id ?? "").replace(/[^0-9]/g, "");
    const campos = {};
    if (token.length < 20 || /[^A-Za-z0-9_.|-]/.test(token)) campos.token = "Cole o token de acesso da Meta (permanente, do usuário do sistema).";
    if (telefoneId.length < 5 || telefoneId.length > 25) campos.telefone_id = "Cole o ID do número de telefone (só números).";
    if (Object.keys(campos).length) throw new ErroHttp(422, Object.values(campos)[0], campos);
    if (loja.status !== "ACTIVE_HEALTHY") throw new ErroHttp(409, "A loja está pausada. Reative antes de ligar o WhatsApp.");
    const s = await situacao(bd(loja));
    if (!s.ficha?.loja?.url) throw new ErroHttp(409, "Publique a loja antes de ligar o WhatsApp.");
    const conta = await contaWhatsapp(token, telefoneId);
    if (doUnico(loja)) await unico.guardarSegredos(loja.id, { whatsapp_token: token, whatsapp_phone_id: telefoneId });
    else {
      if (s.ficha.funcoes_versao !== versaoDasFuncoes()) await atualizarFuncoes(loja);
      await sb.definirSegredos(loja.ref, { WHATSAPP_TOKEN: token, WHATSAPP_PHONE_ID: telefoneId, URL_LOJA: enderecoLoja(s.ficha) });
    }
    // o painel mostra "conectado" (a chave não: só o número)
    const info = { ...conta, conectado_em: new Date().toISOString() };
    await bd(loja).sql(`with atualizada as (update public.configuracoes set valor = $1::jsonb where chave = 'whatsapp' returning 1)
      insert into public.configuracoes (chave, valor) select 'whatsapp', $1::jsonb where not exists (select 1 from atualizada)`, [JSON.stringify(info)]);
    return { conectado: true, ...conta };
  }

  return { porRef, porCodigo, porEndereco, estado, listar, criar, prepararPasso, publicar, convite, linkRedefinirSenha, reativar, excluir, manterAtivas, copiaDaLoja, escreverFicha,
    conectarPagamento, atualizarFuncoes, conferirDona, dominio, definirDominio, conferirDominio, removerDominio,
    subdominio, definirSubdominio, conferirSubdominio, removerSubdominio, conectarWhatsapp };
}
