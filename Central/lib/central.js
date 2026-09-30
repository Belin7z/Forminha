/* ==========================================================
   CENTRAL DA FORMINHA — a API do seu painel (api/central.js).
   • Clientes: cadastro (dados cifrados), cobrança PIX, confirmação,
     criação automática da loja, e-mails e suporte (lib/clientes.js).
   • Lojas: criar/preparar/publicar/convite/reativar/excluir (lib/lojas.js).
   • Equipe: funcionários com usuário próprio (FMV-0427) e função
     (gerente, vendedor, suporte, financeiro); cada rota diz qual
     permissão precisa, e as ações ficam registradas (lib/equipe.js).
   • Público (sem login): só a página de pagamento, pelo link único.
   • Mercado Pago: aviso de pagamento (conferido na API dele).
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
import { FUNCOES, PERMISSOES, TODAS, criarEquipe, lerUsuario } from "./equipe.js";
import { comAutor } from "./autoria.js";
import { criarAvisos } from "./avisos.js";
import { criarCupons } from "./cupons.js";
import { criarProtecao } from "./protecao.js";
import { criarDuasEtapas } from "./duasetapas.js";
import { criarDominioCentral } from "./dominio-central.js";
import { criarBancoUnico } from "./banco-unico.js";
import { createHmac, timingSafeEqual } from "node:crypto";

export { ErroHttp };
const OBRIGATORIAS = ["CENTRAL_SENHA_HASH", "SEGREDO_SESSAO", "SUPABASE_ACCESS_TOKEN", "VERCEL_TOKEN", "FORMINHA_ORG", "DATABASE_URL", "CHAVE_CRIPTOGRAFIA"];
const ID = "([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})";
// com senha temporária, o funcionário só consegue criar a própria senha (e sair)
const LIVRES_NA_TROCA = new Set(["eu", "sair", "minha-senha"]);
const TABELAS_DA_CENTRAL = ["clientes", "pagamentos", "historico", "configuracoes", "funcionarios", "atividades", "avisos", "cupons", "duas_etapas"];

export function criarCentral(env = process.env, opcoes = {}) {
  const org = String(env.FORMINHA_ORG ?? "").trim();
  const fetchFn = opcoes.fetchFn ?? fetch;
  const urlInicial = String(env.URL_CENTRAL || (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : "https://forminha.vercel.app")).replace(/\/+$/, "");
  // o endereço dos links (pagamento, e-mails): passa a ser o domínio da Forminha quando ele funcionar (sem URL_CENTRAL fixa)
  let urlBase = urlInicial;
  const sb = opcoes.supabase ?? (env.SUPABASE_ACCESS_TOKEN ? criarSupabase({ token: env.SUPABASE_ACCESS_TOKEN, fetchFn }) : null);
  const vc = opcoes.vercel ?? (env.VERCEL_TOKEN ? criarVercel({ token: env.VERCEL_TOKEN, time: env.VERCEL_TIME, fetchFn }) : null);

  // banco e cofre da Central (clientes e equipe): sem eles, as lojas continuam funcionando
  const urlBanco = env.DATABASE_URL || env.POSTGRES_URL;
  const banco = opcoes.banco ?? (urlBanco ? bancoNeon(urlBanco) : null);
  let cofre = null, erroCofre = null;
  try { cofre = env.CHAVE_CRIPTOGRAFIA ? criarCofre(env.CHAVE_CRIPTOGRAFIA) : null; } catch (e) { erroCofre = e.message; }
  const garantirEsquema = banco ? preparadorDeEsquema(banco) : null;

  // domínio da Forminha (ex.: forminha.com.br): a Central na raiz e as lojas embaixo dele
  const dominioCentral = banco && vc ? criarDominioCentral({
    banco, preparar: garantirEsquema, vc, projeto: env.VERCEL_PROJECT_ID || env.PROJETO_VERCEL || "forminha", fetchFn,
  }) : null;
  let dominioLidoEm = 0;
  async function atualizarEndereco() {
    if (!dominioCentral || env.URL_CENTRAL || Date.now() - dominioLidoEm < 60_000) return;
    dominioLidoEm = Date.now();
    const cfg = await dominioCentral.ler().catch(() => undefined);
    if (cfg !== undefined) urlBase = cfg?.ativo_em ? `https://${cfg.raiz}` : urlInicial;
  }
  const sites = {
    repoLoja: env.REPO_LOJA || "Belin7z/Forminha", repoPainel: env.REPO_PAINEL || "Belin7z/Forminha",
    pastaLoja: env.PASTA_LOJA || "Loja", pastaPainel: env.PASTA_PAINEL || "Dashboard",
  };
  // banco único: todas as lojas num projeto Supabase só (preparado uma vez, em Configurações)
  // e-mails do login das lojas: pelo e-mail profissional (Resend), quando ligado
  const emailLogin = { resend: env.RESEND_API_KEY, remetente: env.EMAIL_REMETENTE, nome: env.EMAIL_NOME || "Forminha" };
  const bancoUnico = banco && cofre && sb && vc && org ? criarBancoUnico({
    sb, vc, org, cofre, emailLogin, site: { ...sites, urlCentral: () => urlBase },
    lerConfig: async () => {
      await garantirEsquema();
      const [l] = await banco.consultar("select valor from configuracoes where chave = 'banco_unico'");
      return l?.valor ?? null;
    },
    gravarConfig: (v) => banco.consultar(`insert into configuracoes (chave, valor) values ('banco_unico', $1::jsonb)
      on conflict (chave) do update set valor = excluded.valor`, [JSON.stringify(v)]),
  }) : null;
  const lojas = sb && vc && org ? criarLojas({
    sb, vc, org, fetchFn, ...sites, urlCentral: () => urlBase, unico: bancoUnico, emailLogin,
    // loja que mudou para o banco único: o cadastro da cliente acompanha (o ref vira o código; os endereços podem mudar)
    aoMudarDeBanco: async (refAntigo, loja, enderecos) => {
      if (!clientes) return;
      await clientes.trocarLoja(refAntigo, loja.ref);
      await clientes.atualizarEnderecos(loja.ref, enderecos);
    },
    baseDasLojas: dominioCentral ? async () => {
      const cfg = await dominioCentral.ler();
      return cfg ? { raiz: cfg.raiz, pronta: Boolean(cfg.coringa_em) } : null;
    } : null,
  }) : null;
  // e-mail profissional (Resend, do seu domínio) e/ou Gmail; as respostas das clientes vão para EMAIL_RESPONDER (ou o Gmail)
  const email = opcoes.email !== undefined ? opcoes.email : criarEmail({
    usuario: env.SMTP_USUARIO, senha: env.SMTP_SENHA, nome: env.EMAIL_NOME || "Forminha",
    resend: env.RESEND_API_KEY, remetente: env.EMAIL_REMETENTE, responderPara: env.EMAIL_RESPONDER || env.SMTP_USUARIO, fetchFn,
  });
  const mp = opcoes.mercadoPago !== undefined ? opcoes.mercadoPago : env.MP_ACCESS_TOKEN ? criarMercadoPago({ token: env.MP_ACCESS_TOKEN, fetchFn }) : null;
  const avisos = banco ? criarAvisos({ banco, preparar: garantirEsquema }) : null; // o sino da Central
  const cupons = banco ? criarCupons({ banco, preparar: garantirEsquema }) : null; // cupons de desconto e indicação
  const clientes = banco && cofre && lojas ? criarClientes({
    banco, cofre, lojas, email, mp, urlBase: () => urlBase, segredoInterno: env.CRON_SECRET, fetchFn,
    agendar: opcoes.agendar ?? null, orcamentoMs: opcoes.orcamentoMs ?? 40_000, esperaBancoMs: opcoes.esperaBancoMs ?? 4000,
    avisar: avisos ? (dados) => avisos.registrar(dados) : undefined, cupons,
  }) : null;
  const equipe = banco && cofre ? criarEquipe({ banco, cofre, preparar: garantirEsquema }) : null;

  const faltando = OBRIGATORIAS.filter((k) => {
    if (k === "SUPABASE_ACCESS_TOKEN" && opcoes.supabase) return false;
    if (k === "VERCEL_TOKEN" && opcoes.vercel) return false;
    if (k === "DATABASE_URL") return !banco;
    return !env[k];
  });
  if (erroCofre) faltando.push("CHAVE_CRIPTOGRAFIA (inválida)");
  const acesso = criarAcesso({ banco, preparar: garantirEsquema ?? undefined, hashInicial: env.CENTRAL_SENHA_HASH, emailInicial: env.CENTRAL_EMAIL });
  // senha errada muitas vezes: bloqueia por um tempo (no banco, vale para todas as cópias da Central)
  const protecao = criarProtecao({ banco, preparar: garantirEsquema ?? undefined });
  // verificação em duas etapas (código do aplicativo no celular), para o dono e a equipe
  const duas = banco && cofre ? criarDuasEtapas({ banco, cofre, preparar: garantirEsquema, marcaDono: acesso.marca }) : null;

  /* segunda etapa do login: um "desafio" assinado (vale 5 min) diz quem já acertou a senha; não serve como sessão */
  const chaveDesafio = () => `${env.SEGREDO_SESSAO}:desafio`;
  function assinarDesafio(quem, versao) {
    const corpo = Buffer.from(JSON.stringify({ u: quem.id, v: versao, exp: Math.floor(Date.now() / 1000) + 300 })).toString("base64url");
    return `${corpo}.${createHmac("sha256", chaveDesafio()).update(corpo).digest("base64url")}`;
  }
  function lerDesafio(texto) {
    const [corpo, assinatura] = String(texto ?? "").split(".");
    if (!corpo || !assinatura) return null;
    const esperado = Buffer.from(createHmac("sha256", chaveDesafio()).update(corpo).digest("base64url"));
    const recebido = Buffer.from(assinatura);
    if (esperado.length !== recebido.length || !timingSafeEqual(esperado, recebido)) return null;
    try { const d = JSON.parse(Buffer.from(corpo, "base64url").toString()); return d.exp > Date.now() / 1000 ? d : null; } catch { return null; }
  }

  /* ---------- quem está usando ---------- */
  const DONO = { tipo: "dono", id: "dono", usuario: "Dono", nome: "Dono", funcao: "dono", funcao_nome: "Dono", trocar_senha: false, permissoes: TODAS };
  const comoFuncionario = (f) => ({ tipo: "funcionario", ...f, permissoes: FUNCOES[f.funcao].permissoes });
  /** Como aparece no histórico da cliente e nas atividades. */
  const rotulo = (quem) => (quem.tipo === "dono" ? "Dono" : `${quem.usuario} · ${String(quem.nome).split(" ")[0]}`);

  async function identificar(sessao) {
    if (!sessao) return null;
    if (sessao.u === "dono") {
      const versao = await acesso.versao(); // null = banco fora do ar: não derruba quem já entrou
      return versao === null || sessao.v === versao ? DONO : null;
    }
    if (!equipe) return null;
    try {
      const f = await equipe.daSessao(sessao.u, sessao.v);
      return f ? comoFuncionario(f) : null;
    } catch (e) { console.error("[equipe]", e.message); return null; }
  }
  const cookieDe = (quem, versao, seguro) => cookieDeSessao(criarSessao(env.SEGREDO_SESSAO, { versao, quem: quem.id }), seguro);

  const exigirLojas = () => {
    if (!lojas) throw new ErroHttp(503, `A Central ainda não está configurada (falta: ${faltando.join(", ")}). Rode "npm run configurar".`);
  };
  const exigirClientes = async () => {
    exigirLojas();
    if (!clientes) throw new ErroHttp(503, "Falta ligar o banco da Central (Neon) e a chave de criptografia. Veja Configurações.");
    await garantirEsquema();
    return clientes;
  };
  const exigirEquipe = () => {
    if (!equipe) throw new ErroHttp(503, "Para ter equipe, ligue o banco da Central e a criptografia (veja Configurações).");
    return equipe;
  };
  const exigirCupons = () => {
    if (!cupons) throw new ErroHttp(503, "Para ter cupons, ligue o banco da Central (veja Configurações).");
    return cupons;
  };
  const autorizadoInterno = (cabecalhos) => env.CRON_SECRET && cabecalhos.authorization === `Bearer ${env.CRON_SECRET}`;
  /** Para rotas públicas: se faltar configuração, não conta ao visitante o que falta. */
  const clientesParaPublico = () => exigirClientes().catch((e) => {
    if (e instanceof ErroHttp && e.status === 503) throw new ErroHttp(503, "Página indisponível no momento. Tente de novo mais tarde.");
    throw e;
  });
  const chaveRecusada = (e) => e instanceof ErroProvedor && ["Supabase", "Vercel"].includes(e.quem) && [401, 403].includes(e.status);
  /** Para onde vão os alertas para você: o Gmail da Central, o e-mail de respostas ou o e-mail da sua conta. */
  async function emailDoDono() {
    if (env.SMTP_USUARIO || env.EMAIL_RESPONDER) return env.SMTP_USUARIO || env.EMAIL_RESPONDER;
    const conta = await acesso.conta().catch(() => null);
    return conta?.email || env.CENTRAL_EMAIL || null;
  }
  /** Aviso para você: chave vencendo ou recusada. Sem e-mail configurado, fica só o aviso no painel. */
  async function avisarDaChave(linhas) {
    const para = email && linhas.length ? await emailDoDono() : null;
    if (!para) return false;
    await email.enviar({ para, ...modelos.alertaChaves({ linhas, urlCentral: urlBase }) });
    return true;
  }

  /**
   * Algo deu errado: aviso no sino do dono e e-mail para você. Erros iguais são juntados
   * (um aviso a cada 30 min; no máximo um e-mail a cada 6 h por tipo de erro).
   */
  const ultimoAlerta = new Map();
  async function alertarErro(titulo, detalhe) {
    if (!avisos || !banco) return;
    if (Date.now() - (ultimoAlerta.get(titulo) ?? 0) < 30 * 60_000) return;
    ultimoAlerta.set(titulo, Date.now());
    try {
      const [recente] = await banco.consultar("select 1 from avisos where tipo = 'erro' and titulo = $1 and em > now() - interval '30 minutes' limit 1", [titulo]);
      if (recente) return;
      await avisos.registrar({ tipo: "erro", titulo, texto: String(detalhe).slice(0, 280), permissao: "dono" });
      const para = email ? await emailDoDono() : null;
      if (!para) return;
      const [enviados] = await banco.consultar("select valor from configuracoes where chave = 'alerta_email'");
      if (Date.now() - Number(enviados?.valor?.[titulo] ?? 0) < 6 * 3_600_000) return;
      await banco.consultar(`insert into configuracoes (chave, valor) values ('alerta_email', $1::jsonb)
        on conflict (chave) do update set valor = configuracoes.valor || excluded.valor`, [JSON.stringify({ [titulo]: Date.now() })]);
      await email.enviar({ para, ...modelos.alertaErro({ titulo, detalhe: String(detalhe).slice(0, 500), urlCentral: urlBase }) });
    } catch (e) { console.error("[alerta]", e.message); }
  }

  /**
   * Chamada do painel de uma loja: a dona manda o login dela (o token do Supabase da loja). Daí sai a loja
   * (o endereço do Supabase que emitiu o token) e o próprio banco da loja confirma que ela é administradora.
   */
  async function lojaDaDona(cabecalhos) {
    exigirLojas();
    const jwt = /^Bearer\s+(\S+)$/i.exec(cabecalhos.authorization ?? "")?.[1];
    let ref = null;
    try {
      const carga = JSON.parse(Buffer.from(String(jwt).split(".")[1], "base64url").toString());
      ref = /^https:\/\/([a-z]{20})\.supabase\.co\/auth\/v1$/.exec(String(carga.iss))?.[1] ?? null;
    } catch { /* token estranho */ }
    if (!ref) throw new ErroHttp(401, "Entre no painel da sua loja para continuar.");
    // banco único: o token é do banco de todas as lojas; a loja vem do endereço do painel (cabeçalho x-loja)
    const unico = bancoUnico ? await bancoUnico.pronto().catch(() => null) : null;
    const loja = unico?.ref === ref ? await lojas.porEndereco(cabecalhos["x-loja"]) : await lojas.porRef(ref);
    if (!loja) throw new ErroHttp(401, "Entre no painel da sua loja para continuar.");
    await lojas.conferirDona(loja, jwt);
    return loja;
  }
  const registrarDaDona = (loja, acao) => equipe?.registrar({ quem: `loja:${loja.ref}`, usuario: "Dona da loja", acao, alvo: loja.nome }).catch(() => {});
  /** O endereço da loja mudou (domínio próprio): o cadastro da cliente acompanha. */
  async function acompanharEnderecos(loja, r) {
    if (!r.mudou || !clientes) return;
    try { await (await exigirClientes()).atualizarEnderecos(loja.ref, { loja: r.endereco_loja, painel: r.endereco_painel }); }
    catch (e) { console.error("[enderecos]", e.message); }
  }
  /** Domínio próprio: as mesmas ações servem para você (pela Central) e para a dona (pelo painel dela). */
  const acoesDeDominio = {
    ver: async (loja) => { const r = await lojas.dominio(loja); await acompanharEnderecos(loja, r); return r; },
    ligar: async (loja, corpo) => { const r = await lojas.definirDominio(loja, corpo); await acompanharEnderecos(loja, r); return r; },
    conferir: async (loja) => { const r = await lojas.conferirDominio(loja); await acompanharEnderecos(loja, r); return r; },
    tirar: async (loja) => { const r = await lojas.removerDominio(loja); await acompanharEnderecos(loja, r); return r; },
  };
  /** Endereço na Forminha (anadoces.forminha.com.br): mesmo jeito, só pela Central. */
  const acoesDeSub = {
    ver: async (loja) => { const r = await lojas.subdominio(loja); await acompanharEnderecos(loja, r); return r; },
    ligar: async (loja, corpo) => { const r = await lojas.definirSubdominio(loja, corpo); await acompanharEnderecos(loja, r); return r; },
    conferir: async (loja) => { const r = await lojas.conferirSubdominio(loja); await acompanharEnderecos(loja, r); return r; },
    tirar: async (loja) => { const r = await lojas.removerSubdominio(loja); await acompanharEnderecos(loja, r); return r; },
  };
  const exigirDominioCentral = () => {
    if (!dominioCentral) throw new ErroHttp(503, "Para ter domínio próprio, ligue o banco da Central e a chave da Vercel (veja Configurações).");
    return dominioCentral;
  };
  /** Mexeu no domínio da Forminha: os links passam a usar o endereço certo já na próxima requisição. */
  const reler = (r) => { if (r.mudou) dominioLidoEm = 0; return r; };

  /* ----------------------------------------------------------
     rotas: [método, caminho, quem pode, função, atividade]
       quem pode: false = público · true = qualquer pessoa logada ·
       "dono" = só você · outro texto = a permissão (ver PERMISSOES)
       atividade: o que fica registrado (texto ou função que devolve [texto, alvo])
     ---------------------------------------------------------- */
  const rotas = [
    ["POST", /^entrar$/, false, async ({ corpo, ip, seguro }) => {
      if (!env.CENTRAL_SENHA_HASH || !env.SEGREDO_SESSAO) throw new ErroHttp(503, 'A senha da Central ainda não foi criada. Rode "npm run configurar".');
      const identificador = String(corpo.usuario ?? corpo.email ?? "");
      const chaves = [`ip:${ip}`, `conta:${identificador.trim().toLowerCase().slice(0, 120)}`];
      await protecao.conferir(chaves);
      let quem = null, versao = 0;
      if (lerUsuario(identificador)) { // FM?-0000: alguém da equipe
        const f = equipe ? await equipe.entrar(identificador, corpo.senha) : null;
        if (f) { quem = comoFuncionario(f); versao = f.versao; }
      } else if (await acesso.entrar(identificador, corpo.senha)) {
        quem = DONO;
        versao = (await acesso.versao()) ?? 0;
      }
      if (!quem) {
        await protecao.falhou(chaves);
        await new Promise((ok) => setTimeout(ok, 400));
        throw new ErroHttp(401, "E-mail (ou usuário) ou senha incorretos.");
      }
      await protecao.acertou(chaves);
      // com a verificação em duas etapas ligada, a senha certa ainda não basta: falta o código do celular
      if (duas && (await duas.ligada(quem).catch(() => false))) return { corpo: { etapa: "codigo", desafio: assinarDesafio(quem, versao) } };
      if (equipe) await equipe.registrar({ quem: quem.id, usuario: quem.usuario, acao: "Entrou" }).catch(() => {});
      return { corpo: { ok: true, trocar_senha: Boolean(quem.trocar_senha) }, cookie: cookieDe(quem, versao, seguro) };
    }],
    ["POST", /^entrar\/codigo$/, false, async ({ corpo, ip, seguro }) => {
      const d = lerDesafio(corpo.desafio);
      const quem = d ? await identificar({ u: d.u, v: d.v }) : null;
      if (!quem || !duas) throw new ErroHttp(401, "O tempo para digitar o código acabou. Entre de novo.");
      const chaves = [`codigo:${quem.id}`, `ip:${ip}`];
      await protecao.conferir(chaves);
      const como = await duas.conferirCodigo(quem, corpo.codigo);
      if (!como) {
        await protecao.falhou(chaves);
        throw new ErroHttp(401, "Código incorreto.", { codigo: "Código incorreto. Use o código que está aparecendo agora no aplicativo." });
      }
      await protecao.acertou(chaves);
      if (equipe) await equipe.registrar({ quem: quem.id, usuario: quem.usuario, acao: como === "reserva" ? "Entrou com um código de reserva" : "Entrou" }).catch(() => {});
      const reservas = como === "reserva" ? (await duas.estado(quem)).reservas : null;
      return { corpo: { ok: true, trocar_senha: Boolean(quem.trocar_senha), reservas_restantes: reservas }, cookie: cookieDe(quem, d.v, seguro) };
    }],

    /* ---------- esqueci a senha (só o dono: a equipe pede ao dono uma senha nova) ---------- */
    ["POST", /^senha\/esqueci$/, false, async ({ corpo, ip }) => {
      const chaves = [`esqueci:${ip}`];
      await protecao.conferir(chaves);
      await protecao.falhou(chaves); // cada pedido conta: freia quem tenta muitas vezes
      if (!email || !banco) throw new ErroHttp(503, 'O e-mail da Central não está configurado. No computador, rode "npm run configurar" (opção 7) para criar uma senha nova.');
      const token = await acesso.pedirRecuperacao(corpo.email);
      if (token) await email.enviar({ para: String(corpo.email).trim().toLowerCase(), ...modelos.recuperarCentral({ link: `${urlBase}/#/nova-senha/${token}` }) });
      return { corpo: { ok: true, mensagem: "Se esse for o e-mail da conta, o link chega em instantes (confira também o spam)." } };
    }],
    ["POST", /^senha\/nova$/, false, async ({ corpo, ip }) => {
      const chaves = [`nova-senha:${ip}`];
      await protecao.conferir(chaves);
      try { return { corpo: await acesso.recuperar(corpo) }; }
      catch (e) { if (e.status === 410) await protecao.falhou(chaves); throw e; }
    }],

    /* ---------- verificação em duas etapas (cada pessoa liga a sua) ---------- */
    ["GET", /^seguranca$/, true, async ({ quem }) => ({ corpo: { duas_etapas: duas ? await duas.estado(quem) : null } })],
    ["POST", /^seguranca\/duas-etapas\/iniciar$/, true, async ({ quem }) => {
      if (!duas) throw new ErroHttp(503, "Ligue o banco e a criptografia da Central para usar a verificação em duas etapas.");
      const conta = quem.tipo === "dono" ? (await acesso.conta()).email || "dono" : quem.usuario;
      return { corpo: await duas.iniciar(quem, conta) };
    }],
    ["POST", /^seguranca\/duas-etapas\/ativar$/, true, async ({ quem, corpo }) => {
      if (!duas) throw new ErroHttp(503, "Verificação em duas etapas indisponível.");
      return { corpo: await duas.ativar(quem, corpo.codigo) };
    }, "Ligou a verificação em duas etapas"],
    ["POST", /^seguranca\/duas-etapas\/desligar$/, true, async ({ quem, corpo }) => {
      if (!duas) throw new ErroHttp(503, "Verificação em duas etapas indisponível.");
      const senhaOk = quem.tipo === "dono" ? await acesso.conferirSenhaDono(corpo.senha) : await exigirEquipe().conferirSenhaDe(quem.id, corpo.senha);
      if (!senhaOk) throw new ErroHttp(422, "Senha incorreta.", { senha: "Senha incorreta." });
      if (!(await duas.conferirCodigo(quem, corpo.codigo))) throw new ErroHttp(422, "Código incorreto.", { codigo: "Código incorreto." });
      return { corpo: await duas.desligar(quem) };
    }, "Desligou a verificação em duas etapas"],
    ["POST", /^sair$/, false, async ({ seguro }) => ({ corpo: { ok: true }, cookie: cookieDeSaida(seguro) })],
    ["GET", /^eu$/, false, async ({ quem }) => {
      const dono = quem?.tipo === "dono";
      const conta = dono ? await acesso.conta().catch(() => null) : null;
      return {
        corpo: {
          logado: Boolean(quem), simulado: Boolean(opcoes.simulado),
          quem: quem ? {
            tipo: quem.tipo, usuario: dono ? conta?.usuario || conta?.email || "" : quem.usuario, nome: dono ? conta?.nome || "" : quem.nome,
            funcao: quem.funcao, funcao_nome: quem.funcao_nome, trocar_senha: quem.trocar_senha,
          } : null,
          permissoes: quem ? quem.permissoes : [],
          faltando: dono ? faltando : [],
          chaves: dono ? chavesVencendo(env).map((c) => ({ ...c, texto: textoDoPrazo(c) })) : [],
          recursos: quem ? {
            clientes: Boolean(clientes), email: Boolean(email), email_provedor: email?.provedor ?? null, email_reserva: email?.reserva ?? null,
            mercado_pago: Boolean(mp), assinatura_mp: Boolean(env.MP_WEBHOOK_SECRET),
            trocar_senha: Boolean(banco), equipe: Boolean(equipe), dominio: Boolean(dominioCentral), banco_unico: Boolean(bancoUnico),
          } : null,
        },
      };
    }],

    /* ---------- sua conta (dono) ---------- */
    // trocar a senha pelo painel: pede a atual; quem estava logado em outro aparelho sai
    ["POST", /^senha$/, "dono", async ({ corpo, seguro }) => {
      const versao = await acesso.trocarSenha(corpo);
      return { corpo: { ok: true }, cookie: cookieDe(DONO, versao, seguro) };
    }, "Trocou a senha"],
    ["GET", /^conta$/, "dono", async () => ({ corpo: await acesso.conta() })],
    ["PUT", /^perfil$/, "dono", async ({ corpo }) => ({ corpo: await acesso.salvarNome(corpo.nome) }), "Alterou o nome do perfil"],
    ["PUT", /^conta$/, "dono", async ({ corpo }) => ({ corpo: await acesso.salvarConta(corpo) }), "Alterou a conta"],

    /* ---------- a própria senha (funcionário) ---------- */
    ["POST", /^minha-senha$/, true, async ({ quem, corpo, seguro }) => {
      if (quem.tipo !== "funcionario") throw new ErroHttp(404, "Use Configurações → Senha de acesso.");
      const f = await exigirEquipe().trocarMinhaSenha(quem.id, corpo);
      return { corpo: { ok: true }, cookie: cookieDe(quem, f.versao, seguro) };
    }, ({ quem }) => [quem.trocar_senha ? "Criou a senha" : "Trocou a senha"]],

    /* ---------- clientes ---------- */
    ["GET", /^clientes$/, "clientes.ver", async () => ({ corpo: { clientes: await (await exigirClientes()).listar() } })],
    ["POST", /^clientes$/, "clientes.cadastrar", async ({ corpo }) => ({ corpo: await (await exigirClientes()).cadastrar(corpo) }), "Cadastrou cliente"],
    ["GET", new RegExp(`^clientes/${ID}$`), "clientes.ver", async ({ m }) => ({ corpo: await (await exigirClientes()).detalhe(m[1]) })],
    ["PUT", new RegExp(`^clientes/${ID}$`), "clientes.editar", async ({ m, corpo }) => ({ corpo: await (await exigirClientes()).atualizar(m[1], corpo) }), "Editou cliente"],
    ["POST", new RegExp(`^clientes/${ID}/notas$`), "clientes.notas", async ({ m, corpo }) => ({ corpo: await (await exigirClientes()).anotar(m[1], corpo) }), "Anotou na ficha"],
    ["POST", new RegExp(`^clientes/${ID}/pagamento-recebido$`), "pagamentos.confirmar", async ({ m, corpo }) => ({ corpo: await (await exigirClientes()).confirmarManual(m[1], corpo) }), "Confirmou pagamento"],
    ["POST", new RegExp(`^clientes/${ID}/avancar$`), "clientes.ver", async ({ m }) => {
      const c = await exigirClientes();
      await c.avancar(m[1], { orcamento: 20_000 });
      return { corpo: await c.detalhe(m[1]) };
    }],
    ["POST", new RegExp(`^clientes/${ID}/tentar-de-novo$`), "lojas.suporte", async ({ m }) => ({ corpo: await (await exigirClientes()).retomar(m[1]) }), "Retomou a criação"],
    ["POST", new RegExp(`^clientes/${ID}/reenviar$`), true, async ({ m, corpo, quem }) => {
      // reenviar a cobrança é de quem cobra; reenviar o convite, de quem dá suporte
      const precisa = corpo.tipo === "cobranca" ? "pagamentos.cobrar" : "lojas.suporte";
      if (!quem.permissoes.includes(precisa)) throw new ErroHttp(403, "Sua função não permite fazer isso.");
      return { corpo: await (await exigirClientes()).reenviar(m[1], corpo) };
    }, ({ corpo }) => [corpo.tipo === "cobranca" ? "Reenviou cobrança" : "Reenviou convite"]],
    ["POST", new RegExp(`^clientes/${ID}/convite$`), "lojas.suporte", async ({ m }) => ({ corpo: await (await exigirClientes()).novoConvite(m[1]) }), "Gerou link de acesso"],
    ["POST", new RegExp(`^clientes/${ID}/redefinir-senha$`), "lojas.suporte", async ({ m }) => ({ corpo: await (await exigirClientes()).redefinirSenha(m[1]) }), "Redefiniu senha da dona"],
    ["POST", new RegExp(`^clientes/${ID}/cobrar$`), "pagamentos.cobrar", async ({ m }) => ({ corpo: await (await exigirClientes()).cobrarDeNovo(m[1]) }), "Gerou cobrança"],
    ["POST", new RegExp(`^clientes/${ID}/cancelar$`), "pagamentos.cancelar", async ({ m }) => ({ corpo: await (await exigirClientes()).cancelar(m[1]) }), "Cancelou cadastro"],

    /* ---------- visão geral e pagamentos ---------- */
    ["GET", /^resumo$/, true, async ({ quem }) => {
      const r = await (await exigirClientes()).visaoGeral({ financeiro: quem.permissoes.includes("financeiro.ver") });
      if (quem.permissoes.includes("equipe") && equipe) r.atividades = await equipe.atividades({ limite: 6 });
      return { corpo: r };
    }],
    ["GET", /^vendas$/, "financeiro.ver", async ({ url }) => {
      const q = url.searchParams;
      return { corpo: await (await exigirClientes()).vendas({ de: q.get("de"), ate: q.get("ate"), agrupar: q.get("agrupar") }) };
    }],
    ["GET", /^pagamentos$/, "financeiro.ver", async ({ url }) => ({ corpo: await (await exigirClientes()).listarPagamentos({ situacao: url.searchParams.get("situacao") ?? "" }) })],

    /* ---------- o sino (avisos na hora) e as metas do mês ---------- */
    ["GET", /^avisos$/, true, async ({ quem }) => ({ corpo: avisos ? await avisos.listar(quem) : { avisos: [], nao_vistos: 0, ultimo: 0 } })],
    ["POST", /^avisos\/vistos$/, true, async ({ quem, corpo }) => ({ corpo: avisos ? await avisos.marcarVistos(quem, corpo.ate) : { ok: true } })],
    ["GET", /^metas$/, "financeiro.ver", async () => ({ corpo: await (await exigirClientes()).lerMetas() })],
    /* ---------- cupons e indicação ---------- */
    ["GET", /^cupons$/, "configuracoes", async () => ({ corpo: await exigirCupons().listar() })],
    ["POST", /^cupons$/, "configuracoes", async ({ corpo }) => { const c = await exigirCupons().criar(corpo); return { corpo: c, alvo: c.codigo }; }, "Criou cupom"],
    ["PUT", new RegExp(`^cupons/${ID}$`), "configuracoes", async ({ m, corpo }) => { const c = await exigirCupons().editar(m[1], corpo); return { corpo: c, alvo: c.codigo }; }, "Alterou cupom"],
    ["DELETE", new RegExp(`^cupons/${ID}$`), "configuracoes", async ({ m }) => ({ corpo: await exigirCupons().excluir(m[1]) }), "Apagou cupom"],
    ["PUT", /^indicacao$/, "configuracoes", async ({ corpo }) => ({ corpo: await exigirCupons().salvarIndicacao(corpo) }), "Alterou a indicação"],
    ["GET", /^cupons\/conferir$/, "clientes.cadastrar", async ({ url }) => ({
      corpo: await exigirCupons().conferir(url.searchParams.get("codigo"), Math.round(Number(url.searchParams.get("valor")) || 0)),
    })],
    ["POST", new RegExp(`^clientes/${ID}/indicacao$`), "clientes.ver", async ({ m }) => ({ corpo: await (await exigirClientes()).indicacao(m[1]) })],

    /* ---------- parte legal: dados da empresa (termos e privacidade) e nota fiscal ---------- */
    ["GET", /^publico\/empresa$/, false, async () => {
      const e = await (await clientesParaPublico()).lerEmpresa();
      return { corpo: { nome: e.nome, documento: e.documento, email: e.email, cidade: e.cidade, termos_versao: e.termos_versao } };
    }],
    ["GET", /^empresa$/, "configuracoes", async () => ({ corpo: await (await exigirClientes()).lerEmpresa() })],
    ["PUT", /^empresa$/, "configuracoes", async ({ corpo }) => ({ corpo: await (await exigirClientes()).salvarEmpresa(corpo) }), "Alterou os dados da empresa"],
    ["PUT", new RegExp(`^pagamentos/${ID}/nota$`), "pagamentos.confirmar", async ({ m, corpo }) => ({ corpo: await (await exigirClientes()).registrarNota(m[1], corpo) }),
      ({ corpo }) => [String(corpo.numero ?? "").trim() ? "Registrou nota fiscal" : "Apagou nota fiscal"]],

    /* ---------- mensalidade (assinatura) ---------- */
    ["GET", /^assinatura$/, true, async () => ({ corpo: await (await exigirClientes()).lerAssinatura() })],
    ["PUT", /^assinatura$/, "configuracoes", async ({ corpo }) => ({ corpo: await (await exigirClientes()).salvarAssinatura(corpo) }), "Alterou a mensalidade"],
    ["PUT", new RegExp(`^clientes/${ID}/assinatura$`), "pagamentos.cobrar", async ({ m, corpo }) => ({ corpo: await (await exigirClientes()).ajustarAssinatura(m[1], corpo) }), "Ajustou a mensalidade"],
    ["POST", new RegExp(`^clientes/${ID}/assinatura/cobrar$`), "pagamentos.cobrar", async ({ m }) => ({ corpo: await (await exigirClientes()).cobrarMensalidadeAgora(m[1]) }), "Gerou cobrança de mensalidade"],
    ["POST", new RegExp(`^clientes/${ID}/assinatura/(suspender|reativar)$`), "lojas.suporte", async ({ m }) => ({ corpo: await (await exigirClientes()).suspenderAgora(m[1], m[2] === "suspender") }),
      ({ m }) => [m[2] === "suspender" ? "Suspendeu a loja" : "Reativou a loja"]],

    ["GET", /^funil$/, "clientes.ver", async ({ url, quem }) => ({
      corpo: await (await exigirClientes()).funil({ de: url.searchParams.get("de"), ate: url.searchParams.get("ate"), financeiro: quem.permissoes.includes("financeiro.ver") }),
    })],
    ["PUT", /^metas$/, "configuracoes", async ({ corpo }) => ({ corpo: await (await exigirClientes()).salvarMetas(corpo) }), "Definiu as metas do mês"],

    // o valor padrão aparece no cadastro de quem vende; mudar é só com você
    ["GET", /^configuracoes$/, true, async () => ({ corpo: await (await exigirClientes()).lerConfig() })],
    ["PUT", /^configuracoes$/, "configuracoes", async ({ corpo }) => ({ corpo: await (await exigirClientes()).salvarConfig(corpo) }), "Alterou a cobrança"],

    /* ---------- equipe (só você) ---------- */
    ["GET", /^equipe$/, "equipe", async () => ({
      corpo: {
        funcionarios: await (async () => {
          const lista = await exigirEquipe().listar();
          const ligadas = duas ? await duas.ligadasEntre(lista.map((f) => f.id)).catch(() => new Set()) : new Set();
          return lista.map((f) => ({ ...f, duas_etapas: ligadas.has(f.id) }));
        })(),
        funcoes: Object.entries(FUNCOES).map(([id, f]) => ({ id, nome: f.nome, prefixo: `FM${f.letra}`, descricao: f.descricao, permissoes: f.permissoes })),
        permissoes: PERMISSOES,
      },
    })],
    ["POST", /^equipe$/, "equipe", async ({ corpo }) => ({ corpo: await exigirEquipe().criar(corpo) }), ({ r }) => ["Cadastrou funcionário", r.corpo.funcionario.usuario]],
    ["PUT", new RegExp(`^equipe/${ID}$`), "equipe", async ({ m, corpo }) => ({ corpo: await exigirEquipe().editar(m[1], corpo) }), ({ r }) => ["Editou funcionário", r.corpo.usuario]],
    ["POST", new RegExp(`^equipe/${ID}/nova-senha$`), "equipe", async ({ m }) => ({ corpo: await exigirEquipe().novaSenha(m[1]) }), ({ r }) => ["Gerou senha nova", r.corpo.funcionario.usuario]],
    ["POST", new RegExp(`^equipe/${ID}/ativo$`), "equipe", async ({ m, corpo }) => ({ corpo: await exigirEquipe().definirAtivo(m[1], corpo.ativo) }),
      ({ r }) => [r.corpo.ativo ? "Reativou funcionário" : "Desativou funcionário", r.corpo.usuario]],
    ["DELETE", new RegExp(`^equipe/${ID}$`), "equipe", async ({ m }) => {
      const r = await exigirEquipe().excluir(m[1]);
      if (duas) await duas.desligar({ id: m[1] }).catch(() => {});
      return { corpo: r };
    }, ({ r }) => ["Excluiu funcionário", r.corpo.usuario]],
    ["POST", new RegExp(`^equipe/${ID}/duas-etapas/desligar$`), "equipe", async ({ m }) => {
      if (!duas) throw new ErroHttp(503, "Verificação em duas etapas indisponível.");
      await exigirEquipe().conferirSenhaDe(m[1], ""); // confere que existe (404 se não)
      await duas.desligar({ id: m[1] });
      return { corpo: { ok: true } };
    }, "Desligou as duas etapas de um funcionário"],

    /* ---------- cópias de segurança ---------- */
    ["GET", /^backup$/, "dono", async () => {
      if (!banco) throw new ErroHttp(503, "Ligue o banco da Central para baixar a cópia.");
      await garantirEsquema();
      const tabelas = {};
      for (const t of TABELAS_DA_CENTRAL) tabelas[t] = await banco.consultar(`select * from ${t}`);
      const agora = new Date().toISOString();
      await banco.consultar(`insert into configuracoes (chave, valor) values ('backup', $1::jsonb)
        on conflict (chave) do update set valor = excluded.valor`, [JSON.stringify({ ultimo_em: agora })]);
      return { corpo: { forminha: "central", versao: 1, gerado_em: agora,
        aviso: "Os dados pessoais continuam criptografados: para abrir, é preciso a CHAVE_CRIPTOGRAFIA (guarde-a junto, em lugar seguro).", tabelas } };
    }, "Baixou a cópia da Central"],
    ["GET", /^backup\/situacao$/, "dono", async () => {
      if (!banco) return { corpo: { ultimo_em: null } };
      await garantirEsquema();
      const [l] = await banco.consultar("select valor from configuracoes where chave = 'backup'");
      return { corpo: { ultimo_em: l?.valor?.ultimo_em ?? null } };
    }],
    ["GET", /^lojas\/([A-Za-z0-9-]+)\/backup$/, "lojas.suporte", async ({ m }) => {
      exigirLojas();
      const loja = await lojas.porRef(m[1]);
      return { corpo: await lojas.copiaDaLoja(loja), alvo: loja.nome };
    }, "Baixou a cópia de uma loja"],
    ["GET", /^atividades$/, "equipe", async ({ url }) => ({ corpo: { atividades: await exigirEquipe().atividades({ quem: url.searchParams.get("quem") || null }) } })],

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
    ["GET", /^lojas$/, "lojas.ver", async () => { exigirLojas(); return { corpo: { lojas: await lojas.listar() } }; }],
    ["POST", /^lojas$/, "lojas.criar", async ({ corpo }) => {
      exigirLojas();
      const nome = String(corpo.nome ?? "").replace(/\s+/g, " ").trim();
      const email = String(corpo.email ?? "").trim().toLowerCase();
      const campos = {};
      if (nome.length < 2) campos.nome = "Nome da loja: mínimo de 2 letras.";
      else if (nome.length > 60) campos.nome = "Nome da loja: máximo de 60 letras.";
      if (!EMAIL.test(email)) campos.email = "Informe o e-mail da dona da loja.";
      if (Object.keys(campos).length) throw new ErroHttp(422, Object.values(campos)[0], campos);
      const r = await lojas.criar(nome);
      return { corpo: { ...r, email, etapa: "criando" }, alvo: nome };
    }, "Criou loja sem cobrança"],
    ["GET", /^lojas\/([A-Za-z0-9-]+)$/, "lojas.ver", async ({ m }) => { exigirLojas(); return { corpo: await lojas.estado(await lojas.porRef(m[1])) }; }],
    ["POST", /^lojas\/([A-Za-z0-9-]+)\/preparar$/, "lojas.suporte", async ({ m, corpo }) => { exigirLojas(); return { corpo: await lojas.prepararPasso(await lojas.porRef(m[1]), corpo.email) }; }],
    ["POST", /^lojas\/([A-Za-z0-9-]+)\/publicar$/, "lojas.suporte", async ({ m }) => {
      exigirLojas();
      const loja = await lojas.porRef(m[1]);
      return { corpo: await lojas.publicar(loja), alvo: loja.nome };
    }, "Publicou loja"],
    ["POST", /^lojas\/([A-Za-z0-9-]+)\/convite$/, "lojas.suporte", async ({ m, corpo }) => {
      exigirLojas();
      const loja = await lojas.porRef(m[1]);
      return { corpo: await lojas.convite(loja, corpo.email), alvo: loja.nome };
    }, "Gerou convite"],
    ["POST", /^lojas\/([A-Za-z0-9-]+)\/reativar$/, "lojas.suporte", async ({ m }) => {
      exigirLojas();
      const loja = await lojas.porRef(m[1]);
      await lojas.reativar(loja);
      return { corpo: { etapa: "reativando" }, alvo: loja.nome };
    }, "Reativou loja"],
    // pagamento online: você cola o Access Token do Mercado Pago da doceria (ou ela mesma, pelo painel dela)
    ["POST", /^lojas\/([A-Za-z0-9-]+)\/pagamento$/, "lojas.suporte", async ({ m, corpo }) => {
      exigirLojas();
      const loja = await lojas.porRef(m[1]);
      return { corpo: await lojas.conectarPagamento(loja, corpo.token), alvo: loja.nome };
    }, "Ligou o pagamento online"],
    // avisos por WhatsApp (a chave da Meta da doceria; a dona também liga pelo painel dela)
    ["POST", /^lojas\/([A-Za-z0-9-]+)\/whatsapp$/, "lojas.suporte", async ({ m, corpo }) => {
      exigirLojas();
      const loja = await lojas.porRef(m[1]);
      return { corpo: await lojas.conectarWhatsapp(loja, corpo), alvo: loja.nome };
    }, "Ligou os avisos por WhatsApp"],
    // domínio próprio (ex.: suadoceria.com.br)
    ["GET", /^lojas\/([A-Za-z0-9-]+)\/dominio$/, "lojas.ver", async ({ m }) => { exigirLojas(); return { corpo: await acoesDeDominio.ver(await lojas.porRef(m[1])) }; }],
    ["POST", /^lojas\/([A-Za-z0-9-]+)\/dominio$/, "lojas.suporte", async ({ m, corpo }) => {
      exigirLojas();
      const loja = await lojas.porRef(m[1]);
      const r = await acoesDeDominio.ligar(loja, corpo);
      return { corpo: r, alvo: `${loja.nome} (${r.dominio})` };
    }, "Ligou domínio próprio"],
    ["POST", /^lojas\/([A-Za-z0-9-]+)\/dominio\/conferir$/, "lojas.suporte", async ({ m }) => { exigirLojas(); return { corpo: await acoesDeDominio.conferir(await lojas.porRef(m[1])) }; }],
    ["DELETE", /^lojas\/([A-Za-z0-9-]+)\/dominio$/, "lojas.suporte", async ({ m }) => {
      exigirLojas();
      const loja = await lojas.porRef(m[1]);
      return { corpo: await acoesDeDominio.tirar(loja), alvo: loja.nome };
    }, "Tirou o domínio próprio"],
    // loja de projeto próprio muda para o banco único (um passo por chamada; começar exige o código digitado)
    ["POST", /^lojas\/([A-Za-z0-9-]+)\/mudar$/, "dono", async ({ m, corpo }) => {
      exigirLojas();
      const loja = await lojas.porRef(m[1]);
      return { corpo: await lojas.mudarParaBancoUnico(loja, corpo), alvo: loja.nome };
    }, (({ r }) => [r.corpo?.etapa === "pronta" ? "Mudou a loja para o banco único" : "Mudando a loja para o banco único"])],
    // endereço na Forminha (anadoces.forminha.com.br)
    ["GET", /^lojas\/([A-Za-z0-9-]+)\/subdominio$/, "lojas.ver", async ({ m }) => { exigirLojas(); return { corpo: await acoesDeSub.ver(await lojas.porRef(m[1])) }; }],
    ["POST", /^lojas\/([A-Za-z0-9-]+)\/subdominio$/, "lojas.suporte", async ({ m, corpo }) => {
      exigirLojas();
      const loja = await lojas.porRef(m[1]);
      const r = await acoesDeSub.ligar(loja, corpo);
      return { corpo: r, alvo: `${loja.nome} (${r.host})` };
    }, "Ligou o endereço na Forminha"],
    ["POST", /^lojas\/([A-Za-z0-9-]+)\/subdominio\/conferir$/, "lojas.suporte", async ({ m }) => { exigirLojas(); return { corpo: await acoesDeSub.conferir(await lojas.porRef(m[1])) }; }],
    ["DELETE", /^lojas\/([A-Za-z0-9-]+)\/subdominio$/, "lojas.suporte", async ({ m }) => {
      exigirLojas();
      const loja = await lojas.porRef(m[1]);
      return { corpo: await acoesDeSub.tirar(loja), alvo: loja.nome };
    }, "Tirou o endereço na Forminha"],

    /* ---------- banco único (todas as lojas num projeto só) ---------- */
    ["GET", /^banco-unico$/, "dono", async () => {
      if (!bancoUnico) throw new ErroHttp(503, "Para ter o banco único, ligue o banco da Central e as chaves do Supabase e da Vercel.");
      return { corpo: await bancoUnico.estado() };
    }],
    // um passo por chamada (a tela chama de novo até ficar pronto); depois, serve para atualizar as tabelas
    ["POST", /^banco-unico\/preparar$/, "dono", async () => {
      if (!bancoUnico) throw new ErroHttp(503, "Para ter o banco único, ligue o banco da Central e as chaves do Supabase e da Vercel.");
      return { corpo: await bancoUnico.preparar() };
    }, "Preparou o banco único das lojas"],

    /* ---------- domínio da Forminha (a Central e a base das lojas) ---------- */
    ["GET", /^dominio$/, "dono", async () => ({ corpo: reler(await exigirDominioCentral().situacao()) })],
    ["POST", /^dominio$/, "dono", async ({ corpo }) => {
      const r = reler(await exigirDominioCentral().definir(corpo));
      return { corpo: r, alvo: r.dominio };
    }, "Ligou o domínio da Forminha"],
    ["POST", /^dominio\/conferir$/, "dono", async () => ({ corpo: reler(await exigirDominioCentral().situacao({ conferir: true })) })],
    ["DELETE", /^dominio$/, "dono", async () => ({ corpo: reler(await exigirDominioCentral().remover()) }), "Tirou o domínio da Forminha"],

    /* ---------- chamadas do painel da loja (a dona, com o login dela; sem cookie da Central) ---------- */
    ["POST", /^loja\/whatsapp$/, false, async ({ cabecalhos, corpo }) => {
      const loja = await lojaDaDona(cabecalhos);
      const r = await lojas.conectarWhatsapp(loja, corpo);
      registrarDaDona(loja, "Ligou os avisos por WhatsApp");
      return { corpo: r };
    }],
    ["POST", /^loja\/pagamento$/, false, async ({ cabecalhos, corpo }) => {
      const loja = await lojaDaDona(cabecalhos);
      const r = await lojas.conectarPagamento(loja, corpo.token);
      registrarDaDona(loja, "Ligou o pagamento online");
      return { corpo: r };
    }],
    ["GET", /^loja\/dominio$/, false, async ({ cabecalhos }) => ({ corpo: await acoesDeDominio.ver(await lojaDaDona(cabecalhos)) })],
    ["POST", /^loja\/dominio$/, false, async ({ cabecalhos, corpo }) => {
      const loja = await lojaDaDona(cabecalhos);
      const r = await acoesDeDominio.ligar(loja, corpo);
      registrarDaDona(loja, `Ligou o domínio ${r.dominio}`);
      return { corpo: r };
    }],
    ["POST", /^loja\/dominio\/conferir$/, false, async ({ cabecalhos }) => ({ corpo: await acoesDeDominio.conferir(await lojaDaDona(cabecalhos)) })],
    ["DELETE", /^loja\/dominio$/, false, async ({ cabecalhos }) => {
      const loja = await lojaDaDona(cabecalhos);
      const r = await acoesDeDominio.tirar(loja);
      registrarDaDona(loja, "Tirou o domínio próprio");
      return { corpo: r };
    }],
    ["DELETE", /^lojas\/([A-Za-z0-9-]+)$/, "lojas.excluir", async ({ m, corpo }) => {
      exigirLojas();
      const loja = await lojas.porRef(m[1]);
      return { corpo: { ok: true, ...(await lojas.excluir(loja, corpo.codigo)) }, alvo: `${loja.nome} (${loja.codigo})` };
    }, "Excluiu loja"],

    // todo dia (Vercel Cron): lojas grátis não pausam; criações paradas no meio são retomadas
    ["GET", /^manter-ativo$/, false, async ({ cabecalhos }) => {
      if (!autorizadoInterno(cabecalhos)) throw new ErroHttp(401, "Não autorizado.");
      exigirLojas();
      let resultado;
      try { resultado = await lojas.manterAtivas(); }
      catch (e) {
        if (chaveRecusada(e)) await avisarDaChave([mensagemDeChaveRecusada(e.quem, e.status, e.message)]).catch(() => {});
        throw e;
      }
      if (clientes) {
        await garantirEsquema();
        resultado.criacoes_retomadas = await clientes.retomarParadas();
        resultado.mensalidades = await clientes.cobrarMensalidades().catch((e) => ({ erro: e.message }));
      }
      if (resultado.falhas > 0) await alertarErro(`${resultado.falhas} ${resultado.falhas === 1 ? "loja não respondeu" : "lojas não responderam"} hoje`,
        "Na verificação diária, alguma loja não respondeu. Abra Lojas na Central e confira se alguma está pausada ou com problema.");
      // cópia da Central esquecida: lembra uma vez por semana
      if (banco && avisos) {
        const [b] = await banco.consultar("select valor from configuracoes where chave = 'backup'");
        const dias = b?.valor?.ultimo_em ? Math.floor((Date.now() - Date.parse(b.valor.ultimo_em)) / 86_400_000) : null;
        const [lembrou] = await banco.consultar("select 1 from avisos where tipo = 'backup' and em > now() - interval '7 days' limit 1");
        if ((dias === null || dias >= 7) && !lembrou) {
          await avisos.registrar({ tipo: "backup", titulo: dias === null ? "Baixe a primeira cópia da Central" : `Faz ${dias} dias que você não baixa a cópia da Central`,
            texto: "Configurações → Cópias de segurança. Guarde o arquivo junto com a CHAVE_CRIPTOGRAFIA.", permissao: "dono" });
        }
      }
      // chave perto de vencer: um e-mail 15 dias antes e todo dia na última semana
      const vencendo = chavesVencendo(env).filter((c) => c.dias <= 7 || c.dias === 15);
      resultado.aviso_de_chave = await avisarDaChave(vencendo.map(textoDoPrazo)).catch(() => false);
      return { corpo: resultado };
    }],
  ];

  /** Registra a ação na lista de atividades (sem dados pessoais: usuário, ação e nome da loja). */
  async function registrarAtividade(quem, atividade, { m, corpo, r, rota }) {
    if (!equipe) return;
    const [acao, alvoDado] = typeof atividade === "function" ? atividade({ m, corpo, r, quem }) : [atividade];
    let alvo = alvoDado ?? r.alvo ?? r.corpo?.cliente?.nome_loja ?? "";
    if (!alvo && rota.startsWith("clientes/") && m?.[1]) alvo = await equipe.lojaDaCliente(m[1]);
    await equipe.registrar({ quem: quem.id, usuario: quem.usuario, acao, alvo });
  }

  /* ---------- tratamento de cada requisição ---------- */
  async function lerCorpo(req) {
    if (req.body !== undefined) return typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body ?? {};
    const partes = []; let tamanho = 0;
    for await (const parte of req) { tamanho += parte.length; if (tamanho > 64 * 1024) throw new ErroHttp(413, "Dados grandes demais."); partes.push(parte); }
    const texto = Buffer.concat(partes).toString("utf8");
    return texto ? JSON.parse(texto) : {};
  }

  function responder(res, status, corpo, cookie, extras = null) {
    res.statusCode = status;
    for (const [k, v] of Object.entries(extras ?? {})) res.setHeader(k, v);
    res.setHeader("Cache-Control", "no-store");
    if (status === 204) return res.end();
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    if (cookie) res.setHeader("Set-Cookie", cookie);
    res.end(JSON.stringify(corpo));
  }
  // o painel de cada loja mora em outro endereço: estas rotas aceitam chamadas de fora (a proteção é o login da dona, não cookie)
  const CORS_DAS_LOJAS = {
    "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, x-loja",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS", "Access-Control-Max-Age": "600",
  };

  async function tratar(req, res) {
    let quem = null;
    let extras = null;
    let rota = "";
    try {
      const url = new URL(req.url, "http://central");
      rota = (url.searchParams.get("rota") ?? url.pathname.replace(/^\/api\/?/, "")).replace(/^\/+|\/+$/g, "");
      const metodo = req.method;
      const cabecalhos = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v[0] : v]));
      const seguro = cabecalhos["x-forwarded-proto"] === "https" || !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(cabecalhos.host ?? "");
      const daLoja = rota.startsWith("loja/");
      if (daLoja) extras = CORS_DAS_LOJAS;
      if (daLoja && metodo === "OPTIONS") return responder(res, 204, null, null, extras);
      await atualizarEndereco(); // no máximo uma leitura por minuto
      quem = await identificar(lerSessao(lerCookie(cabecalhos.cookie, NOME_COOKIE), env.SEGREDO_SESSAO));

      const achada = rotas.map(([met, re, pode, fn, atividade]) => met === metodo && re.exec(rota) && { m: re.exec(rota), pode, fn, atividade }).find(Boolean);
      if (!achada) throw new ErroHttp(404, "Caminho não encontrado.");
      if (achada.pode) {
        if (!quem) throw new ErroHttp(401, "Entre na Central para continuar.");
        if (quem.trocar_senha && !LIVRES_NA_TROCA.has(rota)) throw new ErroHttp(403, "Crie a sua senha antes de continuar.");
        if (achada.pode === "dono" && quem.tipo !== "dono") throw new ErroHttp(403, "Só o dono da Central pode fazer isso.");
        if (typeof achada.pode === "string" && achada.pode !== "dono" && !quem.permissoes.includes(achada.pode)) throw new ErroHttp(403, "Sua função não permite fazer isso.");
      }
      if (metodo !== "GET") {
        // contra pedidos forjados por outros sites: só JSON e só da própria Central
        if (!String(cabecalhos["content-type"] ?? "").includes("application/json")) throw new ErroHttp(415, "Envie os dados em JSON.");
        const origem = cabecalhos.origin;
        if (!daLoja && origem && new URL(origem).host !== cabecalhos.host) throw new ErroHttp(403, "Origem não permitida.");
      }
      const corpo = metodo === "GET" ? {} : await lerCorpo(req).catch((e) => { throw e instanceof ErroHttp ? e : new ErroHttp(400, "Dados inválidos."); });
      const ip = String(cabecalhos["x-forwarded-for"] ?? req.socket?.remoteAddress ?? "").split(",").pop().trim();
      // o histórico da cliente registra quem fez (ex.: "FMV-0427 · Ana")
      const r = await comAutor(quem ? rotulo(quem) : null, () => achada.fn({ m: achada.m, url, corpo, cabecalhos, ip, seguro, quem, logado: Boolean(quem) }));
      if (achada.atividade && quem) await registrarAtividade(quem, achada.atividade, { m: achada.m, corpo, r, rota }).catch((e) => console.error("[atividade]", e.message));
      responder(res, 200, r.corpo, r.cookie, extras);
    } catch (erro) {
      if (erro instanceof ErroHttp) return responder(res, erro.status, { erro: erro.message, campos: erro.campos }, null, extras);
      // chave vencida ou sem permissão: para você, diz o que fazer; para visitantes, nada muda
      if (erro instanceof ErroProvedor) {
        console.error("[provedor]", erro.status, erro.message); // aparece nos registros da Vercel (sem chaves)
        if (chaveRecusada(erro)) await alertarErro(`A chave do ${erro.quem} foi recusada`, mensagemDeChaveRecusada(erro.quem, erro.status, erro.message));
        else if (!erro.status || erro.status >= 500) await alertarErro(`${erro.quem} com problema`, `${erro.message} (em ${rota || "?"})`);
        return responder(res, 502, { erro: quem && chaveRecusada(erro) ? mensagemDeChaveRecusada(erro.quem, erro.status, erro.message) : erro.message }, null, extras);
      }
      if (erro instanceof ErroCofre) {
        console.error("[cofre]", erro.message);
        await alertarErro("Não foi possível abrir os dados protegidos", "Confira a CHAVE_CRIPTOGRAFIA nas variáveis da Vercel.");
        return responder(res, 500, { erro: "Não foi possível abrir os dados protegidos (confira a CHAVE_CRIPTOGRAFIA)." });
      }
      console.error(erro);
      await alertarErro("Erro inesperado na Central", `${String(erro?.message ?? erro).slice(0, 300)} (em ${rota || "?"})`);
      responder(res, 500, { erro: "Erro inesperado na Central. Tente de novo." });
    }
  }

  return { tratar, faltando };
}

export { PADRAO_CODIGO };
