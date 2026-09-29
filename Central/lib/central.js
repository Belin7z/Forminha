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

export { ErroHttp };
const OBRIGATORIAS = ["CENTRAL_SENHA_HASH", "SEGREDO_SESSAO", "SUPABASE_ACCESS_TOKEN", "VERCEL_TOKEN", "FORMINHA_ORG", "DATABASE_URL", "CHAVE_CRIPTOGRAFIA"];
const ID = "([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})";
// com senha temporária, o funcionário só consegue criar a própria senha (e sair)
const LIVRES_NA_TROCA = new Set(["eu", "sair", "minha-senha"]);

export function criarCentral(env = process.env, opcoes = {}) {
  const org = String(env.FORMINHA_ORG ?? "").trim();
  const fetchFn = opcoes.fetchFn ?? fetch;
  const urlBase = String(env.URL_CENTRAL || (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : "https://forminha.vercel.app")).replace(/\/+$/, "");
  const sb = opcoes.supabase ?? (env.SUPABASE_ACCESS_TOKEN ? criarSupabase({ token: env.SUPABASE_ACCESS_TOKEN, fetchFn }) : null);
  const vc = opcoes.vercel ?? (env.VERCEL_TOKEN ? criarVercel({ token: env.VERCEL_TOKEN, time: env.VERCEL_TIME, fetchFn }) : null);
  const lojas = sb && vc && org ? criarLojas({
    sb, vc, org, fetchFn,
    repoLoja: env.REPO_LOJA || "Belin7z/Forminha", repoPainel: env.REPO_PAINEL || "Belin7z/Forminha",
    pastaLoja: env.PASTA_LOJA || "Loja", pastaPainel: env.PASTA_PAINEL || "Dashboard", urlCentral: urlBase,
  }) : null;

  // banco e cofre da Central (clientes e equipe): sem eles, as lojas continuam funcionando
  const urlBanco = env.DATABASE_URL || env.POSTGRES_URL;
  const banco = opcoes.banco ?? (urlBanco ? bancoNeon(urlBanco) : null);
  let cofre = null, erroCofre = null;
  try { cofre = env.CHAVE_CRIPTOGRAFIA ? criarCofre(env.CHAVE_CRIPTOGRAFIA) : null; } catch (e) { erroCofre = e.message; }
  const garantirEsquema = banco ? preparadorDeEsquema(banco) : null;
  const email = opcoes.email !== undefined ? opcoes.email : criarEmail({ usuario: env.SMTP_USUARIO, senha: env.SMTP_SENHA, nome: env.EMAIL_NOME || "Forminha" });
  const mp = opcoes.mercadoPago !== undefined ? opcoes.mercadoPago : env.MP_ACCESS_TOKEN ? criarMercadoPago({ token: env.MP_ACCESS_TOKEN, fetchFn }) : null;
  const avisos = banco ? criarAvisos({ banco, preparar: garantirEsquema }) : null; // o sino da Central
  const clientes = banco && cofre && lojas ? criarClientes({
    banco, cofre, lojas, email, mp, urlBase, segredoInterno: env.CRON_SECRET, fetchFn,
    agendar: opcoes.agendar ?? null, orcamentoMs: opcoes.orcamentoMs ?? 40_000, esperaBancoMs: opcoes.esperaBancoMs ?? 4000,
    avisar: avisos ? (dados) => avisos.registrar(dados) : undefined,
  }) : null;
  const equipe = banco && cofre ? criarEquipe({ banco, cofre, preparar: garantirEsquema }) : null;

  const faltando = OBRIGATORIAS.filter((k) => {
    if (k === "SUPABASE_ACCESS_TOKEN" && opcoes.supabase) return false;
    if (k === "VERCEL_TOKEN" && opcoes.vercel) return false;
    if (k === "DATABASE_URL") return !banco;
    return !env[k];
  });
  if (erroCofre) faltando.push("CHAVE_CRIPTOGRAFIA (inválida)");
  const tentativas = new Map(); // freio de senha errada (por endereço, nesta instância)
  const acesso = criarAcesso({ banco, preparar: garantirEsquema ?? undefined, hashInicial: env.CENTRAL_SENHA_HASH, emailInicial: env.CENTRAL_EMAIL });

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
    const loja = await lojas.porRef(ref);
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

  /* ----------------------------------------------------------
     rotas: [método, caminho, quem pode, função, atividade]
       quem pode: false = público · true = qualquer pessoa logada ·
       "dono" = só você · outro texto = a permissão (ver PERMISSOES)
       atividade: o que fica registrado (texto ou função que devolve [texto, alvo])
     ---------------------------------------------------------- */
  const rotas = [
    ["POST", /^entrar$/, false, async ({ corpo, ip, seguro }) => {
      if (!env.CENTRAL_SENHA_HASH || !env.SEGREDO_SESSAO) throw new ErroHttp(503, 'A senha da Central ainda não foi criada. Rode "npm run configurar".');
      const t = tentativas.get(ip) ?? { n: 0, ate: 0 };
      if (t.ate > Date.now()) throw new ErroHttp(429, `Muitas tentativas. Aguarde ${Math.ceil((t.ate - Date.now()) / 1000)} segundos.`);
      const identificador = String(corpo.usuario ?? corpo.email ?? "");
      let quem = null, versao = 0;
      if (lerUsuario(identificador)) { // FM?-0000: alguém da equipe
        const f = equipe ? await equipe.entrar(identificador, corpo.senha) : null;
        if (f) { quem = comoFuncionario(f); versao = f.versao; }
      } else if (await acesso.entrar(identificador, corpo.senha)) {
        quem = DONO;
        versao = (await acesso.versao()) ?? 0;
      }
      if (!quem) {
        t.n += 1;
        if (t.n >= 5) t.ate = Date.now() + 60_000 * Math.min(15, 2 ** (Math.floor(t.n / 5) - 1));
        tentativas.set(ip, t);
        await new Promise((ok) => setTimeout(ok, 400));
        throw new ErroHttp(401, "E-mail (ou usuário) ou senha incorretos.");
      }
      tentativas.delete(ip);
      if (equipe) await equipe.registrar({ quem: quem.id, usuario: quem.usuario, acao: "Entrou" }).catch(() => {});
      return { corpo: { ok: true, trocar_senha: Boolean(quem.trocar_senha) }, cookie: cookieDe(quem, versao, seguro) };
    }],
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
            clientes: Boolean(clientes), email: Boolean(email), mercado_pago: Boolean(mp), assinatura_mp: Boolean(env.MP_WEBHOOK_SECRET),
            trocar_senha: Boolean(banco), equipe: Boolean(equipe),
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
        funcionarios: await exigirEquipe().listar(),
        funcoes: Object.entries(FUNCOES).map(([id, f]) => ({ id, nome: f.nome, prefixo: `FM${f.letra}`, descricao: f.descricao, permissoes: f.permissoes })),
        permissoes: PERMISSOES,
      },
    })],
    ["POST", /^equipe$/, "equipe", async ({ corpo }) => ({ corpo: await exigirEquipe().criar(corpo) }), ({ r }) => ["Cadastrou funcionário", r.corpo.funcionario.usuario]],
    ["PUT", new RegExp(`^equipe/${ID}$`), "equipe", async ({ m, corpo }) => ({ corpo: await exigirEquipe().editar(m[1], corpo) }), ({ r }) => ["Editou funcionário", r.corpo.usuario]],
    ["POST", new RegExp(`^equipe/${ID}/nova-senha$`), "equipe", async ({ m }) => ({ corpo: await exigirEquipe().novaSenha(m[1]) }), ({ r }) => ["Gerou senha nova", r.corpo.funcionario.usuario]],
    ["POST", new RegExp(`^equipe/${ID}/ativo$`), "equipe", async ({ m, corpo }) => ({ corpo: await exigirEquipe().definirAtivo(m[1], corpo.ativo) }),
      ({ r }) => [r.corpo.ativo ? "Reativou funcionário" : "Desativou funcionário", r.corpo.usuario]],
    ["DELETE", new RegExp(`^equipe/${ID}$`), "equipe", async ({ m }) => ({ corpo: await exigirEquipe().excluir(m[1]) }), ({ r }) => ["Excluiu funcionário", r.corpo.usuario]],
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
    ["GET", /^lojas\/([a-z]+)$/, "lojas.ver", async ({ m }) => { exigirLojas(); return { corpo: await lojas.estado(await lojas.porRef(m[1])) }; }],
    ["POST", /^lojas\/([a-z]+)\/preparar$/, "lojas.suporte", async ({ m, corpo }) => { exigirLojas(); return { corpo: await lojas.prepararPasso(await lojas.porRef(m[1]), corpo.email) }; }],
    ["POST", /^lojas\/([a-z]+)\/publicar$/, "lojas.suporte", async ({ m }) => {
      exigirLojas();
      const loja = await lojas.porRef(m[1]);
      return { corpo: await lojas.publicar(loja), alvo: loja.nome };
    }, "Publicou loja"],
    ["POST", /^lojas\/([a-z]+)\/convite$/, "lojas.suporte", async ({ m, corpo }) => {
      exigirLojas();
      const loja = await lojas.porRef(m[1]);
      return { corpo: await lojas.convite(loja, corpo.email), alvo: loja.nome };
    }, "Gerou convite"],
    ["POST", /^lojas\/([a-z]+)\/reativar$/, "lojas.suporte", async ({ m }) => {
      exigirLojas();
      const loja = await lojas.porRef(m[1]);
      await lojas.reativar(loja);
      return { corpo: { etapa: "reativando" }, alvo: loja.nome };
    }, "Reativou loja"],
    // pagamento online: você cola o Access Token do Mercado Pago da doceria (ou ela mesma, pelo painel dela)
    ["POST", /^lojas\/([a-z]+)\/pagamento$/, "lojas.suporte", async ({ m, corpo }) => {
      exigirLojas();
      const loja = await lojas.porRef(m[1]);
      return { corpo: await lojas.conectarPagamento(loja, corpo.token), alvo: loja.nome };
    }, "Ligou o pagamento online"],
    // domínio próprio (ex.: suadoceria.com.br)
    ["GET", /^lojas\/([a-z]+)\/dominio$/, "lojas.ver", async ({ m }) => { exigirLojas(); return { corpo: await acoesDeDominio.ver(await lojas.porRef(m[1])) }; }],
    ["POST", /^lojas\/([a-z]+)\/dominio$/, "lojas.suporte", async ({ m, corpo }) => {
      exigirLojas();
      const loja = await lojas.porRef(m[1]);
      const r = await acoesDeDominio.ligar(loja, corpo);
      return { corpo: r, alvo: `${loja.nome} (${r.dominio})` };
    }, "Ligou domínio próprio"],
    ["POST", /^lojas\/([a-z]+)\/dominio\/conferir$/, "lojas.suporte", async ({ m }) => { exigirLojas(); return { corpo: await acoesDeDominio.conferir(await lojas.porRef(m[1])) }; }],
    ["DELETE", /^lojas\/([a-z]+)\/dominio$/, "lojas.suporte", async ({ m }) => {
      exigirLojas();
      const loja = await lojas.porRef(m[1]);
      return { corpo: await acoesDeDominio.tirar(loja), alvo: loja.nome };
    }, "Tirou o domínio próprio"],

    /* ---------- chamadas do painel da loja (a dona, com o login dela; sem cookie da Central) ---------- */
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
    ["DELETE", /^lojas\/([a-z]+)$/, "lojas.excluir", async ({ m, corpo }) => {
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
      if (clientes) { await garantirEsquema(); resultado.criacoes_retomadas = await clientes.retomarParadas(); }
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
    "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS", "Access-Control-Max-Age": "600",
  };

  async function tratar(req, res) {
    let quem = null;
    let extras = null;
    try {
      const url = new URL(req.url, "http://central");
      const rota = (url.searchParams.get("rota") ?? url.pathname.replace(/^\/api\/?/, "")).replace(/^\/+|\/+$/g, "");
      const metodo = req.method;
      const cabecalhos = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v[0] : v]));
      const seguro = cabecalhos["x-forwarded-proto"] === "https" || !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(cabecalhos.host ?? "");
      const daLoja = rota.startsWith("loja/");
      if (daLoja) extras = CORS_DAS_LOJAS;
      if (daLoja && metodo === "OPTIONS") return responder(res, 204, null, null, extras);
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
      if (erro instanceof ErroProvedor) console.error("[provedor]", erro.status, erro.message); // aparece nos registros da Vercel (sem chaves)
      if (erro instanceof ErroProvedor) return responder(res, 502, { erro: quem && chaveRecusada(erro) ? mensagemDeChaveRecusada(erro.quem, erro.status, erro.message) : erro.message }, null, extras);
      if (erro instanceof ErroCofre) { console.error("[cofre]", erro.message); return responder(res, 500, { erro: "Não foi possível abrir os dados protegidos (confira a CHAVE_CRIPTOGRAFIA)." }); }
      console.error(erro);
      responder(res, 500, { erro: "Erro inesperado na Central. Tente de novo." });
    }
  }

  return { tratar, faltando };
}

export { PADRAO_CODIGO };
