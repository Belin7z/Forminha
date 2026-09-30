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
export function criarRpc({ url, chaveAnon, fetchFn = fetch, loja = "" }) {
  return async function rpc(nome, p, jwt = null) {
    const r = await fetchFn(`${url}/rest/v1/rpc/${nome}`, {
      method: "POST",
      // banco único: toda chamada diz de qual loja é (o banco só mostra e só mexe nos dados dela)
      headers: { apikey: chaveAnon, Authorization: `Bearer ${jwt ?? chaveAnon}`, "Content-Type": "application/json", ...(loja && { "x-loja": loja }) },
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
  const base = { "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-loja", "Access-Control-Allow-Methods": "POST, OPTIONS", Vary: "Origin" };
  return liberado ? { ...base, "Access-Control-Allow-Origin": liberado } : base;
}

/* ---------- banco único: as chaves de cada loja ---------- */
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const deB64url = (t) => Uint8Array.from(atob(String(t).replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
async function chaveDoSegredo(segredoServidor, uso) {
  const bruto = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`forminha-segredos:${segredoServidor}`));
  return crypto.subtle.importKey("raw", bruto, { name: "AES-GCM" }, false, [uso]);
}

/** Cifra uma chave da loja ("v1.<iv>.<cifrado>", AES-256-GCM). A Central faz o mesmo em Node (lib/banco-unico.js). */
export async function cifrarSegredo(texto, segredoServidor) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cifrado = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await chaveDoSegredo(segredoServidor, "encrypt"), new TextEncoder().encode(String(texto)));
  return `v1.${b64url(iv)}.${b64url(cifrado)}`;
}

export async function decifrarSegredo(texto, segredoServidor) {
  const [versao, iv, cifrado] = String(texto ?? "").split(".");
  if (versao !== "v1" || !iv || !cifrado) throw new Error("segredo em formato desconhecido");
  const aberto = await crypto.subtle.decrypt({ name: "AES-GCM", iv: deB64url(iv) }, await chaveDoSegredo(segredoServidor, "decrypt"), deB64url(cifrado));
  return new TextDecoder().decode(aberto);
}

/** De qual loja é a chamada: o cabeçalho x-loja (o site manda) ou ?loja= (o aviso do Mercado Pago). */
export function lojaDaChamada({ url, cabecalhos }) {
  const daUrl = (() => { try { return new URL(url).searchParams.get("loja"); } catch { return null; } })();
  return String(cabecalhos?.["x-loja"] || daUrl || "").slice(0, 255);
}

/**
 * O ambiente da função PARA ESTA LOJA. Num banco de uma loja só, é o próprio ambiente (os segredos das funções).
 * No banco único (MULTILOJA=1), as chaves da loja vêm do banco, cifradas, e só abrem com o SEGREDO_SERVIDOR.
 * Lança um erro com status (404: loja desconhecida; 403: segredo errado) que vira resposta.
 */
export async function envDaLoja({ env, rpc, loja }) {
  if (env.MULTILOJA !== "1") return env;
  if (!loja) throw Object.assign(new Error("Loja não encontrada."), { status: 404 });
  const d = await rpc("servidor_segredos", { chave: env.SEGREDO_SERVIDOR });
  const abrir = async (k) => (d.segredos?.[k] ? decifrarSegredo(d.segredos[k], env.SEGREDO_SERVIDOR) : "");
  return {
    ...env, LOJA_CODIGO: d.codigo, URL_LOJA: d.endereco ?? "",
    ORIGENS_PERMITIDAS: (d.enderecos ?? []).map((h) => `https://${h}`).join(","),
    MP_ACCESS_TOKEN: await abrir("mp_token"), SEGREDO_GATEWAY: await abrir("segredo_gateway"), MP_WEBHOOK_SECRET: await abrir("mp_webhook_secret"),
    WHATSAPP_TOKEN: await abrir("whatsapp_token"), WHATSAPP_PHONE_ID: await abrir("whatsapp_phone_id"),
  };
}

/** Endereço de aviso do Mercado Pago: no banco único leva o código da loja (?loja=), para o aviso achar a loja certa. */
export const enderecoDoAviso = (env) => `${env.SUPABASE_URL}/functions/v1/pix-webhook${env.LOJA_CODIGO ? `?loja=${encodeURIComponent(env.LOJA_CODIGO)}` : ""}`;

/** Código de pedido: letras da loja + número (LA1001, DB1001). */
export const CODIGO_DO_PEDIDO = /^[A-Z]{1,4}\d{1,12}$/;

/** Junta a lógica ao Deno: traduz Request/Response e lê os segredos do ambiente. Só roda no Supabase. */
export function criarServidor(tratar, nomesEnv) {
  return async (req) => {
    const env = Object.fromEntries([...nomesEnv, "MULTILOJA", "SEGREDO_SERVIDOR"].map((n) => [n, Deno.env.get(n) ?? ""]));
    const cors = cabecalhosCors(req.headers.get("origin"), env.ORIGENS_PERMITIDAS);
    const cabecalhos = Object.fromEntries([...req.headers.entries()].map(([k, v]) => [k.toLowerCase(), v]));
    const pedido = { metodo: req.method, url: req.url, cabecalhos, corpoTexto: req.method === "POST" ? await req.text() : "" };
    const fetchFn = (...a) => fetch(...a);
    const loja = env.MULTILOJA === "1" ? lojaDaChamada(pedido) : "";
    const rpc = criarRpc({ url: env.SUPABASE_URL, chaveAnon: env.SUPABASE_ANON_KEY, fetchFn, loja });
    let r;
    try { r = await tratar(pedido, { env, fetchFn, rpc, loja }); }
    catch (e) { console.error("[erro]", e); r = resposta(500, { erro: "Algo deu errado. Tente novamente." }); }
    if (r.status === 204) return new Response(null, { status: 204, headers: cors });
    return new Response(JSON.stringify(r.corpo ?? {}), { status: r.status, headers: { ...cors, "Content-Type": "application/json" } });
  };
}
