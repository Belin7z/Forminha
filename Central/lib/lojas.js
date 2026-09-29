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
   ========================================================== */
import { randomBytes } from "node:crypto";
import { ErroProvedor } from "./provedores.js";
import { FUNCOES, montarFuncao, versaoDasFuncoes } from "./funcoes.js";
import { enderecosDoDominio, nomeNoDns, normalizarDominio, raizDoDominio, registroDoEndereco } from "./dominios.js";
import { gerarCodigo, lerNomeDoProjeto, nomeDoProjeto, senhaAleatoria, slug } from "./codigo.js";
import { aplicarProxima, gerarConvite, gravarFicha, semear, situacao } from "./banco.js";
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
    suspensa: Boolean(s.ficha?.assinatura?.suspensa),
  };
}

/** Endereço da loja para as clientes: o domínio próprio quando já funciona; antes disso, o da Vercel. */
export const enderecoLoja = (ficha) => (ficha?.dominio?.ativo_em ? `https://${ficha.dominio.nome}` : ficha?.loja?.url ?? null);
/** Endereço do painel: "painel.<domínio>" quando a dona escolheu e já funciona. */
export const enderecoPainel = (ficha) => (ficha?.dominio?.painel && ficha.dominio.painel_ativo_em ? `https://painel.${ficha.dominio.nome}` : ficha?.painel?.url ?? null);

/** Os endereços de uma loja (sites e domínio próprio): só eles podem chamar as funções dela pelo navegador. */
export function origensDaLoja(ficha) {
  const doDominio = ficha?.dominio?.nome ? enderecosDoDominio(ficha.dominio.nome, ficha.dominio).map((e) => `https://${e.host}`) : [];
  const lista = [ficha?.loja?.url, ficha?.painel?.url, ...doDominio];
  return [...new Set(lista.filter(Boolean).map((u) => String(u).replace(/\/+$/, "")))];
}

/** Para onde os links dos e-mails de login podem voltar. */
const listaDeRetorno = (ficha) => origensDaLoja(ficha).map((o) => `${o}/**`).join(",");

export function criarLojas({ sb, vc, org, repoLoja, repoPainel, pastaLoja, pastaPainel, urlCentral = "", fetchFn = fetch }) {
  // o domínio da própria Central (e o que vier embaixo dele) não pode virar domínio de loja
  let hostCentral = "";
  try { hostCentral = urlCentral ? new URL(urlCentral).hostname : ""; } catch { /* sem Central configurada */ }
  const reservados = hostCentral && !/^(localhost|127\.0\.0\.1)$/.test(hostCentral) ? [raizDoDominio(hostCentral)] : [];

  /** Busca o projeto e confere que é MESMO uma loja da Forminha. */
  async function porRef(ref) {
    if (!REF.test(String(ref))) throw new ErroHttp(404, "Loja não encontrada.");
    let p;
    try { p = await sb.projeto(ref); } catch (e) { if (e.status === 404) throw new ErroHttp(404, "Loja não encontrada."); throw e; }
    const id = lerNomeDoProjeto(p?.name);
    if (!id || (p.organization_slug !== org && p.organization_id !== org)) throw new ErroHttp(404, "Loja não encontrada.");
    return { ref: p.ref ?? p.id, status: p.status, ...id };
  }

  async function estado(loja) {
    const base = { ref: loja.ref, codigo: loja.codigo, nome: loja.nome, status: loja.status };
    const etapa = etapaDoStatus(loja.status);
    if (etapa) return { ...base, etapa };
    return { ...base, ...resumoDoBanco(await situacao(sb, loja.ref)) };
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
    return lista.filter(Boolean).sort((a, b) => String(b.criada_em).localeCompare(String(a.criada_em)));
  }

  /** Cria o banco "<código> · <nome>". O código pode vir pronto (a criação automática o guarda antes, para nunca duplicar). */
  async function criar(nome, codigo = gerarCodigo()) {
    const p = await sb.criarProjeto({ nome: nomeDoProjeto(codigo, nome), org, senhaBanco: senhaAleatoria() });
    return { ref: p.ref ?? p.id, codigo, nome };
  }

  /** Acha o projeto pelo código (para retomar uma criação que caiu no meio). */
  async function porCodigo(codigo) {
    const p = (await sb.projetosDaOrg(org)).find((x) => lerNomeDoProjeto(x.name)?.codigo === codigo);
    return p ? { ref: p.ref ?? p.id, status: p.status, ...lerNomeDoProjeto(p.name) } : null;
  }

  /** Uma migração por chamada; quando acabam, o seed. Serve também para ATUALIZAR lojas antigas. */
  async function prepararPasso(loja, emailDona) {
    if (loja.status !== "ACTIVE_HEALTHY") throw new ErroHttp(409, "O banco desta loja ainda não está pronto. Aguarde um instante.");
    const r = await aplicarProxima(sb, loja.ref);
    if (r.aplicada) return { etapa: "tabelas", feitas: r.feitas, total: r.total, aplicada: r.aplicada.nome };
    const s = await situacao(sb, loja.ref);
    if (!s.semeada) {
      const email = String(emailDona ?? s.ficha?.email ?? "").trim().toLowerCase();
      if (!EMAIL.test(email)) throw new ErroHttp(422, "Informe o e-mail da dona da loja.", { email: "Informe o e-mail da dona da loja." });
      await semear(sb, loja.ref, { nome: loja.nome, codigo: loja.codigo, email });
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

  /** Cria e publica a loja e o painel (não duplica se chamado de novo) e ajusta o login das clientes. */
  async function publicar(loja) {
    if (loja.status !== "ACTIVE_HEALTHY") throw new ErroHttp(409, "O banco desta loja não está ativo.");
    const s = await situacao(sb, loja.ref);
    if (s.pendentes.length || !s.semeada) throw new ErroHttp(409, "O banco da loja ainda não foi preparado.");
    const ficha = s.ficha ?? {};
    const supabaseUrl = `https://${loja.ref}.supabase.co`;
    const chave = await sb.chavePublica(loja.ref);
    const nomeBase = slug(loja.nome);
    const sufixo = loja.codigo.toLowerCase();
    if (!ficha.loja?.id) {
      const site = await criarSite({ nomeBase, alternativo: `${nomeBase}-${sufixo}`, repo: repoLoja, pasta: pastaLoja, variaveis: { SUPABASE_URL: supabaseUrl, SUPABASE_ANON_KEY: chave } });
      await vc.publicar({ projetoId: site.id, nome: site.nome, repo: repoLoja });
      ficha.loja = { ...site, url: await enderecoDoSite(site) };
      await gravarFicha(sb, loja.ref, { loja: ficha.loja });
    }
    if (!ficha.painel?.id) {
      const site = await criarSite({ nomeBase: `${nomeBase}-painel`, alternativo: `${nomeBase}-${sufixo}-painel`, repo: repoPainel, pasta: pastaPainel,
        variaveis: { SUPABASE_URL: supabaseUrl, SUPABASE_ANON_KEY: chave, URL_LOJA: ficha.loja.url, ...(urlCentral && { URL_CENTRAL: urlCentral }) } });
      await vc.publicar({ projetoId: site.id, nome: site.nome, repo: repoPainel });
      ficha.painel = { ...site, url: await enderecoDoSite(site) };
      await gravarFicha(sb, loja.ref, { painel: ficha.painel });
    }
    // login das clientes: links de e-mail voltam para a loja/painel; sem SMTP próprio no projeto, a conta já nasce confirmada
    await sb.configurarLogin(loja.ref, {
      site_url: enderecoLoja(ficha), uri_allow_list: listaDeRetorno(ficha),
      external_email_enabled: true, mailer_autoconfirm: true, password_min_length: 8, password_required_characters: SENHA_LETRAS_E_NUMEROS,
    });
    return { etapa: "pronta", loja: ficha.loja.url, painel: ficha.painel.url };
  }

  async function convite(loja, emailDona) {
    if (loja.status !== "ACTIVE_HEALTHY") throw new ErroHttp(409, "A loja está pausada. Reative antes de gerar um convite.");
    const s = await situacao(sb, loja.ref);
    if (!s.ficha?.painel?.url) throw new ErroHttp(409, "A loja ainda não foi publicada.");
    const email = String(emailDona ?? s.ficha.email ?? "").trim().toLowerCase();
    if (!EMAIL.test(email)) throw new ErroHttp(422, "Informe o e-mail da dona da loja.", { email: "Informe o e-mail da dona da loja." });
    const codigo = await gerarConvite(sb, loja.ref, email);
    return { link: `${enderecoPainel(s.ficha)}/#/convite/${codigo}`, email, loja: loja.nome, vale_dias: 7 };
  }

  /** Suporte: link para a dona criar uma senha nova (vale pouco tempo). A chave administrativa da loja é lida
      na hora, fica só na memória desta requisição e nunca vai para a tela nem para os registros. */
  async function linkRedefinirSenha(loja, emailDona) {
    if (loja.status !== "ACTIVE_HEALTHY") throw new ErroHttp(409, "A loja está pausada. Reative antes.");
    const s = await situacao(sb, loja.ref);
    const destino = enderecoLoja(s.ficha);
    if (!destino) throw new ErroHttp(409, "A loja ainda não foi publicada.");
    const segredo = await sb.chaveSecreta(loja.ref);
    const cabecalhos = { apikey: segredo, "Content-Type": "application/json", ...(segredo.startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${segredo}` }) };
    let r;
    try {
      r = await fetchFn(`https://${loja.ref}.supabase.co/auth/v1/admin/generate_link`, {
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
    await sb.reativar(loja.ref);
  }

  /** Apaga os 2 sites e o banco inteiro (dados, logins e fotos). Exige o código exato. */
  async function excluir(loja, codigoDigitado) {
    if (String(codigoDigitado ?? "").trim() !== loja.codigo) throw new ErroHttp(422, "Digite o código da loja exatamente como aparece para confirmar.", { codigo: "O código não confere." });
    let ficha = null;
    if (loja.status === "ACTIVE_HEALTHY") ficha = (await situacao(sb, loja.ref).catch(() => null))?.ficha ?? null;
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
    let s = await situacao(sb, loja.ref);
    if (!s.ficha?.loja?.url) throw new ErroHttp(409, "Publique a loja antes de ligar o pagamento online.");
    const conta = await contaMercadoPago(token);
    for (let i = 0; i < s.pendentes.length; i++) await aplicarProxima(sb, loja.ref); // o banco precisa das regras de pagamento mais novas
    await atualizarFuncoes(loja);
    const segredo = randomBytes(24).toString("hex");
    s = await situacao(sb, loja.ref);
    await sb.definirSegredos(loja.ref, { MP_ACCESS_TOKEN: token, SEGREDO_GATEWAY: segredo, ORIGENS_PERMITIDAS: origensDaLoja(s.ficha).join(",") });
    await sb.sql(loja.ref, "select public.central_conectar_gateway($1::jsonb)", [JSON.stringify({ segredo, conta, cartao: true })]);
    await gravarFicha(sb, loja.ref, { pagamento_conectado_em: new Date().toISOString() });
    return { conectado: true, conta, pix: true, cartao: true };
  }

  /** Instala (ou atualiza) as funções do servidor na loja e anota a versão. */
  async function atualizarFuncoes(loja) {
    for (const nome of FUNCOES) await sb.implantarFuncao(loja.ref, nome, montarFuncao(nome));
    await gravarFicha(sb, loja.ref, { funcoes_versao: versaoDasFuncoes() });
  }

  /** Quem chama pelo painel da loja é administradora dela? (o próprio banco da loja responde, com o login da pessoa) */
  async function conferirDona(loja, jwt) {
    const chave = await sb.chavePublica(loja.ref);
    let r;
    try {
      r = await fetchFn(`https://${loja.ref}.supabase.co/rest/v1/rpc/admin_gateway`, {
        method: "POST", headers: { apikey: chave, Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" }, body: JSON.stringify({ p: {} }),
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
    const s = await situacao(sb, loja.ref);
    if (!s.ficha?.loja?.id || !s.ficha?.painel?.id) throw new ErroHttp(409, "Publique a loja antes de ligar um domínio próprio.");
    return s.ficha;
  }

  /** Liga um endereço a um dos sites (se já estiver ligado nele, tudo certo). */
  async function ligarEndereco(site, e) {
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
    await gravarFicha(sb, loja.ref, { dominio: novo });
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
    const nome = normalizarDominio(dados?.dominio, { reservados });
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
    for (const e of enderecosDoDominio(nome, novo)) await ligarEndereco(siteDoEndereco(ficha, e), e);
    const antes = { loja: enderecoLoja(ficha), painel: enderecoPainel(ficha) };
    ficha = { ...ficha, dominio: novo };
    await gravarFicha(sb, loja.ref, { dominio: novo });
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
      if (!pd) await ligarEndereco(site, e); // alguém tirou pela Vercel: liga de novo
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
    await gravarFicha(sb, loja.ref, { dominio: null });
    await aplicarEnderecos(loja, ficha, { publicarPainel: Boolean(d.ativo_em) });
    return { ...resumoDoDominio(ficha), mudou: true };
  }

  /**
   * Cópia de segurança dos dados da loja (todas as tabelas do banco dela, em JSON). As fotos ficam no
   * armazenamento do Supabase e não entram. Lojas muito grandes: use o painel do Supabase (Database → Backups).
   */
  async function copiaDaLoja(loja) {
    if (loja.status !== "ACTIVE_HEALTHY") throw new ErroHttp(409, "A loja está pausada. Reative antes de baixar a cópia.");
    const nomes = (await sb.sql(loja.ref, `select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`)).map((l) => l.table_name).filter((n) => /^[a-z_][a-z0-9_]*$/.test(n));
    const tabelas = {};
    let tamanho = 0;
    for (const n of nomes) {
      const [l] = await sb.sql(loja.ref, `select coalesce(json_agg(t), '[]'::json) as linhas from public."${n}" t`);
      tabelas[n] = typeof l?.linhas === "string" ? JSON.parse(l.linhas) : l?.linhas ?? [];
      tamanho += JSON.stringify(tabelas[n]).length;
      if (tamanho > 4_000_000) throw new ErroHttp(413, "Esta loja é grande demais para baixar por aqui. Use o painel do Supabase: Database → Backups.");
    }
    return { forminha: "loja", versao: 1, loja: { nome: loja.nome, codigo: loja.codigo, ref: loja.ref }, gerado_em: new Date().toISOString(),
      aviso: "Dados do banco da loja (pedidos, clientes, produtos, estoque…). As fotos ficam no armazenamento do Supabase.", tabelas };
  }

  /** Escreve na ficha "forminha" da loja (ex.: a situação da mensalidade). */
  const escreverFicha = (ref, dados) => gravarFicha(sb, ref, dados);

  return { porRef, porCodigo, estado, listar, criar, prepararPasso, publicar, convite, linkRedefinirSenha, reativar, excluir, manterAtivas, copiaDaLoja, escreverFicha,
    conectarPagamento, atualizarFuncoes, conferirDona, dominio, definirDominio, conferirDominio, removerDominio };
}
