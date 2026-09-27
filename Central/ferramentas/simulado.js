/* ==========================================================
   SIMULADO — imita o Supabase (Management API) e a Vercel, para testar
   a Central sem criar nada de verdade (npm test e npm run dev sem chaves).
   Cada "projeto" criado ganha um Postgres de verdade em memória (PGlite)
   com o mínimo do Supabase: as migrações da loja rodam de verdade nele,
   pelo mesmo caminho (POST /database/query) usado em produção.
   ========================================================== */
import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

/** O que o Supabase já traz pronto num projeto novo (igual ao emulador do Dashboard). */
const BASE_SUPABASE = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(), email text unique, encrypted_password text,
    raw_user_meta_data jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                           nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'), '')::uuid
  $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text not null, public boolean not null default false, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id), name text, owner uuid);
  alter table storage.objects enable row level security;
  grant usage on schema public, auth, storage to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
`;

const letras = (n) => Array.from(randomBytes(n), (b) => "abcdefghijklmnopqrstuvwxyz"[b % 26]).join("");
const json = (status, corpo) => new Response(corpo === undefined ? null : JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });

/**
 * prontoEmMs: quanto tempo o banco novo leva para ficar "ACTIVE_HEALTHY" (0 nos testes, alguns segundos no npm run dev).
 * Devolve { fetchFn, estado } — estado guarda projetos, sites e chamadas, para os testes conferirem.
 */
export function criarSimulado({ prontoEmMs = 0, org = "org-simulada" } = {}) {
  const estado = { projetos: new Map(), sites: new Map(), publicacoes: [], cutucadas: [], chamadas: [] };
  const fila = new WeakMap(); // PGlite tem uma conexão só: uma consulta por vez
  const naFila = (db, tarefa) => { const p = (fila.get(db) ?? Promise.resolve()).then(tarefa, tarefa); fila.set(db, p.catch(() => {})); return p; };

  const statusDe = (p) => (p.pausado ? "INACTIVE" : Date.now() - p.criado >= prontoEmMs ? "ACTIVE_HEALTHY" : "COMING_UP");
  const publico = (p) => ({ id: p.ref, ref: p.ref, name: p.nome, organization_id: p.org, organization_slug: p.org, region: "sa-east-1", status: statusDe(p), created_at: new Date(p.criado).toISOString(), inserted_at: new Date(p.criado).toISOString() });

  async function supabase(metodo, caminho, corpo) {
    let m;
    if (metodo === "GET" && (m = /^\/v1\/organizations\/([^/]+)\/projects$/.exec(caminho))) {
      return json(200, { projects: [...estado.projetos.values()].filter((p) => p.org === m[1]).map(publico), pagination: {} });
    }
    if (metodo === "POST" && caminho === "/v1/projects") {
      if (!corpo?.name || !corpo?.organization_slug || !corpo?.db_pass) return json(400, { message: "name, organization_slug e db_pass são obrigatórios" });
      if (corpo.region_selection?.code !== "sa-east-1") return json(400, { message: "região inesperada" });
      const ref = letras(20);
      const db = new PGlite();
      await db.exec(BASE_SUPABASE);
      estado.projetos.set(ref, { ref, nome: corpo.name, org: corpo.organization_slug, criado: Date.now(), db, auth: {}, pausado: false });
      return json(201, publico(estado.projetos.get(ref)));
    }
    if (!(m = /^\/v1\/projects\/([a-z]+)(\/.*)?$/.exec(caminho))) return json(404, { message: "rota desconhecida" });
    const p = estado.projetos.get(m[1]);
    if (!p) return json(404, { message: "projeto não encontrado" });
    const resto = m[2] ?? "";
    if (metodo === "GET" && resto === "") return json(200, publico(p));
    if (metodo === "DELETE" && resto === "") { estado.projetos.delete(p.ref); await p.db.close(); return json(200, { id: p.ref, ref: p.ref, name: p.nome }); }
    if (metodo === "POST" && resto === "/restore") { p.pausado = false; p.criado = Date.now(); return json(200, {}); }
    if (statusDe(p) !== "ACTIVE_HEALTHY") return json(400, { message: "projeto não está ativo" });
    if (metodo === "POST" && resto === "/database/query") {
      return naFila(p.db, async () => {
        try {
          if (corpo.parameters?.length) return json(201, (await p.db.query(corpo.query, corpo.parameters)).rows);
          const resultados = await p.db.exec(corpo.query);
          return json(201, resultados.at(-1)?.rows ?? []);
        } catch (erro) {
          await p.db.exec("rollback").catch(() => {});
          return json(400, { message: `Failed to run sql query: ${erro.message}` });
        }
      });
    }
    if (metodo === "GET" && resto === "/api-keys") {
      return json(200, [
        { name: "anon", type: "legacy", api_key: `eyJhbGciOiJIUzI1NiJ9.anon-${p.ref}.simulado` },
        { name: "service_role", type: "legacy", api_key: "eyJ······ (segredo: nunca deveria ser usado)" },
      ]);
    }
    if (metodo === "PATCH" && resto === "/config/auth") { Object.assign(p.auth, corpo); return json(200, p.auth); }
    return json(404, { message: "rota desconhecida" });
  }

  async function vercel(metodo, caminho, corpo) {
    let m;
    if (metodo === "POST" && caminho === "/v11/projects") {
      if ([...estado.sites.values()].some((s) => s.nome === corpo.name)) return json(409, { error: { code: "conflict", message: `Project "${corpo.name}" already exists` } });
      if (!/^[a-z0-9-]{1,100}$/.test(corpo.name)) return json(400, { error: { message: "nome inválido" } });
      const id = `prj_${letras(16)}`;
      estado.sites.set(id, { id, nome: corpo.name, repo: corpo.gitRepository?.repo, pasta: corpo.rootDirectory, variaveis: Object.fromEntries((corpo.environmentVariables ?? []).map((v) => [v.key, v.value])) });
      return json(200, { id, name: corpo.name });
    }
    if (metodo === "POST" && caminho === "/v13/deployments") {
      if (!estado.sites.has(corpo.project)) return json(404, { error: { message: "projeto não encontrado" } });
      estado.publicacoes.push({ projeto: corpo.project, gitSource: corpo.gitSource, target: corpo.target });
      return json(200, { id: `dpl_${letras(12)}`, readyState: "QUEUED" });
    }
    if ((m = /^\/v9\/projects\/([^/]+)(\/domains)?$/.exec(caminho))) {
      const s = estado.sites.get(m[1]);
      if (!s) return json(404, { error: { code: "not_found", message: "Project not found" } });
      if (metodo === "GET" && m[2]) return json(200, { domains: [{ name: `${s.nome}.vercel.app` }] });
      if (metodo === "DELETE" && !m[2]) { estado.sites.delete(s.id); return json(204); }
    }
    return json(404, { error: { message: "rota desconhecida" } });
  }

  async function fetchFn(url, init = {}) {
    const u = new URL(url);
    const metodo = (init.method ?? "GET").toUpperCase();
    const corpo = init.body ? JSON.parse(init.body) : undefined;
    estado.chamadas.push({ metodo, url: u.href });
    const token = new Headers(init.headers).get("authorization");
    if (u.host === "api.supabase.com") return token === "Bearer token-supabase-simulado" ? supabase(metodo, u.pathname, corpo) : json(401, { message: "Unauthorized" });
    if (u.host === "api.vercel.com") return token === "Bearer token-vercel-simulado" ? vercel(metodo, u.pathname, corpo) : json(401, { error: { message: "Unauthorized" } });
    const cutucada = /^([a-z]{20})\.supabase\.co$/.exec(u.host);
    if (cutucada && u.pathname === "/rest/v1/rpc/loja_config") { estado.cutucadas.push(cutucada[1]); return json(200, { loja: {} }); }
    throw new Error(`o simulado não conhece ${u.href}`);
  }

  /** Pausa um projeto (como o Supabase grátis faz depois de dias sem uso). */
  const pausar = (ref) => { const p = estado.projetos.get(ref); if (p) p.pausado = true; };
  const fechar = async () => { for (const p of estado.projetos.values()) await p.db.close().catch(() => {}); };

  return { fetchFn, estado, pausar, fechar, org, env: { SUPABASE_ACCESS_TOKEN: "token-supabase-simulado", VERCEL_TOKEN: "token-vercel-simulado", FORMINHA_ORG: org } };
}
