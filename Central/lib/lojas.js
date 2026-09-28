/* ==========================================================
   LOJAS — tudo o que a Central faz com a loja de uma cliente:
   criar o banco, preparar as tabelas, publicar os 2 sites, convite,
   reativar, excluir, manter ativa e o link de redefinir senha.
   Usado pelo botão "Nova loja" e pela criação automática depois
   do pagamento (lib/clientes.js).
   SEGURANÇA: só mexe em projetos da organização FORMINHA_ORG com
   nome no padrão "<código> · <nome>" — nunca nos outros da conta.
   ========================================================== */
import { ErroProvedor } from "./provedores.js";
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
    email: s.ficha?.email ?? null, loja: s.ficha?.loja?.url ?? null, painel: s.ficha?.painel?.url ?? null,
  };
}

export function criarLojas({ sb, vc, org, repoLoja, repoPainel, pastaLoja, pastaPainel, fetchFn = fetch }) {
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
      const site = await criarSite({ nomeBase: `${nomeBase}-painel`, alternativo: `${nomeBase}-${sufixo}-painel`, repo: repoPainel, pasta: pastaPainel, variaveis: { SUPABASE_URL: supabaseUrl, SUPABASE_ANON_KEY: chave, URL_LOJA: ficha.loja.url } });
      await vc.publicar({ projetoId: site.id, nome: site.nome, repo: repoPainel });
      ficha.painel = { ...site, url: await enderecoDoSite(site) };
      await gravarFicha(sb, loja.ref, { painel: ficha.painel });
    }
    // login das clientes: links de e-mail voltam para a loja/painel; sem SMTP próprio no projeto, a conta já nasce confirmada
    await sb.configurarLogin(loja.ref, {
      site_url: ficha.loja.url, uri_allow_list: `${ficha.loja.url}/**,${ficha.painel.url}/**`,
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
    return { link: `${s.ficha.painel.url}/#/convite/${codigo}`, email, loja: loja.nome, vale_dias: 7 };
  }

  /** Suporte: link para a dona criar uma senha nova (vale pouco tempo). A chave administrativa da loja é lida
      na hora, fica só na memória desta requisição e nunca vai para a tela nem para os registros. */
  async function linkRedefinirSenha(loja, emailDona) {
    if (loja.status !== "ACTIVE_HEALTHY") throw new ErroHttp(409, "A loja está pausada. Reative antes.");
    const s = await situacao(sb, loja.ref);
    const destino = s.ficha?.loja?.url;
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

  return { porRef, porCodigo, estado, listar, criar, prepararPasso, publicar, convite, linkRedefinirSenha, reativar, excluir, manterAtivas };
}
