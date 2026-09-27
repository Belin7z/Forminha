/* ==========================================================
   CENTRAL DA FORMINHA — o "painel do dono": cria, lista, atualiza e
   exclui as lojas das clientes. Tudo passa por aqui (api/central.js).

   Criar uma loja é uma sequência de passos curtos, puxados pela tela
   (cada um cabe numa requisição e pode ser repetido sem estragar nada):
     1. POST /lojas                 cria o projeto "<código> · <nome>" no Supabase
     2. GET  /lojas/:ref            (a tela espera o banco ficar pronto, 1–3 min)
     3. POST /lojas/:ref/preparar   aplica UMA migração por vez; no fim, o seed
     4. POST /lojas/:ref/publicar   cria os 2 sites na Vercel, publica e ajusta o login
     5. POST /lojas/:ref/convite    gera o link de primeiro acesso da dona

   SEGURANÇA: só mexe em projetos da organização FORMINHA_ORG e com nome
   no padrão da Forminha — nunca em outros projetos da mesma conta.
   ========================================================== */
import { ErroProvedor, criarSupabase, criarVercel } from "./provedores.js";
import { PADRAO_CODIGO, gerarCodigo, lerNomeDoProjeto, nomeDoProjeto, senhaAleatoria, slug } from "./codigo.js";
import { aplicarProxima, gerarConvite, gravarFicha, semear, situacao } from "./banco.js";
import { NOME_COOKIE, conferirSenha, cookieDeSaida, cookieDeSessao, criarSessao, lerCookie, sessaoValida } from "./sessao.js";

export class ErroHttp extends Error {
  constructor(status, mensagem, campos = null) { super(mensagem); this.status = status; this.campos = campos; }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const REF = /^[a-z]{20}$/;
const SENHA_LETRAS_E_NUMEROS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789";
const OBRIGATORIAS = ["CENTRAL_SENHA_HASH", "SEGREDO_SESSAO", "SUPABASE_ACCESS_TOKEN", "VERCEL_TOKEN", "FORMINHA_ORG"];

/** Em que ponto a loja está, a partir do estado do projeto no Supabase. */
function etapaDoStatus(status) {
  if (status === "ACTIVE_HEALTHY") return null; // decide olhando o banco
  if (["INACTIVE", "PAUSING"].includes(status)) return "pausada";
  if (["RESTORING", "RESTARTING", "UPGRADING", "RESIZING"].includes(status)) return "reativando";
  if (["INIT_FAILED", "RESTORE_FAILED", "PAUSE_FAILED", "REMOVED", "GOING_DOWN"].includes(status)) return "problema";
  return "criando"; // COMING_UP, UNKNOWN, ACTIVE_UNHEALTHY (subindo)
}

function resumoDoBanco(s) {
  // sem seed = ainda preparando; sem os 2 sites = falta publicar. Migração nova numa loja pronta = "atualizar".
  const etapa = !s.semeada ? "tabelas" : !s.ficha?.loja?.url || !s.ficha?.painel?.url ? "sites" : "pronta";
  return {
    etapa, feitas: s.feitas, total: s.total, atualizar: s.semeada && s.pendentes.length > 0,
    email: s.ficha?.email ?? null, loja: s.ficha?.loja?.url ?? null, painel: s.ficha?.painel?.url ?? null,
  };
}

export function criarCentral(env = process.env, opcoes = {}) {
  const org = String(env.FORMINHA_ORG ?? "").trim();
  // um repositório só; cada site sai de uma pasta dele
  const repoLoja = env.REPO_LOJA || "Belin7z/Forminha";
  const repoPainel = env.REPO_PAINEL || "Belin7z/Forminha";
  const pastaLoja = env.PASTA_LOJA || "Loja";
  const pastaPainel = env.PASTA_PAINEL || "Dashboard";
  const fetchFn = opcoes.fetchFn ?? fetch;
  const sb = opcoes.supabase ?? (env.SUPABASE_ACCESS_TOKEN ? criarSupabase({ token: env.SUPABASE_ACCESS_TOKEN, fetchFn }) : null);
  const vc = opcoes.vercel ?? (env.VERCEL_TOKEN ? criarVercel({ token: env.VERCEL_TOKEN, time: env.VERCEL_TIME, fetchFn }) : null);
  const faltando = OBRIGATORIAS.filter((k) => !env[k] && !(k === "SUPABASE_ACCESS_TOKEN" && opcoes.supabase) && !(k === "VERCEL_TOKEN" && opcoes.vercel));
  const tentativas = new Map(); // freio de senha errada (por endereço, nesta instância)

  const exigirProvedores = () => {
    if (!sb || !vc || !org) throw new ErroHttp(503, `A Central ainda não está configurada (falta: ${faltando.join(", ")}). Rode "npm run configurar".`);
  };

  /** Busca o projeto e confere que é MESMO uma loja da Forminha (organização e nome no padrão). */
  async function lojaPorRef(ref) {
    if (!REF.test(String(ref))) throw new ErroHttp(404, "Loja não encontrada.");
    let p;
    try { p = await sb.projeto(ref); } catch (e) { if (e.status === 404) throw new ErroHttp(404, "Loja não encontrada."); throw e; }
    const id = lerNomeDoProjeto(p?.name);
    if (!id || (p.organization_slug !== org && p.organization_id !== org)) throw new ErroHttp(404, "Loja não encontrada.");
    return { ref: p.ref ?? p.id, status: p.status, ...id };
  }

  async function estadoDaLoja(loja) {
    const base = { ref: loja.ref, codigo: loja.codigo, nome: loja.nome, status: loja.status };
    const etapa = etapaDoStatus(loja.status);
    if (etapa) return { ...base, etapa };
    return { ...base, ...resumoDoBanco(await situacao(sb, loja.ref)) };
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

  /* ---------- rotas ---------- */
  const rotas = [
    ["POST", /^entrar$/, false, async ({ corpo, ip, seguro }) => {
      if (!env.CENTRAL_SENHA_HASH || !env.SEGREDO_SESSAO) throw new ErroHttp(503, 'A senha da Central ainda não foi criada. Rode "npm run configurar".');
      const t = tentativas.get(ip) ?? { n: 0, ate: 0 };
      if (t.ate > Date.now()) throw new ErroHttp(429, `Muitas tentativas. Aguarde ${Math.ceil((t.ate - Date.now()) / 1000)} segundos.`);
      if (!(await conferirSenha(corpo.senha ?? "", env.CENTRAL_SENHA_HASH))) {
        t.n += 1;
        if (t.n >= 5) { t.ate = Date.now() + 60_000 * Math.min(15, 2 ** (Math.floor(t.n / 5) - 1)); }
        tentativas.set(ip, t);
        await new Promise((ok) => setTimeout(ok, 400));
        throw new ErroHttp(401, "Senha incorreta.", { senha: "Senha incorreta." });
      }
      tentativas.delete(ip);
      return { corpo: { ok: true }, cookie: cookieDeSessao(criarSessao(env.SEGREDO_SESSAO), seguro) };
    }],
    ["POST", /^sair$/, false, async ({ seguro }) => ({ corpo: { ok: true }, cookie: cookieDeSaida(seguro) })],
    ["GET", /^eu$/, false, async ({ logado }) => ({ corpo: { logado, faltando: logado ? faltando : [], simulado: Boolean(opcoes.simulado) } })],

    ["GET", /^lojas$/, true, async () => {
      exigirProvedores();
      const projetos = await sb.projetosDaOrg(org);
      const lojas = await Promise.all(projetos.map(async (p) => {
        const id = lerNomeDoProjeto(p.name);
        if (!id) return null;
        const loja = { ref: p.ref ?? p.id, status: p.status, ...id };
        try { return { ...(await estadoDaLoja(loja)), criada_em: p.inserted_at ?? p.created_at ?? null }; }
        catch { return { ref: loja.ref, codigo: loja.codigo, nome: loja.nome, status: loja.status, etapa: "problema" }; }
      }));
      return { corpo: { lojas: lojas.filter(Boolean).sort((a, b) => String(b.criada_em).localeCompare(String(a.criada_em))) } };
    }],

    ["POST", /^lojas$/, true, async ({ corpo }) => {
      exigirProvedores();
      const nome = String(corpo.nome ?? "").replace(/\s+/g, " ").trim();
      const email = String(corpo.email ?? "").trim().toLowerCase();
      const campos = {};
      if (nome.length < 2) campos.nome = "Nome da loja: mínimo de 2 letras.";
      else if (nome.length > 60) campos.nome = "Nome da loja: máximo de 60 letras.";
      if (!EMAIL.test(email)) campos.email = "Informe o e-mail da dona da loja.";
      if (Object.keys(campos).length) throw new ErroHttp(422, Object.values(campos)[0], campos);
      const codigo = gerarCodigo();
      const p = await sb.criarProjeto({ nome: nomeDoProjeto(codigo, nome), org, senhaBanco: senhaAleatoria() });
      return { corpo: { ref: p.ref ?? p.id, codigo, nome, email, etapa: "criando" } };
    }],

    ["GET", /^lojas\/([a-z]+)$/, true, async ({ m }) => {
      exigirProvedores();
      return { corpo: await estadoDaLoja(await lojaPorRef(m[1])) };
    }],

    // uma migração por chamada; quando acabam, o seed. Serve também para ATUALIZAR lojas antigas.
    ["POST", /^lojas\/([a-z]+)\/preparar$/, true, async ({ m, corpo }) => {
      exigirProvedores();
      const loja = await lojaPorRef(m[1]);
      if (loja.status !== "ACTIVE_HEALTHY") throw new ErroHttp(409, "O banco desta loja ainda não está pronto. Aguarde um instante.");
      const r = await aplicarProxima(sb, loja.ref);
      if (r.aplicada) return { corpo: { etapa: "tabelas", feitas: r.feitas, total: r.total, aplicada: r.aplicada.nome } };
      const s = await situacao(sb, loja.ref);
      if (!s.semeada) {
        const email = String(corpo.email ?? s.ficha?.email ?? "").trim().toLowerCase();
        if (!EMAIL.test(email)) throw new ErroHttp(422, "Informe o e-mail da dona da loja.", { email: "Informe o e-mail da dona da loja." });
        await semear(sb, loja.ref, { nome: loja.nome, codigo: loja.codigo, email });
      }
      return { corpo: await estadoDaLoja(loja) };
    }],

    ["POST", /^lojas\/([a-z]+)\/publicar$/, true, async ({ m }) => {
      exigirProvedores();
      const loja = await lojaPorRef(m[1]);
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
      // login das clientes: links de e-mail voltam para a loja/painel; sem SMTP próprio, a conta já nasce confirmada
      await sb.configurarLogin(loja.ref, {
        site_url: ficha.loja.url, uri_allow_list: `${ficha.loja.url}/**,${ficha.painel.url}/**`,
        external_email_enabled: true, mailer_autoconfirm: true, password_min_length: 8, password_required_characters: SENHA_LETRAS_E_NUMEROS,
      });
      return { corpo: { etapa: "pronta", loja: ficha.loja.url, painel: ficha.painel.url } };
    }],

    ["POST", /^lojas\/([a-z]+)\/convite$/, true, async ({ m, corpo }) => {
      exigirProvedores();
      const loja = await lojaPorRef(m[1]);
      if (loja.status !== "ACTIVE_HEALTHY") throw new ErroHttp(409, "A loja está pausada. Reative antes de gerar um convite.");
      const s = await situacao(sb, loja.ref);
      if (!s.ficha?.painel?.url) throw new ErroHttp(409, "A loja ainda não foi publicada.");
      const email = String(corpo.email ?? s.ficha.email ?? "").trim().toLowerCase();
      if (!EMAIL.test(email)) throw new ErroHttp(422, "Informe o e-mail da dona da loja.", { email: "Informe o e-mail da dona da loja." });
      const codigo = await gerarConvite(sb, loja.ref, email);
      return { corpo: { link: `${s.ficha.painel.url}/#/convite/${codigo}`, email, loja: loja.nome, vale_dias: 7 } };
    }],

    ["POST", /^lojas\/([a-z]+)\/reativar$/, true, async ({ m }) => {
      exigirProvedores();
      const loja = await lojaPorRef(m[1]);
      if (!["INACTIVE", "PAUSING"].includes(loja.status)) throw new ErroHttp(409, "Esta loja não está pausada.");
      await sb.reativar(loja.ref);
      return { corpo: { etapa: "reativando" } };
    }],

    // excluir: precisa digitar o código; apaga os 2 sites e o banco inteiro (dados, logins e fotos)
    ["DELETE", /^lojas\/([a-z]+)$/, true, async ({ m, corpo }) => {
      exigirProvedores();
      const loja = await lojaPorRef(m[1]);
      if (String(corpo.codigo ?? "").trim() !== loja.codigo) throw new ErroHttp(422, "Digite o código da loja exatamente como aparece para confirmar.", { codigo: "O código não confere." });
      let ficha = null;
      if (loja.status === "ACTIVE_HEALTHY") ficha = (await situacao(sb, loja.ref).catch(() => null))?.ficha ?? null;
      else if (loja.status === "INACTIVE") throw new ErroHttp(409, "A loja está pausada: reative primeiro (1–2 min) para os sites dela também serem apagados.");
      for (const site of [ficha?.loja, ficha?.painel]) {
        if (site?.id) await vc.excluirProjeto(site.id).catch((e) => { if (e.status !== 404) throw e; });
      }
      await sb.excluirProjeto(loja.ref);
      return { corpo: { ok: true, sites_apagados: [ficha?.loja?.nome, ficha?.painel?.nome].filter(Boolean) } };
    }],

    // todo dia (Vercel Cron): uma chamada leve em cada loja para o Supabase grátis não pausar; pausada -> reativa
    ["GET", /^manter-ativo$/, false, async ({ cabecalhos }) => {
      if (!env.CRON_SECRET || cabecalhos.authorization !== `Bearer ${env.CRON_SECRET}`) throw new ErroHttp(401, "Não autorizado.");
      exigirProvedores();
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
      return { corpo: resultado };
    }],
  ];

  /* ---------- tratamento de cada requisição ---------- */
  async function lerCorpo(req) {
    if (req.body !== undefined) return typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body ?? {};
    const partes = []; let tamanho = 0;
    for await (const parte of req) { tamanho += parte.length; if (tamanho > 64 * 1024) throw new ErroHttp(413, "Dados grandes demais."); partes.push(parte); }
    const texto = Buffer.concat(partes).toString("utf8");
    return texto ? JSON.parse(texto) : {};
  }

  function responder(res, status, corpo, cookie) {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    if (cookie) res.setHeader("Set-Cookie", cookie);
    res.end(JSON.stringify(corpo));
  }

  async function tratar(req, res) {
    try {
      const url = new URL(req.url, "http://central");
      const rota = (url.searchParams.get("rota") ?? url.pathname.replace(/^\/api\/?/, "")).replace(/^\/+|\/+$/g, "");
      const metodo = req.method;
      const cabecalhos = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v[0] : v]));
      const seguro = cabecalhos["x-forwarded-proto"] === "https" || !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(cabecalhos.host ?? "");
      const logado = sessaoValida(lerCookie(cabecalhos.cookie, NOME_COOKIE), env.SEGREDO_SESSAO);

      const achada = rotas.map(([met, re, protegida, fn]) => met === metodo && re.exec(rota) && { m: re.exec(rota), protegida, fn }).find(Boolean);
      if (!achada) throw new ErroHttp(404, "Caminho não encontrado.");
      if (achada.protegida && !logado) throw new ErroHttp(401, "Entre com a senha da Central.");
      if (metodo !== "GET") {
        // contra pedidos forjados por outros sites: só JSON e só da própria Central
        if (!String(cabecalhos["content-type"] ?? "").includes("application/json")) throw new ErroHttp(415, "Envie os dados em JSON.");
        const origem = cabecalhos.origin;
        if (origem && new URL(origem).host !== cabecalhos.host) throw new ErroHttp(403, "Origem não permitida.");
      }
      const corpo = metodo === "GET" ? {} : await lerCorpo(req).catch((e) => { throw e instanceof ErroHttp ? e : new ErroHttp(400, "Dados inválidos."); });
      const ip = String(cabecalhos["x-forwarded-for"] ?? req.socket?.remoteAddress ?? "").split(",").pop().trim();
      const r = await achada.fn({ m: achada.m, corpo, cabecalhos, ip, seguro, logado });
      responder(res, 200, r.corpo, r.cookie);
    } catch (erro) {
      if (erro instanceof ErroHttp) return responder(res, erro.status, { erro: erro.message, campos: erro.campos });
      if (erro instanceof ErroProvedor) return responder(res, 502, { erro: erro.message });
      console.error(erro);
      responder(res, 500, { erro: "Erro inesperado na Central. Tente de novo." });
    }
  }

  return { tratar, faltando };
}

export { PADRAO_CODIGO };
