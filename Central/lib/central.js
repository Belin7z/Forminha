/* ==========================================================
   CENTRAL DA FORMINHA — a API do seu painel (api/central.js).
   • Clientes: cadastro (dados cifrados), cobrança PIX, confirmação,
     criação automática da loja, e-mails e suporte (lib/clientes.js).
   • Lojas: criar/preparar/publicar/convite/reativar/excluir (lib/lojas.js).
   • Público (sem login): só a página de pagamento, pelo link único.
   • Mercado Pago: aviso de pagamento (conferido na API dele).
   Tudo o que é seu exige a senha da Central (cookie de sessão).
   ========================================================== */
import { ErroProvedor, criarSupabase, criarVercel } from "./provedores.js";
import { PADRAO_CODIGO } from "./codigo.js";
import { EMAIL, ErroHttp } from "./erros.js";
import { criarLojas } from "./lojas.js";
import { criarClientes } from "./clientes.js";
import { ErroCofre, criarCofre } from "./cofre.js";
import { bancoNeon, preparadorDeEsquema } from "./dados.js";
import { criarEmail, modelos } from "./email.js";
import { chavesVencendo, mensagemDeChaveRecusada, textoDoPrazo } from "./chaves.js";
import { criarMercadoPago } from "./mercadopago.js";
import { NOME_COOKIE, cookieDeSaida, cookieDeSessao, criarSessao, lerCookie, lerSessao } from "./sessao.js";
import { criarAcesso } from "./acesso.js";

export { ErroHttp };
const OBRIGATORIAS = ["CENTRAL_SENHA_HASH", "SEGREDO_SESSAO", "SUPABASE_ACCESS_TOKEN", "VERCEL_TOKEN", "FORMINHA_ORG", "DATABASE_URL", "CHAVE_CRIPTOGRAFIA"];
const ID = "([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})";

export function criarCentral(env = process.env, opcoes = {}) {
  const org = String(env.FORMINHA_ORG ?? "").trim();
  const fetchFn = opcoes.fetchFn ?? fetch;
  const urlBase = String(env.URL_CENTRAL || (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : "https://forminha.vercel.app")).replace(/\/+$/, "");
  const sb = opcoes.supabase ?? (env.SUPABASE_ACCESS_TOKEN ? criarSupabase({ token: env.SUPABASE_ACCESS_TOKEN, fetchFn }) : null);
  const vc = opcoes.vercel ?? (env.VERCEL_TOKEN ? criarVercel({ token: env.VERCEL_TOKEN, time: env.VERCEL_TIME, fetchFn }) : null);
  const lojas = sb && vc && org ? criarLojas({
    sb, vc, org, fetchFn,
    repoLoja: env.REPO_LOJA || "Belin7z/Forminha", repoPainel: env.REPO_PAINEL || "Belin7z/Forminha",
    pastaLoja: env.PASTA_LOJA || "Loja", pastaPainel: env.PASTA_PAINEL || "Dashboard",
  }) : null;

  // banco e cofre da Central (clientes): sem eles, as lojas continuam funcionando
  const urlBanco = env.DATABASE_URL || env.POSTGRES_URL;
  const banco = opcoes.banco ?? (urlBanco ? bancoNeon(urlBanco) : null);
  let cofre = null, erroCofre = null;
  try { cofre = env.CHAVE_CRIPTOGRAFIA ? criarCofre(env.CHAVE_CRIPTOGRAFIA) : null; } catch (e) { erroCofre = e.message; }
  const garantirEsquema = banco ? preparadorDeEsquema(banco) : null;
  const email = opcoes.email !== undefined ? opcoes.email : criarEmail({ usuario: env.SMTP_USUARIO, senha: env.SMTP_SENHA, nome: env.EMAIL_NOME || "Forminha" });
  const mp = opcoes.mercadoPago !== undefined ? opcoes.mercadoPago : env.MP_ACCESS_TOKEN ? criarMercadoPago({ token: env.MP_ACCESS_TOKEN, fetchFn }) : null;
  const clientes = banco && cofre && lojas ? criarClientes({
    banco, cofre, lojas, email, mp, urlBase, segredoInterno: env.CRON_SECRET, fetchFn,
    agendar: opcoes.agendar ?? null, orcamentoMs: opcoes.orcamentoMs ?? 40_000, esperaBancoMs: opcoes.esperaBancoMs ?? 4000,
  }) : null;

  const faltando = OBRIGATORIAS.filter((k) => {
    if (k === "SUPABASE_ACCESS_TOKEN" && opcoes.supabase) return false;
    if (k === "VERCEL_TOKEN" && opcoes.vercel) return false;
    if (k === "DATABASE_URL") return !banco;
    return !env[k];
  });
  if (erroCofre) faltando.push("CHAVE_CRIPTOGRAFIA (inválida)");
  const tentativas = new Map(); // freio de senha errada (por endereço, nesta instância)
  const acesso = criarAcesso({ banco, preparar: garantirEsquema ?? undefined, hashInicial: env.CENTRAL_SENHA_HASH, emailInicial: env.CENTRAL_EMAIL });

  const exigirLojas = () => {
    if (!lojas) throw new ErroHttp(503, `A Central ainda não está configurada (falta: ${faltando.join(", ")}). Rode "npm run configurar".`);
  };
  const exigirClientes = async () => {
    exigirLojas();
    if (!clientes) throw new ErroHttp(503, "Falta ligar o banco da Central (Neon) e a chave de criptografia. Veja Configurações.");
    await garantirEsquema();
    return clientes;
  };
  const autorizadoInterno = (cabecalhos) => env.CRON_SECRET && cabecalhos.authorization === `Bearer ${env.CRON_SECRET}`;
  /** Para rotas públicas: se faltar configuração, não conta ao visitante o que falta. */
  const clientesParaPublico = () => exigirClientes().catch((e) => {
    if (e instanceof ErroHttp && e.status === 503) throw new ErroHttp(503, "Página indisponível no momento. Tente de novo mais tarde.");
    throw e;
  });
  const chaveRecusada = (e) => e instanceof ErroProvedor && ["Supabase", "Vercel"].includes(e.quem) && [401, 403].includes(e.status);
  /** Aviso para você (o Gmail da Central): chave vencendo ou recusada. Sem e-mail configurado, fica só o aviso no painel. */
  async function avisarDaChave(linhas) {
    if (!email || !env.SMTP_USUARIO || !linhas.length) return false;
    await email.enviar({ para: env.SMTP_USUARIO, ...modelos.alertaChaves({ linhas, urlCentral: urlBase }) });
    return true;
  }

  /* ---------- rotas: [método, caminho, protegida?, função] ---------- */
  const rotas = [
    ["POST", /^entrar$/, false, async ({ corpo, ip, seguro }) => {
      if (!env.CENTRAL_SENHA_HASH || !env.SEGREDO_SESSAO) throw new ErroHttp(503, 'A senha da Central ainda não foi criada. Rode "npm run configurar".');
      const t = tentativas.get(ip) ?? { n: 0, ate: 0 };
      if (t.ate > Date.now()) throw new ErroHttp(429, `Muitas tentativas. Aguarde ${Math.ceil((t.ate - Date.now()) / 1000)} segundos.`);
      if (!(await acesso.entrar(corpo.usuario ?? corpo.email ?? "", corpo.senha))) {
        t.n += 1;
        if (t.n >= 5) t.ate = Date.now() + 60_000 * Math.min(15, 2 ** (Math.floor(t.n / 5) - 1));
        tentativas.set(ip, t);
        await new Promise((ok) => setTimeout(ok, 400));
        throw new ErroHttp(401, "E-mail (ou usuário) ou senha incorretos.");
      }
      tentativas.delete(ip);
      return { corpo: { ok: true }, cookie: cookieDeSessao(criarSessao(env.SEGREDO_SESSAO, { versao: (await acesso.versao()) ?? 0 }), seguro) };
    }],
    // trocar a senha pelo painel: pede a atual; quem estava logado em outro aparelho sai
    ["POST", /^senha$/, true, async ({ corpo, seguro }) => {
      const versao = await acesso.trocarSenha(corpo);
      return { corpo: { ok: true }, cookie: cookieDeSessao(criarSessao(env.SEGREDO_SESSAO, { versao }), seguro) };
    }],
    ["GET", /^conta$/, true, async () => ({ corpo: await acesso.conta() })],
    ["PUT", /^conta$/, true, async ({ corpo }) => ({ corpo: await acesso.salvarConta(corpo) })],
    ["POST", /^sair$/, false, async ({ seguro }) => ({ corpo: { ok: true }, cookie: cookieDeSaida(seguro) })],
    ["GET", /^eu$/, false, async ({ logado }) => ({
      corpo: {
        logado, simulado: Boolean(opcoes.simulado),
        faltando: logado ? faltando : [],
        chaves: logado ? chavesVencendo(env).map((c) => ({ ...c, texto: textoDoPrazo(c) })) : [],
        recursos: logado ? { clientes: Boolean(clientes), email: Boolean(email), mercado_pago: Boolean(mp), assinatura_mp: Boolean(env.MP_WEBHOOK_SECRET), trocar_senha: Boolean(banco) } : null,
      },
    })],

    /* ---------- clientes ---------- */
    ["GET", /^clientes$/, true, async () => ({ corpo: { clientes: await (await exigirClientes()).listar() } })],
    ["POST", /^clientes$/, true, async ({ corpo }) => ({ corpo: await (await exigirClientes()).cadastrar(corpo) })],
    ["GET", new RegExp(`^clientes/${ID}$`), true, async ({ m }) => ({ corpo: await (await exigirClientes()).detalhe(m[1]) })],
    ["PUT", new RegExp(`^clientes/${ID}$`), true, async ({ m, corpo }) => ({ corpo: await (await exigirClientes()).atualizar(m[1], corpo) })],
    ["POST", new RegExp(`^clientes/${ID}/notas$`), true, async ({ m, corpo }) => ({ corpo: await (await exigirClientes()).anotar(m[1], corpo) })],
    ["POST", new RegExp(`^clientes/${ID}/pagamento-recebido$`), true, async ({ m, corpo }) => ({ corpo: await (await exigirClientes()).confirmarManual(m[1], corpo) })],
    ["POST", new RegExp(`^clientes/${ID}/avancar$`), true, async ({ m }) => {
      const c = await exigirClientes();
      await c.avancar(m[1], { orcamento: 20_000 });
      return { corpo: await c.detalhe(m[1]) };
    }],
    ["POST", new RegExp(`^clientes/${ID}/tentar-de-novo$`), true, async ({ m }) => ({ corpo: await (await exigirClientes()).retomar(m[1]) })],
    ["POST", new RegExp(`^clientes/${ID}/reenviar$`), true, async ({ m, corpo }) => ({ corpo: await (await exigirClientes()).reenviar(m[1], corpo) })],
    ["POST", new RegExp(`^clientes/${ID}/convite$`), true, async ({ m }) => ({ corpo: await (await exigirClientes()).novoConvite(m[1]) })],
    ["POST", new RegExp(`^clientes/${ID}/redefinir-senha$`), true, async ({ m }) => ({ corpo: await (await exigirClientes()).redefinirSenha(m[1]) })],
    ["POST", new RegExp(`^clientes/${ID}/cobrar$`), true, async ({ m }) => ({ corpo: await (await exigirClientes()).cobrarDeNovo(m[1]) })],
    ["POST", new RegExp(`^clientes/${ID}/cancelar$`), true, async ({ m }) => ({ corpo: await (await exigirClientes()).cancelar(m[1]) })],

    ["GET", /^configuracoes$/, true, async () => ({ corpo: await (await exigirClientes()).lerConfig() })],
    ["PUT", /^configuracoes$/, true, async ({ corpo }) => ({ corpo: await (await exigirClientes()).salvarConfig(corpo) })],

    /* ---------- público: página de pagamento (pelo link único) ---------- */
    ["GET", /^publico\/pagamento\/([A-Za-z0-9_-]{20,64})$/, false, async ({ m }) => ({ corpo: await (await clientesParaPublico()).paginaDePagamento(m[1]) })],

    /* ---------- Mercado Pago avisa que um PIX foi pago ---------- */
    ["POST", /^webhook\/mercadopago$/, false, async ({ url, corpo, cabecalhos }) => {
      const c = await clientesParaPublico();
      return { corpo: await c.receberAvisoMercadoPago({ url, corpo, cabecalhos, segredoAssinatura: env.MP_WEBHOOK_SECRET }) };
    }],

    /* ---------- continuação da criação da loja (a própria Central se chama) ---------- */
    ["POST", /^interno\/avancar$/, false, async ({ corpo, cabecalhos }) => {
      if (!autorizadoInterno(cabecalhos)) throw new ErroHttp(401, "Não autorizado.");
      const c = await exigirClientes();
      return { corpo: await c.avancar(String(corpo.id ?? "")).catch((e) => { if (e.status === 404) return { etapa: null }; throw e; }) };
    }],

    /* ---------- lojas ---------- */
    ["GET", /^lojas$/, true, async () => { exigirLojas(); return { corpo: { lojas: await lojas.listar() } }; }],
    ["POST", /^lojas$/, true, async ({ corpo }) => {
      exigirLojas();
      const nome = String(corpo.nome ?? "").replace(/\s+/g, " ").trim();
      const email = String(corpo.email ?? "").trim().toLowerCase();
      const campos = {};
      if (nome.length < 2) campos.nome = "Nome da loja: mínimo de 2 letras.";
      else if (nome.length > 60) campos.nome = "Nome da loja: máximo de 60 letras.";
      if (!EMAIL.test(email)) campos.email = "Informe o e-mail da dona da loja.";
      if (Object.keys(campos).length) throw new ErroHttp(422, Object.values(campos)[0], campos);
      const r = await lojas.criar(nome);
      return { corpo: { ...r, email, etapa: "criando" } };
    }],
    ["GET", /^lojas\/([a-z]+)$/, true, async ({ m }) => { exigirLojas(); return { corpo: await lojas.estado(await lojas.porRef(m[1])) }; }],
    ["POST", /^lojas\/([a-z]+)\/preparar$/, true, async ({ m, corpo }) => { exigirLojas(); return { corpo: await lojas.prepararPasso(await lojas.porRef(m[1]), corpo.email) }; }],
    ["POST", /^lojas\/([a-z]+)\/publicar$/, true, async ({ m }) => { exigirLojas(); return { corpo: await lojas.publicar(await lojas.porRef(m[1])) }; }],
    ["POST", /^lojas\/([a-z]+)\/convite$/, true, async ({ m, corpo }) => { exigirLojas(); return { corpo: await lojas.convite(await lojas.porRef(m[1]), corpo.email) }; }],
    ["POST", /^lojas\/([a-z]+)\/reativar$/, true, async ({ m }) => { exigirLojas(); await lojas.reativar(await lojas.porRef(m[1])); return { corpo: { etapa: "reativando" } }; }],
    ["DELETE", /^lojas\/([a-z]+)$/, true, async ({ m, corpo }) => { exigirLojas(); return { corpo: { ok: true, ...(await lojas.excluir(await lojas.porRef(m[1]), corpo.codigo)) } }; }],

    // todo dia (Vercel Cron): lojas grátis não pausam; criações paradas no meio são retomadas
    ["GET", /^manter-ativo$/, false, async ({ cabecalhos }) => {
      if (!autorizadoInterno(cabecalhos)) throw new ErroHttp(401, "Não autorizado.");
      exigirLojas();
      let resultado;
      try { resultado = await lojas.manterAtivas(); }
      catch (e) {
        if (chaveRecusada(e)) await avisarDaChave([mensagemDeChaveRecusada(e.quem, e.status)]).catch(() => {});
        throw e;
      }
      if (clientes) { await garantirEsquema(); resultado.criacoes_retomadas = await clientes.retomarParadas(); }
      // chave perto de vencer: um e-mail 15 dias antes e todo dia na última semana
      const vencendo = chavesVencendo(env).filter((c) => c.dias <= 7 || c.dias === 15);
      resultado.aviso_de_chave = await avisarDaChave(vencendo.map(textoDoPrazo)).catch(() => false);
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
    let logado = false;
    try {
      const url = new URL(req.url, "http://central");
      const rota = (url.searchParams.get("rota") ?? url.pathname.replace(/^\/api\/?/, "")).replace(/^\/+|\/+$/g, "");
      const metodo = req.method;
      const cabecalhos = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v[0] : v]));
      const seguro = cabecalhos["x-forwarded-proto"] === "https" || !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(cabecalhos.host ?? "");
      const sessao = lerSessao(lerCookie(cabecalhos.cookie, NOME_COOKIE), env.SEGREDO_SESSAO);
      if (sessao) {
        const versao = await acesso.versao(); // null = banco fora do ar: não derruba quem já entrou
        logado = versao === null || sessao.v === versao;
      }

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
      const r = await achada.fn({ m: achada.m, url, corpo, cabecalhos, ip, seguro, logado });
      responder(res, 200, r.corpo, r.cookie);
    } catch (erro) {
      if (erro instanceof ErroHttp) return responder(res, erro.status, { erro: erro.message, campos: erro.campos });
      // chave vencida ou sem permissão: para você, diz o que fazer; para visitantes, nada muda
      if (erro instanceof ErroProvedor) return responder(res, 502, { erro: logado && chaveRecusada(erro) ? mensagemDeChaveRecusada(erro.quem, erro.status) : erro.message });
      if (erro instanceof ErroCofre) { console.error("[cofre]", erro.message); return responder(res, 500, { erro: "Não foi possível abrir os dados protegidos (confira a CHAVE_CRIPTOGRAFIA)." }); }
      console.error(erro);
      responder(res, 500, { erro: "Erro inesperado na Central. Tente de novo." });
    }
  }

  return { tratar, faltando };
}

export { PADRAO_CODIGO };
