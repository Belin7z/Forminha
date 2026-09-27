/* ==========================================================
   API SUPABASE — núcleo da loja.
   As telas falam com uma "API" de chamadas simples
   (api.get("/pedidos"), api.post("/pedidos", {...})). Aqui cada
   chamada é traduzida para uma função (RPC) do banco Supabase,
   e os erros voltam no mesmo formato de sempre (ErroApi).
   ========================================================== */
import { ErroApi } from "../http.js";

/**
 * Cria o cliente Supabase (o script da biblioteca é carregado no index.html).
 * Fluxo "implicit": o link do e-mail (recuperar senha / confirmar cadastro) funciona em qualquer aparelho,
 * inclusive quando o cliente pede no computador e abre o e-mail no celular — e quando é a loja
 * (painel) quem dispara o e-mail para o cliente. O fluxo PKCE exigiria o mesmo navegador.
 */
export function criarClienteSupabase({ url, chave, storageKey, fabrica = globalThis.supabase?.createClient, auth = {} }) {
  if (!fabrica) throw new Error("A biblioteca do Supabase não foi carregada.");
  if (!url || !chave) throw new Error("Configure SUPABASE_URL e SUPABASE_ANON_KEY (veja docs/PUBLICAR.md).");
  return fabrica(url, chave, {
    auth: { storageKey, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "implicit", ...auth },
  });
}

/* ---------- Erros ---------- */
const TEXTO_GENERICO = "Algo deu errado. Tente novamente.";

/** Converte o erro do PostgREST (funções do banco) em ErroApi. PT422 → HTTP 422, etc. */
export function erroDoBanco(error, status) {
  const codigo = String(error?.code ?? "");
  const propria = /^PT(\d{3})$/.exec(codigo);
  let http = propria ? Number(propria[1]) : Number(status) || 500;
  let mensagem = String(error?.message ?? "");
  let campos = null;
  try {
    const d = error?.details ? JSON.parse(error.details) : null;
    if (d && typeof d === "object" && !Array.isArray(d)) campos = d;
  } catch { /* detalhes não são JSON */ }

  if (!http || /failed to fetch|networkerror|load failed/i.test(mensagem)) {
    return new ErroApi(0, "Sem conexão com o servidor. Verifique a internet e tente de novo.");
  }
  if (codigo === "42501" || codigo.startsWith("PGRST30") || (http === 401 && !propria)) {
    return new ErroApi(401, "Faça login para continuar.");
  }
  if (!propria && http >= 500) console.error("[erro do banco]", error);
  if (!propria && http >= 400 && http < 500 && !mensagem) mensagem = TEXTO_GENERICO;
  return new ErroApi(http, propria || http < 500 ? mensagem || TEXTO_GENERICO : TEXTO_GENERICO, campos);
}

/** Erros do Supabase Auth em português. `campo` diz onde mostrar quando for erro de preenchimento. */
export function erroDeAuth(error, campo = "senha") {
  const codigo = error?.code ?? error?.error_code ?? "";
  const status = error?.status ?? 400;
  if (error?.name === "AuthSessionMissingError") {
    return new ErroApi(401, "Este link expirou ou já foi usado. Peça um novo e-mail de recuperação.");
  }
  switch (codigo) {
    case "invalid_credentials": return new ErroApi(401, "E-mail ou senha incorretos.");
    case "email_not_confirmed": return new ErroApi(401, "Confirme seu e-mail antes de entrar. Enviamos uma mensagem para você.");
    case "user_already_exists":
    case "email_exists": return new ErroApi(409, "Já existe uma conta com este e-mail.", { email: "Já existe uma conta com este e-mail." });
    case "weak_password": return new ErroApi(422, "Escolha uma senha mais forte (8+ caracteres, com letras e números).", { [campo]: "Senha fraca demais." });
    case "same_password": return new ErroApi(422, "A nova senha deve ser diferente da atual.", { [campo]: "A nova senha deve ser diferente da atual." });
    case "email_address_invalid": return new ErroApi(422, "Informe um e-mail válido.", { email: "Informe um e-mail válido." });
    case "over_request_rate_limit":
    case "over_email_send_rate_limit": return new ErroApi(429, "Muitas tentativas. Aguarde um pouco e tente de novo.");
    case "session_not_found":
    case "refresh_token_not_found": return new ErroApi(401, "Sua sessão expirou. Entre novamente.");
    default:
      if (/failed to fetch|network/i.test(String(error?.message))) return new ErroApi(0, "Sem conexão com o servidor. Verifique a internet e tente de novo.");
      return new ErroApi(status >= 400 ? status : 400, status >= 500 ? TEXTO_GENERICO : String(error?.message || TEXTO_GENERICO));
  }
}

/* ---------- Validação de senha (mesma regra do cadastro) ---------- */
export function validarSenha(senha, campo = "senha") {
  const s = String(senha ?? "");
  const msg = s.length < 8 ? "A senha deve ter pelo menos 8 caracteres."
    : s.length > 100 ? "A senha é longa demais."
    : !/[A-Za-z]/.test(s) || !/\d/.test(s) ? "A senha deve misturar letras e números." : null;
  if (msg) throw new ErroApi(422, msg, { [campo]: msg });
  return s;
}

/** Perfil de quem está logado (ou null). */
export async function perfilAtual({ rpc, supabase }) {
  const { data } = await supabase.auth.getSession();
  return data?.session ? rpc("perfil_atual") : null;
}

/** Troca de senha: confere a senha atual (entrando de novo) e só então atualiza. */
export async function trocarSenha({ supabase, corpo }) {
  const nova = validarSenha(corpo.nova, "nova");
  const { data } = await supabase.auth.getSession();
  if (!data?.session) throw new ErroApi(401, "Faça login para continuar.");
  const conferencia = await supabase.auth.signInWithPassword({ email: data.session.user.email, password: String(corpo.atual ?? "") });
  if (conferencia.error) throw new ErroApi(422, "A senha atual está incorreta.", { atual: "A senha atual está incorreta." });
  const { error } = await supabase.auth.updateUser({ password: nova });
  if (error) throw erroDeAuth(error, "nova");
  return { ok: true };
}

/**
 * Chama uma função do servidor (Edge Function do Supabase) com o login de quem está usando.
 * Os erros voltam como ErroApi, com a mensagem em português que a função mandou.
 */
export async function invocarFuncao(supabase, nome, corpo) {
  const { data, error } = await supabase.functions.invoke(nome, { body: corpo });
  if (!error) return data;
  const resposta = error.context;
  if (resposta && typeof resposta.json === "function") {
    let mensagem = "Não foi possível completar agora. Tente de novo em instantes.";
    try { const j = await resposta.json(); if (j?.erro) mensagem = j.erro; } catch { /* sem detalhe */ }
    throw new ErroApi(resposta.status ?? 502, mensagem);
  }
  throw new ErroApi(0, "Sem conexão com o servidor. Verifique a internet e tente de novo.");
}

/* ---------- Tradutor de chamadas ---------- */
function compilar(padrao) {
  const nomes = [];
  const regex = padrao.replace(/:([a-zA-Z]+)/g, (_, n) => (nomes.push(n), "([^/]+)"));
  return { nomes, regex: new RegExp(`^${regex}/?$`) };
}

/**
 * rotas: [["GET", "/pedidos/:id", async ({ params, consulta, corpo, rpc, supabase, contexto }) => …], …]
 * A ordem importa: rotas fixas ("/pedidos/contagem") vêm antes das com parâmetro.
 */
export function criarApi({ supabase, rotas, contexto = {} }) {
  const api = { aoExpirarSessao: null, supabase };
  const tabela = rotas.map(([metodo, padrao, fn]) => ({ metodo, fn, ...compilar(padrao) }));

  const rpc = async (nome, args) => {
    const r = args === undefined ? await supabase.rpc(nome) : await supabase.rpc(nome, { p: args });
    if (r.error) throw erroDoBanco(r.error, r.status);
    return r.data;
  };

  // Leituras (GET): repetem com pausa se a rede ou o servidor falharem, e chamadas idênticas ao mesmo tempo viram uma só.
  const emAndamento = new Map();
  const rpcLeitura = (nome, args) => {
    const chave = nome + JSON.stringify(args ?? null);
    if (emAndamento.has(chave)) return emAndamento.get(chave);
    const tarefa = (async () => {
      for (let tentativa = 0; ; tentativa++) {
        try { return await rpc(nome, args); }
        catch (e) {
          if (tentativa >= 2 || ![0, 502, 503, 504].includes(e.status)) throw e;
          await new Promise((ok) => setTimeout(ok, 400 * 2 ** tentativa + Math.random() * 200));
        }
      }
    })().finally(() => emAndamento.delete(chave));
    emAndamento.set(chave, tarefa);
    return tarefa;
  };

  // Freio: depois de um 429 ("muitas solicitações") numa leitura, o site espera alguns segundos em vez de insistir (ações do usuário não são travadas).
  let pausaAte = 0;
  const MENSAGEM_PAUSA = "Muitas solicitações em pouco tempo. Aguarde um instante e tente de novo.";

  async function chamar(metodo, caminho, corpo) {
    const [rota, textoConsulta = ""] = caminho.split("?");
    const consulta = Object.fromEntries(new URLSearchParams(textoConsulta));
    if (metodo === "GET" && Date.now() < pausaAte) throw new ErroApi(429, MENSAGEM_PAUSA);
    for (const r of tabela) {
      if (r.metodo !== metodo) continue;
      const m = r.regex.exec(rota);
      if (!m) continue;
      const params = Object.fromEntries(r.nomes.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
      try {
        return await r.fn({ params, consulta, corpo: corpo ?? {}, rpc: metodo === "GET" ? rpcLeitura : rpc, supabase, contexto });
      } catch (e) {
        const erro = e instanceof ErroApi ? e : /failed to fetch|network/i.test(String(e?.message))
          ? new ErroApi(0, "Sem conexão com o servidor. Verifique a internet e tente de novo.")
          : (console.error("[erro]", e), new ErroApi(500, TEXTO_GENERICO));
        if (erro.status === 401) api.aoExpirarSessao?.(erro);
        if (erro.status === 429 && metodo === "GET") pausaAte = Date.now() + 5000;
        throw erro;
      }
    }
    throw new ErroApi(404, "Rota não encontrada.");
  }

  api.get = (c) => chamar("GET", c);
  api.post = (c, corpo = {}) => chamar("POST", c, corpo);
  api.put = (c, corpo = {}) => chamar("PUT", c, corpo);
  api.patch = (c, corpo = {}) => chamar("PATCH", c, corpo);
  api.delete = (c) => chamar("DELETE", c);
  return api;
}
