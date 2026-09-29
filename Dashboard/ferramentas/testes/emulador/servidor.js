/* ==========================================================
   MINI-SUPABASE DE TESTE
   Um servidor HTTP que fala o mesmo protocolo do Supabase:
     /auth/v1/*    cadastro, login, renovação, usuário, recuperação
     /rest/v1/rpc  funções do banco (PostgREST)
     /storage/v1/* fotos dos produtos
   Por baixo roda o Postgres de teste com as migrações reais. Assim a
   biblioteca oficial `supabase-js` funciona sem nenhuma alteração,
   tanto nos testes quanto no navegador.
   (Não é o Supabase de verdade: serve para provar a lógica.)
   ========================================================== */
import crypto from "node:crypto";
import http from "node:http";
import { comoUsuario, criarBanco, executarNaLoja, executarRpc, lerSeed, sql } from "./banco.js";
import { criarExternos } from "./externos.js";
import { cabecalhosCors, criarRpc } from "../../../supabase/functions/_shared/comum.js";
import { criarPix } from "../../../supabase/functions/pix-criar/logica.js";
import { receberWebhook } from "../../../supabase/functions/pix-webhook/logica.js";
import { avisarWhatsapp } from "../../../supabase/functions/whatsapp-avisar/logica.js";
import { criarCheckoutCartao } from "../../../supabase/functions/cartao-criar/logica.js";
import { enderecosDoDominio, normalizarDominio, raizDoDominio, registroDoEndereco } from "../../../../Central/lib/dominios.js";

const b64 = (dados) => Buffer.from(dados).toString("base64url");

export async function iniciarEmulador({ porta = 0, confirmarEmail = false, exemplo = true } = {}) {
  const db = await criarBanco({ exemplo });
  const segredo = crypto.randomBytes(32).toString("hex");
  const arquivos = new Map();          // "bucket/caminho" -> { tipo, bytes }
  const tokensRenovacao = new Map();   // refresh_token -> id do usuário
  const emails = [];                   // e-mails "enviados" (para os testes conferirem)

  /* ---------- JWT (HS256, como o Supabase) ---------- */
  const assinar = (payload) => {
    const corpo = `${b64(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64(JSON.stringify(payload))}`;
    return `${corpo}.${crypto.createHmac("sha256", segredo).update(corpo).digest("base64url")}`;
  };
  const verificar = (token) => {
    const [h, p, s] = String(token).split(".");
    if (!s) return null;
    const esperado = crypto.createHmac("sha256", segredo).update(`${h}.${p}`).digest("base64url");
    if (s.length !== esperado.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(esperado))) return null;
    const claims = JSON.parse(Buffer.from(p, "base64url").toString());
    return claims.exp && claims.exp < Date.now() / 1000 ? null : claims;
  };
  const chaveAnon = assinar({ role: "anon", iss: "emulador", exp: 4102444800 });

  /* ---------- Senhas ---------- */
  const hashSenha = (senha) => {
    const sal = crypto.randomBytes(8).toString("hex");
    return `${sal}$${crypto.scryptSync(senha, sal, 32).toString("hex")}`;
  };
  const confereSenha = (senha, guardado) => {
    const [sal, hash] = String(guardado).split("$");
    return hash && crypto.timingSafeEqual(Buffer.from(hash, "hex"), crypto.scryptSync(senha, sal, 32));
  };

  /* ---------- Auxiliares HTTP ---------- */
  const cors = { "access-control-allow-origin": "*", "access-control-expose-headers": "*" };
  const responder = (res, status, corpo, extras = {}) => {
    const texto = corpo === undefined ? "" : typeof corpo === "string" || Buffer.isBuffer(corpo) ? corpo : JSON.stringify(corpo);
    res.writeHead(status, { ...cors, ...(status === 204 ? {} : { "content-type": "application/json" }), ...extras });
    res.end(texto);
  };
  const lerCorpo = (req) => new Promise((ok) => {
    const partes = [];
    req.on("data", (c) => partes.push(c));
    req.on("end", () => ok(Buffer.concat(partes)));
  });
  const lerJson = async (req) => {
    const buf = await lerCorpo(req);
    try { return buf.length ? JSON.parse(buf.toString()) : {}; } catch { return {}; }
  };
  const erroAuth = (res, status, error_code, msg) => responder(res, status, { code: status, error_code, msg });
  const claimsDe = (req) => {
    const token = String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    return token ? verificar(token) : null;
  };

  /* ---------- Auth ---------- */
  const usuarioJson = (u) => ({
    id: u.id, aud: "authenticated", role: "authenticated", email: u.email, email_confirmed_at: new Date().toISOString(), phone: "",
    app_metadata: { provider: "email", providers: ["email"] }, user_metadata: u.raw_user_meta_data ?? {}, identities: [],
    created_at: u.created_at, updated_at: u.created_at,
  });
  const criarSessao = (u) => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const refresh = crypto.randomBytes(16).toString("hex");
    tokensRenovacao.set(refresh, u.id);
    return {
      access_token: assinar({ sub: u.id, email: u.email, role: "authenticated", aud: "authenticated", exp, iat: exp - 3600, user_metadata: u.raw_user_meta_data ?? {} }),
      token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: refresh, user: usuarioJson(u),
    };
  };
  const usuarioPorEmail = async (email) => (await sql(db, "select * from auth.users where email = $1", [String(email).toLowerCase()])).rows[0];
  const usuarioPorId = async (id) => (await sql(db, "select * from auth.users where id = $1", [id])).rows[0];

  async function rotaAuth(req, res, caminho, url) {
    const corpo = await lerJson(req);

    if (caminho === "/signup" && req.method === "POST") {
      const email = String(corpo.email ?? "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return erroAuth(res, 400, "email_address_invalid", `Email address "${email}" is invalid`);
      if (String(corpo.password ?? "").length < 6) return erroAuth(res, 422, "weak_password", "Password should be at least 6 characters.");
      if (await usuarioPorEmail(email)) return erroAuth(res, 422, "user_already_exists", "User already registered");
      const r = await sql(db, "insert into auth.users (email, encrypted_password, raw_user_meta_data) values ($1, $2, $3::jsonb) returning *",
        [email, hashSenha(corpo.password), JSON.stringify(corpo.data ?? {})]);
      return responder(res, 200, confirmarEmail ? usuarioJson(r.rows[0]) : criarSessao(r.rows[0]));
    }

    if (caminho === "/token" && req.method === "POST") {
      const tipo = url.searchParams.get("grant_type");
      if (tipo === "password") {
        const u = await usuarioPorEmail(corpo.email ?? "");
        if (!u || !confereSenha(String(corpo.password ?? ""), u.encrypted_password)) return erroAuth(res, 400, "invalid_credentials", "Invalid login credentials");
        return responder(res, 200, criarSessao(u));
      }
      if (tipo === "refresh_token") {
        const id = tokensRenovacao.get(corpo.refresh_token);
        const u = id && (await usuarioPorId(id));
        if (!u) return erroAuth(res, 400, "refresh_token_not_found", "Invalid Refresh Token: Refresh Token Not Found");
        tokensRenovacao.delete(corpo.refresh_token);
        return responder(res, 200, criarSessao(u));
      }
      return erroAuth(res, 400, "unsupported_grant_type", "Tipo de login não suportado");
    }

    if (caminho === "/user") {
      const claims = claimsDe(req);
      if (!claims?.sub) return erroAuth(res, 401, "bad_jwt", "invalid JWT");
      const u = await usuarioPorId(claims.sub);
      if (!u) return erroAuth(res, 401, "user_not_found", "User from sub claim in JWT does not exist");
      if (req.method === "GET") return responder(res, 200, usuarioJson(u));
      if (req.method === "PUT") {
        if (corpo.password) {
          if (String(corpo.password).length < 6) return erroAuth(res, 422, "weak_password", "Password should be at least 6 characters.");
          if (confereSenha(corpo.password, u.encrypted_password)) return erroAuth(res, 422, "same_password", "New password should be different from the old password.");
          await sql(db, "update auth.users set encrypted_password = $1 where id = $2", [hashSenha(corpo.password), u.id]);
        }
        return responder(res, 200, usuarioJson((await usuarioPorId(u.id))));
      }
    }

    if (caminho === "/logout") return responder(res, 204, undefined);
    if (caminho === "/recover" && req.method === "POST") {
      emails.push({ tipo: "recuperacao", email: String(corpo.email ?? "").toLowerCase(), redirecionar: url.searchParams.get("redirect_to") });
      return responder(res, 200, {});
    }
    return erroAuth(res, 404, "not_found", "Rota de Auth não suportada no emulador");
  }

  /* ---------- PostgREST: funções (RPC) ---------- */
  async function rotaRpc(req, res, funcao) {
    if (!req.headers.apikey) return responder(res, 401, { message: "No API key found in request", hint: "No `apikey` request header or url param was found." });
    const claims = claimsDe(req);
    const token = String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    if (token && !claims) return responder(res, 401, { code: "PGRST301", message: "JWT expired", details: null, hint: null });
    const papel = claims?.role === "authenticated" ? "authenticated" : "anon";
    const corpo = await lerJson(req);
    try {
      // como o PostgREST: todos os cabeçalhos da requisição (o x-loja diz de qual loja é a chamada)
      const cabecalhos = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
      const dados = await executarRpc(db, { papel, claims: papel === "authenticated" ? claims : {}, cabecalhos }, funcao, corpo.p);
      if (funcao === "admin_gerar_segredo_gateway" && dados?.segredo) envFuncoes.SEGREDO_GATEWAY = dados.segredo;
      return responder(res, 200, dados === null ? "null" : dados);
    } catch (e) {
      const propria = /^PT(\d{3})$/.exec(e.code ?? "");
      if (propria) return responder(res, Number(propria[1]), { code: e.code, message: e.message, details: e.detail ?? "", hint: e.hint ?? null });
      if (e.code === "42501") return responder(res, papel === "anon" ? 401 : 403, { code: "42501", message: e.message, details: null, hint: null });
      if (e.code === "42883") return responder(res, 404, { code: "PGRST202", message: `Could not find the function public.${funcao}`, details: null, hint: null });
      return responder(res, 400, { code: e.code ?? "XX000", message: e.message, details: e.detail ?? null, hint: e.hint ?? null });
    }
  }

  /* ---------- Funções do servidor (Edge Functions) simuladas ---------- */
  // Rodam a MESMA lógica de supabase/functions, com o Mercado Pago e a Meta de mentira.
  const externos = criarExternos();
  const envFuncoes = { SUPABASE_URL: "", MP_ACCESS_TOKEN: "TEST-simulado", MP_WEBHOOK_SECRET: "", SEGREDO_GATEWAY: "",
                       WHATSAPP_TOKEN: "wa-simulado", WHATSAPP_PHONE_ID: "0000000000", URL_LOJA: "http://localhost:3000",
                       ORIGENS_PERMITIDAS: "http://localhost:3000,http://localhost:3001" };
  const FUNCOES = { "pix-criar": criarPix, "pix-webhook": receberWebhook, "whatsapp-avisar": avisarWhatsapp, "cartao-criar": criarCheckoutCartao };
  let rpcFuncoes = null;
  const lerTexto = async (req) => (await lerCorpo(req)).toString();

  async function rotaFuncao(req, res, nome) {
    const tratar = FUNCOES[nome];
    if (!tratar) return responder(res, 404, { message: "Função não encontrada" });
    const cabCors = cabecalhosCors(req.headers.origin, "");
    if (req.method === "OPTIONS") { res.writeHead(204, cabCors); return res.end(); }
    const cabecalhos = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
    const r = await tratar({ metodo: req.method, url: `${envFuncoes.SUPABASE_URL}${req.url}`, cabecalhos, corpoTexto: req.method === "POST" ? await lerTexto(req) : "" },
      { env: envFuncoes, fetchFn: externos.fetchFn, rpc: rpcFuncoes });
    res.writeHead(r.status, { ...cors, "content-type": "application/json" });
    res.end(r.status === 204 ? undefined : JSON.stringify(r.corpo ?? {}));
  }

  /** Controles só do simulador (não existem no Supabase de verdade). */
  /**
   * Vendas de exemplo espalhadas pelos últimos 13 meses (mais nos meses recentes), com clientes, cupons,
   * entregas, cancelados e pagamentos — para ver os relatórios cheios no modo de teste. Sempre as mesmas.
   */
  async function criarVendasDeExemplo(quantidade) {
    const nomes = ["Ana Paula Ribeiro", "Bruno Costa", "Carla Mendes", "Diego Rocha", "Elisa Martins", "Fábio Nunes", "Gabriela Torres", "Heitor Lima"];
    for (const [i, nome] of nomes.entries()) {
      await fetch(`${envFuncoes.SUPABASE_URL}/auth/v1/signup`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: `cliente${i + 1}@exemplo.com`, password: "Senha1234", data: { nome } }),
      }).catch(() => {});
    }
    const clientes = (await sql(db, "select id, nome from public.perfis where papel = 'cliente' order by criado_em")).rows;
    const produtos = (await sql(db, "select id, nome, preco, unidade from public.produtos where ativo order by id")).rows;
    if (!clientes.length || !produtos.length) return 0;
    let semente = 42;
    const acaso = () => (semente = (semente * 16807) % 2147483647) / 2147483647;
    const escolher = (lista) => lista[Math.floor(acaso() * lista.length)];
    const FORMA_RECEBIDA = { pix: "pix", dinheiro: "dinheiro", cartao_entrega: "cartao" };
    for (let i = 0; i < quantidade; i++) {
      const dias = Math.floor(acaso() ** 1.8 * 395); // mais pedidos nos meses recentes
      const criado = new Date(Date.now() - dias * 86400_000);
      criado.setUTCHours(11 + Math.floor(acaso() * 12), Math.floor(acaso() * 60)); // entre 8h e 20h em São Paulo
      const itens = Array.from({ length: acaso() < 0.3 ? 2 : 1 }, () => { const pr = escolher(produtos); const qtd = 1 + Math.floor(acaso() * 3); return { ...pr, qtd, total: pr.preco * qtd }; });
      const subtotal = itens.reduce((t, x) => t + x.total, 0);
      const tipo = acaso() < 0.45 ? "entrega" : "retirada";
      const frete = tipo === "entrega" ? 800 + Math.floor(acaso() * 8) * 100 : 0;
      const cupom = acaso() < 0.12 ? "BEMVINDO10" : null;
      const desconto = cupom ? Math.round(subtotal * 0.1) : 0;
      const total = subtotal + frete - desconto;
      const pagamento = escolher(["pix", "pix", "dinheiro", "cartao_entrega"]);
      const status = dias <= 2 ? escolher(["novo", "confirmado", "em_preparo"]) : acaso() < 0.07 ? "cancelado" : "entregue";
      const agendado = new Date(criado.getTime() + (1 + Math.floor(acaso() * 3)) * 86400_000);
      const cli = escolher(clientes);
      const [{ id }] = (await sql(db, `insert into public.pedidos (usuario_id, cliente_nome, cliente_telefone, status, tipo, data_agendada, hora_agendada, pagamento,
          subtotal, taxa_entrega, desconto, total, cupom, criado_em, atualizado_em, motivo_cancelamento)
        values ($1, $2, '11999990000', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13, $14) returning id`,
        [cli.id, cli.nome, status, tipo, agendado.toISOString().slice(0, 10), escolher(["10:00", "14:00", "16:00", "18:00"]), pagamento,
          subtotal, frete, desconto, total, cupom, criado.toISOString(), status === "cancelado" ? "Cliente desistiu" : null])).rows;
      await sql(db, "update public.pedidos set codigo = 'LA' || id where id = $1", [id]);
      for (const x of itens) {
        await sql(db, "insert into public.pedido_itens (pedido_id, produto_id, nome, unidade, preco_unit, qtd, total) values ($1, $2, $3, $4, $5, $6, $7)",
          [id, x.id, x.nome, x.unidade, x.preco, x.qtd, x.total]);
      }
      if (status === "entregue" || (status !== "cancelado" && acaso() < 0.4)) {
        await sql(db, "insert into public.pagamentos_pedido (pedido_id, valor, forma, criado_em) values ($1, $2, $3, $4)", [id, total, FORMA_RECEBIDA[pagamento], criado.toISOString()]);
        await sql(db, "update public.pedidos set pago = $2 where id = $1", [id, total]);
      }
    }
    return quantidade;
  }

  async function rotaTeste(req, res, caminho) {
    const corpo = req.method === "POST" ? await lerJson(req) : {};
    if (caminho === "/vendas-exemplo") return responder(res, 200, { criados: await criarVendasDeExemplo(Math.min(Number(corpo.quantidade) || 220, 2000)) });
    if (caminho === "/assinatura") { // "a Central escreveu a situação da mensalidade na ficha da loja"
      await sql(db, `insert into public.configuracoes (chave, valor) values ('forminha', $1::jsonb)
        on conflict (chave) do update set valor = public.configuracoes.valor || excluded.valor`, [JSON.stringify({ assinatura: corpo })]);
      return responder(res, 200, { ok: true });
    }
    if (caminho === "/mp/aprovar") { // "o cliente pagou no app do banco": aprova no Mercado Pago simulado e dispara o aviso ao webhook
      const pag = externos.pagamentoDoPedido(String(corpo.codigo));
      if (!pag) return responder(res, 404, { message: "Nenhum PIX gerado para este pedido." });
      externos.aprovar(pag.id);
      const r = await receberWebhook({ metodo: "POST", url: `${envFuncoes.SUPABASE_URL}/functions/v1/pix-webhook?data.id=${pag.id}&type=payment`, cabecalhos: {},
        corpoTexto: JSON.stringify({ type: "payment", data: { id: String(pag.id) } }) }, { env: envFuncoes, fetchFn: externos.fetchFn, rpc: rpcFuncoes });
      return responder(res, r.status, r.corpo);
    }
    if (caminho === "/mp/pagar-cartao") { // "o cliente pagou com cartão no checkout": cria o pagamento aprovado e dispara o aviso
      const { pedido } = (await sql(db, "select row_to_json(p) as pedido from public.pedidos p where codigo = $1", [String(corpo.codigo)])).rows[0] ?? {};
      if (!pedido) return responder(res, 404, { message: "Pedido não encontrado." });
      const pag = externos.pagarNoCheckout(pedido.codigo, (pedido.total - pedido.pago) / 100);
      const r = await receberWebhook({ metodo: "POST", url: `${envFuncoes.SUPABASE_URL}/functions/v1/pix-webhook?data.id=${pag.id}&type=payment`, cabecalhos: {},
        corpoTexto: JSON.stringify({ type: "payment", data: { id: String(pag.id) } }) }, { env: envFuncoes, fetchFn: externos.fetchFn, rpc: rpcFuncoes });
      return responder(res, r.status, r.corpo);
    }
    if (caminho === "/whatsapp") return responder(res, 200, { envios: externos.estado.metaEnvios });
    if (caminho === "/whatsapp/falha") { externos.estado.falhas.meta = corpo.erro ?? null; return responder(res, 200, { ok: true }); }
    return responder(res, 404, { message: "Controle inexistente" });
  }

  /* ---------- Central da Forminha (de mentira): pagamento online e domínio próprio pelo painel ---------- */
  // domínio: o "DNS" fica certo 15 s depois de ligar (dá para ver a tela passar de "aguardando" para "funcionando")
  let dominioFalso = null;
  const DNS_EM_MS = 15_000;
  function situacaoDoDominio(mudou = false) {
    const base = { endereco_loja: "http://localhost:3000", endereco_painel: "http://localhost:3001" };
    if (!dominioFalso) return { dominio: null, ...base, mudou };
    const raiz = raizDoDominio(dominioFalso.nome);
    const pronto = Date.now() - dominioFalso.criado >= DNS_EM_MS;
    const cfg = { recommendedIPv4: [{ rank: 1, value: ["216.198.79.1"] }], recommendedCNAME: [{ rank: 1, value: "d1d4fc829fe7bc7c.vercel-dns-017.com." }] };
    const enderecos = enderecosDoDominio(dominioFalso.nome, dominioFalso).map((e) => ({
      host: e.host, site: e.site, atalho: Boolean(e.redirecionar), ligado: true, ok: pronto, registros: [{ ...registroDoEndereco(e.host, raiz, cfg), ok: pronto }],
    }));
    return {
      dominio: dominioFalso.nome, painel: dominioFalso.painel, raiz, adicionado_em: new Date(dominioFalso.criado).toISOString(), ativo: pronto,
      situacao: pronto ? "ok" : "aguardando", enderecos, mudou,
      endereco_loja: pronto ? `https://${dominioFalso.nome}` : base.endereco_loja,
      endereco_painel: pronto && dominioFalso.painel ? `https://painel.${dominioFalso.nome}` : base.endereco_painel,
    };
  }

  async function rotaCentral(req, res, caminho) {
    const corsCentral = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "GET, POST, DELETE, OPTIONS" };
    const enviar = (status, corpo) => { res.writeHead(status, { ...corsCentral, "content-type": "application/json" }); res.end(JSON.stringify(corpo)); };
    const rotas = ["POST /api/loja/pagamento", "GET /api/loja/dominio", "POST /api/loja/dominio", "POST /api/loja/dominio/conferir", "DELETE /api/loja/dominio"];
    if (!rotas.includes(`${req.method} ${caminho}`)) return enviar(404, { erro: "Caminho não encontrado." });
    if (!(await ehAdmin(req))) return enviar(403, { erro: "Só a administradora da loja pode fazer isso. Entre de novo no painel." });
    if (caminho.startsWith("/api/loja/dominio")) {
      if (req.method === "GET") return enviar(200, situacaoDoDominio());
      if (req.method === "DELETE") { dominioFalso = null; return enviar(200, situacaoDoDominio(true)); }
      if (caminho.endsWith("/conferir")) {
        if (!dominioFalso) return enviar(409, { erro: "Esta loja não tem domínio próprio." });
        const r = situacaoDoDominio();
        const mudou = r.ativo && !dominioFalso.avisado;
        if (mudou) dominioFalso.avisado = true;
        return enviar(200, { ...r, mudou });
      }
      const corpo = await lerJson(req);
      let nome;
      try { nome = normalizarDominio(corpo.dominio); } catch (e) { return enviar(e.status ?? 422, { erro: e.message, campos: e.campos }); }
      const mesmo = dominioFalso?.nome === nome;
      dominioFalso = { nome, painel: corpo.painel !== false, criado: mesmo ? dominioFalso.criado : Date.now(), avisado: mesmo && dominioFalso.avisado };
      return enviar(200, situacaoDoDominio(true));
    }
    const { token } = await lerJson(req);
    if (!/^(APP_USR|TEST)-[\w-]{20,}$/.test(String(token ?? ""))) return enviar(422, { erro: "Cole o Access Token do Mercado Pago (começa com APP_USR-).", campos: { token: "Cole o Access Token (começa com APP_USR-)." } });
    const segredo = crypto.randomBytes(24).toString("hex");
    await sql(db, "select public.central_conectar_gateway($1::jsonb)", [JSON.stringify({ segredo, conta: "DOCERIA_SIMULADA", cartao: true })]);
    Object.assign(envFuncoes, { MP_ACCESS_TOKEN: token, SEGREDO_GATEWAY: segredo });
    return enviar(200, { conectado: true, conta: "DOCERIA_SIMULADA", pix: true, cartao: true });
  }

  /* ---------- Storage ---------- */
  /** A mesma regra das políticas do Storage (migração 24): administradora da loja dona da pasta do arquivo. */
  async function podeMexer(req, nome) {
    const claims = claimsDe(req);
    if (claims?.role !== "authenticated") return false;
    try { return (await comoUsuario(db, claims, "select public.e_admin_do_arquivo($1) as ok", [nome]))[0]?.ok === true; } catch { return false; }
  }

  async function rotaStorage(req, res, caminho) {
    const m = /^\/object\/(?:public\/)?([a-z0-9_-]+)\/(.+)$/.exec(caminho);
    if (req.method === "GET" && caminho.startsWith("/object/public/") && m) {
      const arq = arquivos.get(`${m[1]}/${decodeURIComponent(m[2])}`);
      if (!arq) return responder(res, 404, { statusCode: "404", error: "not_found", message: "Object not found" });
      res.writeHead(200, { ...cors, "content-type": arq.tipo, "cache-control": "public, max-age=31536000" });
      return res.end(arq.bytes);
    }

    const idBucket = m ? m[1] : (/^\/object\/([a-z0-9_-]+)$/.exec(caminho) ?? [])[1];
    const bucket = idBucket ? (await sql(db, "select * from storage.buckets where id = $1", [idBucket])).rows[0] : null;
    if (!bucket) return responder(res, 404, { statusCode: "404", error: "Bucket not found", message: "Bucket not found" });
    if (req.method === "DELETE" && caminho === `/object/${idBucket}`) {
      const { prefixes = [] } = await lerJson(req);
      for (const p of prefixes) {
        if (!(await podeMexer(req, p))) return responder(res, 403, { statusCode: "403", error: "Unauthorized", message: "new row violates row-level security policy" });
      }
      prefixes.forEach((p) => arquivos.delete(`${idBucket}/${p}`));
      return responder(res, 200, prefixes.map((name) => ({ name })));
    }
    if ((req.method === "POST" || req.method === "PUT") && m) {
      if (!(await podeMexer(req, decodeURIComponent(m[2])))) return responder(res, 403, { statusCode: "403", error: "Unauthorized", message: "new row violates row-level security policy" });
      const bruto = await lerCorpo(req);
      let arquivo;
      if (/multipart\/form-data/.test(req.headers["content-type"] ?? "")) {
        const dados = await new Response(bruto, { headers: { "content-type": req.headers["content-type"] } }).formData();
        arquivo = dados.get("");
        arquivo = { tipo: arquivo.type, bytes: Buffer.from(await arquivo.arrayBuffer()) };
      } else {
        arquivo = { tipo: req.headers["content-type"] ?? "application/octet-stream", bytes: bruto };
      }
      if (!bucket.allowed_mime_types.includes(arquivo.tipo)) return responder(res, 415, { statusCode: "415", error: "invalid_mime_type", message: `mime type ${arquivo.tipo} is not supported` });
      if (arquivo.bytes.length > Number(bucket.file_size_limit)) return responder(res, 413, { statusCode: "413", error: "Payload too large", message: "The object exceeded the maximum allowed size" });
      const nome = `${idBucket}/${decodeURIComponent(m[2])}`;
      if (arquivos.has(nome)) return responder(res, 400, { statusCode: "409", error: "Duplicate", message: "The resource already exists" });
      arquivos.set(nome, arquivo);
      return responder(res, 200, { Key: nome, Id: crypto.randomUUID() });
    }
    return responder(res, 404, { statusCode: "404", error: "not_found", message: "Rota de Storage não suportada no emulador" });
  }

  /* ---------- Servidor ---------- */
  const servidor = http.createServer(async (req, res) => {
    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, { ...cors, "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
          "access-control-allow-headers": req.headers["access-control-request-headers"] ?? "*", "access-control-max-age": "600" });
        return res.end();
      }
      const url = new URL(req.url, "http://emulador");
      const p = url.pathname;
      if (p.startsWith("/auth/v1")) return await rotaAuth(req, res, p.slice(8), url);
      if (p.startsWith("/rest/v1/rpc/")) return await rotaRpc(req, res, p.slice(13));
      if (p.startsWith("/storage/v1")) return await rotaStorage(req, res, p.slice(11));
      if (p.startsWith("/functions/v1/")) return await rotaFuncao(req, res, p.slice(14));
      if (p.startsWith("/__teste/")) return await rotaTeste(req, res, p.slice(8));
      if (p.startsWith("/central/")) return await rotaCentral(req, res, p.slice(8));
      return responder(res, 404, { message: "Rota não encontrada no emulador" });
    } catch (e) {
      console.error("[emulador]", e);
      responder(res, 500, { message: String(e.message) });
    }
  });
  await new Promise((ok) => servidor.listen(porta, "127.0.0.1", ok));
  envFuncoes.SUPABASE_URL = `http://127.0.0.1:${servidor.address().port}`;
  rpcFuncoes = criarRpc({ url: envFuncoes.SUPABASE_URL, chaveAnon, fetchFn: fetch });

  return {
    url: `http://127.0.0.1:${servidor.address().port}`,
    chaveAnon, db, emails,
    /** Cria uma conta de administrador (cadastra e promove no banco, como o SQL Editor faria). */
    /** Administradora de uma loja (loja = código ou endereço; sem loja = a única loja do banco). */
    async criarAdmin(email = "admin@teste.local", senha = "Admin12345", { loja = null } = {}) {
      const r = await fetch(`${this.url}/auth/v1/signup`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password: senha, data: { nome: "Administrador", ...(loja && { loja }) } }) });
      if (!r.ok && r.status !== 422) throw new Error(`Não criou o admin: ${r.status}`);
      await sql(db, "update public.perfis set papel = 'admin' where lower(email) = lower($1) and loja_id = public._loja_de($2)", [email, loja]);
      return { email, senha };
    },
    /** Outra loja no mesmo banco (como a Central faz no banco único): a linha da loja, os endereços e os dados iniciais. */
    async criarLoja({ codigo, nome = "", prefixo = "P", enderecos = [] }) {
      const id = (await sql(db, "insert into public.lojas (codigo, nome, prefixo_pedido) values ($1, $2, $3) returning id", [codigo, nome, prefixo])).rows[0].id;
      for (const host of enderecos) await sql(db, "insert into public.loja_enderecos (host, loja_id) values ($1, $2)", [host, id]);
      await executarNaLoja(db, id, lerSeed());
      return id;
    },
    async fechar() {
      servidor.closeAllConnections?.();
      await new Promise((ok) => servidor.close(ok));
      await db.close();
    },
  };
}
