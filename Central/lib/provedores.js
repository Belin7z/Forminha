/* ==========================================================
   PROVEDORES — conversa com o Supabase (bancos das lojas) e com a
   Vercel (sites das lojas) usando as chaves guardadas na Vercel.
   É o ÚNICO lugar que usa as chaves; elas nunca vão para o navegador.
   Nos testes e no modo simulado, `fetchFn` é trocado por imitações.
   ========================================================== */

export class ErroProvedor extends Error {
  constructor(quem, status, mensagem) {
    super(`${quem}: ${mensagem || `erro ${status}`}`);
    this.quem = quem;
    this.status = status;
  }
}

async function chamar(fetchFn, quem, url, token, metodo, corpo) {
  let r;
  try {
    r = await fetchFn(url, {
      method: metodo,
      headers: { Authorization: `Bearer ${token}`, ...(corpo === undefined ? {} : { "Content-Type": "application/json" }) },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
  } catch (erro) {
    throw new ErroProvedor(quem, 0, `sem conexão (${erro.message})`);
  }
  const texto = await r.text();
  let dados = null;
  try { dados = texto ? JSON.parse(texto) : null; } catch { dados = texto; }
  if (!r.ok) {
    const msg = typeof dados === "object" && dados ? dados.message ?? dados.error?.message ?? dados.error ?? JSON.stringify(dados) : texto;
    throw new ErroProvedor(quem, r.status, String(msg).slice(0, 300));
  }
  return dados;
}

/* ---------- Supabase (Management API) ---------- */
export function criarSupabase({ token, base = "https://api.supabase.com", fetchFn = fetch }) {
  const api = (metodo, caminho, corpo) => chamar(fetchFn, "Supabase", base + caminho, token, metodo, corpo);
  return {
    async projetosDaOrg(org) {
      const r = await api("GET", `/v1/organizations/${encodeURIComponent(org)}/projects?limit=100`);
      return Array.isArray(r) ? r : r?.projects ?? [];
    },
    projeto: (ref) => api("GET", `/v1/projects/${encodeURIComponent(ref)}`),
    criarProjeto: ({ nome, org, senhaBanco }) => api("POST", "/v1/projects", {
      name: nome, organization_slug: org, db_pass: senhaBanco, region_selection: { type: "specific", code: "sa-east-1" },
    }),
    excluirProjeto: (ref) => api("DELETE", `/v1/projects/${encodeURIComponent(ref)}`),
    reativar: (ref) => api("POST", `/v1/projects/${encodeURIComponent(ref)}/restore`, {}),
    /** Roda SQL no banco da loja. `parametros` ($1, $2…) protegem contra injeção nos dados digitados. */
    async sql(ref, query, parametros) {
      const r = await api("POST", `/v1/projects/${encodeURIComponent(ref)}/database/query`, parametros ? { query, parameters: parametros } : { query });
      return Array.isArray(r) ? r : r?.rows ?? r?.result ?? [];
    },
    /** Só as chaves públicas (anon/publishable): as secretas nunca são pedidas. */
    async chavePublica(ref) {
      const chaves = await api("GET", `/v1/projects/${encodeURIComponent(ref)}/api-keys`);
      const lista = Array.isArray(chaves) ? chaves : [];
      const escolhida = lista.find((k) => k.type === "publishable") ?? lista.find((k) => k.name === "anon");
      if (!/^(eyJ|sb_publishable_)/.test(String(escolhida?.api_key ?? ""))) throw new ErroProvedor("Supabase", 0, "não encontrei a chave pública do projeto");
      return escolhida.api_key;
    },
    /** Chave ADMINISTRATIVA da loja: só para o suporte (link de redefinir senha). Usada na hora e descartada:
        nunca é gravada, devolvida para a tela nem escrita em registro. */
    async chaveSecreta(ref) {
      const chaves = await api("GET", `/v1/projects/${encodeURIComponent(ref)}/api-keys?reveal=true`);
      const lista = Array.isArray(chaves) ? chaves : [];
      const escolhida = lista.find((k) => k.type === "secret") ?? lista.find((k) => k.name === "service_role");
      if (!/^(eyJ|sb_secret_)/.test(String(escolhida?.api_key ?? ""))) throw new ErroProvedor("Supabase", 0, "não consegui a chave administrativa da loja");
      return escolhida.api_key;
    },
    configurarLogin: (ref, dados) => api("PATCH", `/v1/projects/${encodeURIComponent(ref)}/config/auth`, dados),
  };
}

/* ---------- Vercel ---------- */
export function criarVercel({ token, time = "", base = "https://api.vercel.com", fetchFn = fetch }) {
  const q = (extra = "") => {
    const p = new URLSearchParams(extra);
    // a equipe pode vir pelo identificador (team_…) ou pelo apelido (ex.: belin7zs-projects)
    if (time) p.set(time.startsWith("team_") ? "teamId" : "slug", time);
    const s = p.toString();
    return s ? `?${s}` : "";
  };
  const api = (metodo, caminho, corpo) => chamar(fetchFn, "Vercel", base + caminho, token, metodo, corpo);
  return {
    /** Cria o site ligado a uma pasta do repositório (cada envio de código publica sozinho). Nome ocupado -> ErroProvedor 409. */
    criarProjeto: ({ nome, repo, pasta, variaveis }) => api("POST", `/v11/projects${q()}`, {
      name: nome, framework: null, gitRepository: { type: "github", repo }, rootDirectory: pasta || null,
      environmentVariables: Object.entries(variaveis).map(([key, value]) => ({ key, value, target: ["production", "preview"], type: "encrypted" })),
    }),
    publicar: ({ projetoId, nome, repo, ramo = "main" }) => {
      const [org, nomeRepo] = repo.split("/");
      return api("POST", `/v13/deployments${q()}`, { name: nome, project: projetoId, target: "production", gitSource: { type: "github", org, repo: nomeRepo, ref: ramo } });
    },
    async enderecos(projetoId) {
      const r = await api("GET", `/v9/projects/${encodeURIComponent(projetoId)}/domains${q()}`);
      return (r?.domains ?? []).map((d) => d.name);
    },
    excluirProjeto: (projetoId) => api("DELETE", `/v9/projects/${encodeURIComponent(projetoId)}${q()}`),
  };
}
