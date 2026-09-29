/* ==========================================================
   FUNÇÕES DO SERVIDOR — peças comuns.
   Nada aqui depende do Deno: os testes rodam esta mesma lógica
   no Node, com o banco de teste e serviços externos simulados.
   ========================================================== */

/** Resposta padrão: { status, corpo }. */
export const resposta = (status, corpo = {}) => ({ status, corpo });

/** Extrai o token de login ("Authorization: Bearer …"). */
export function bearer(cabecalhos) {
  const m = /^Bearer\s+(.+)$/i.exec(cabecalhos.authorization ?? "");
  return m ? m[1].trim() : null;
}

/**
 * Chama uma função (RPC) do banco pela API do Supabase, com a chave pública e, quando houver, o
 * login de quem chamou — assim o banco aplica as permissões dessa pessoa. Não usa nenhuma chave secreta.
 */
export function criarRpc({ url, chaveAnon, fetchFn = fetch }) {
  return async function rpc(nome, p, jwt = null) {
    const r = await fetchFn(`${url}/rest/v1/rpc/${nome}`, {
      method: "POST",
      headers: { apikey: chaveAnon, Authorization: `Bearer ${jwt ?? chaveAnon}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p }),
    });
    const texto = await r.text();
    let dados = null;
    try { dados = texto ? JSON.parse(texto) : null; } catch { /* resposta que não é JSON */ }
    if (!r.ok) {
      const e = new Error(dados?.message ?? `Erro ${r.status}`);
      e.status = r.status;
      e.codigo = dados?.code ?? "";
      throw e;
    }
    return dados;
  };
}

/** Converte um erro do banco na resposta que a tela entende (mantém a mensagem em português das regras do banco). */
export function erroDoBanco(e) {
  const status = [400, 401, 403, 404, 409, 413, 422, 429].includes(e.status) ? e.status : 502;
  const mensagem = status === 502 ? "Serviço temporariamente indisponível. Tente de novo em instantes." : e.message;
  return resposta(status, { erro: mensagem });
}

/** "Bearer" de um JWT do Supabase sem conferir assinatura (a conferência é do banco): só para saber se veio algo. */
export const centavosParaReais = (c) => Math.round(Number(c)) / 100;

/** Quanto falta pagar agora: primeiro o sinal (se houver), depois o restante. Mesma regra do banco. */
export const valorDevido = (p) => (p.sinal > p.pago ? p.sinal - p.pago : Math.max(p.total - p.pago, 0));

/** O endereço de volta só vale se for de um dos sites da loja (ORIGENS_PERMITIDAS). Sem lista, nenhum. */
export function origemPermitida(endereco, permitidas = "") {
  let origem;
  try { origem = new URL(String(endereco ?? "")).origin; } catch { return null; }
  const lista = String(permitidas).split(",").map((x) => x.trim().replace(/\/+$/, "")).filter(Boolean);
  return lista.includes(origem) ? origem : null;
}

/** CORS: só os endereços da loja e do painel (ORIGENS_PERMITIDAS, separados por vírgula); sem configuração, aceita qualquer um. */
export function cabecalhosCors(origem, permitidas = "") {
  const lista = String(permitidas).split(",").map((x) => x.trim().replace(/\/+$/, "")).filter(Boolean);
  const liberado = lista.length === 0 ? "*" : (lista.includes(String(origem ?? "").replace(/\/+$/, "")) ? origem : null);
  const base = { "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", Vary: "Origin" };
  return liberado ? { ...base, "Access-Control-Allow-Origin": liberado } : base;
}

/** Junta a lógica ao Deno: traduz Request/Response e lê os segredos do ambiente. Só roda no Supabase. */
export function criarServidor(tratar, nomesEnv) {
  return async (req) => {
    const env = Object.fromEntries(nomesEnv.map((n) => [n, Deno.env.get(n) ?? ""]));
    const cors = cabecalhosCors(req.headers.get("origin"), env.ORIGENS_PERMITIDAS);
    const cabecalhos = Object.fromEntries([...req.headers.entries()].map(([k, v]) => [k.toLowerCase(), v]));
    const pedido = { metodo: req.method, url: req.url, cabecalhos, corpoTexto: req.method === "POST" ? await req.text() : "" };
    const fetchFn = (...a) => fetch(...a);
    const rpc = criarRpc({ url: env.SUPABASE_URL, chaveAnon: env.SUPABASE_ANON_KEY, fetchFn });
    let r;
    try { r = await tratar(pedido, { env, fetchFn, rpc }); }
    catch (e) { console.error("[erro]", e); r = resposta(500, { erro: "Algo deu errado. Tente novamente." }); }
    if (r.status === 204) return new Response(null, { status: 204, headers: cors });
    return new Response(JSON.stringify(r.corpo ?? {}), { status: r.status, headers: { ...cors, "Content-Type": "application/json" } });
  };
}
