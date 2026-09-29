/* ==========================================================
   BANCO DE TESTE — um Postgres real (PGlite, em memória) com o
   mínimo do Supabase por cima: papéis anon/authenticated, o
   esquema `auth` (usuários e auth.uid()) e o `storage`.
   As migrações e o seed do projeto rodam SEM alteração.
   ========================================================== */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const PASTA_SQL = path.join(RAIZ, "supabase");

/** Peças que o Supabase já traz prontas em produção. */
export const BASE_SUPABASE = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  create schema auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text unique,
    encrypted_password text,
    raw_user_meta_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                           nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'), '')::uuid
  $$;

  create schema storage;
  create table storage.buckets (
    id text primary key, name text not null, public boolean not null default false,
    file_size_limit bigint, allowed_mime_types text[]
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id), name text, owner uuid
  );
  alter table storage.objects enable row level security;

  grant usage on schema public, auth, storage to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
`;

const ler = (arquivo) => fs.readFileSync(arquivo, "utf8");

/** semear: dados iniciais (configurações). exemplo: cardápio de exemplo (só para testes e para o "npm run dev"). */
export async function criarBanco({ semear = true, exemplo = true } = {}) {
  const db = new PGlite();
  await db.exec(BASE_SUPABASE);
  const migracoes = fs.readdirSync(path.join(PASTA_SQL, "migrations")).filter((f) => f.endsWith(".sql")).sort();
  for (const arquivo of migracoes) {
    try {
      await db.exec(ler(path.join(PASTA_SQL, "migrations", arquivo)));
    } catch (erro) {
      throw new Error(`Falha em ${arquivo}: ${erro.message}`);
    }
  }
  if (semear) await db.exec(ler(path.join(PASTA_SQL, "seed.sql")));
  if (semear && exemplo) await db.exec(ler(path.join(PASTA_SQL, "seed-exemplo.sql")));
  return db;
}

/* PGlite tem uma única conexão: as chamadas entram numa fila. */
const filas = new WeakMap();
function naFila(db, tarefa) {
  const anterior = filas.get(db) ?? Promise.resolve();
  const proxima = anterior.then(tarefa, tarefa);
  filas.set(db, proxima.catch(() => {}));
  return proxima;
}

/**
 * Executa uma função da API como o PostgREST faria: dentro de uma transação,
 * com o papel (anon/authenticated) e as claims do JWT definidos.
 */
export function executarRpc(db, { papel, claims = {}, cabecalhos = {} }, funcao, args) {
  if (!/^[a-z_][a-z0-9_]*$/.test(funcao)) throw new Error("Nome de função inválido");
  return naFila(db, async () => {
    await db.query("begin");
    try {
      await db.query(`set local role ${papel === "authenticated" ? "authenticated" : "anon"}`);
      await db.query("select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true), set_config('request.headers', $3, true)", [
        JSON.stringify(claims), claims.sub ?? "", JSON.stringify(cabecalhos), // o PostgREST também entrega os cabeçalhos da requisição
      ]);
      const temArgs = args !== undefined && args !== null;
      const r = temArgs
        ? await db.query(`select to_jsonb(public.${funcao}(p := $1::jsonb)) as r`, [JSON.stringify(args)])
        : await db.query(`select to_jsonb(public.${funcao}()) as r`);
      await db.query("commit");
      return r.rows[0]?.r ?? null;
    } catch (erro) {
      await db.query("rollback");
      throw erro;
    }
  });
}

/** SQL (vários comandos) dentro de uma loja do banco único, como a Central faz ao preparar uma loja nova. */
export function executarNaLoja(db, loja, texto) {
  if (!/^[0-9a-f-]{36}$/.test(String(loja))) throw new Error("Loja inválida");
  return naFila(db, () => db.exec(`begin; select set_config('forminha.loja', '${loja}', true);
${texto}
; commit;`));
}

/** Os dados iniciais de uma loja nova (supabase/seed.sql). */
export const lerSeed = () => ler(path.join(PASTA_SQL, "seed.sql"));

/** SQL como superusuário (para o emulador de Auth e para preparar cenários). */
export const sql = (db, texto, params) => naFila(db, () => db.query(texto, params));
