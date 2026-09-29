/* ==========================================================
   BANCO DA LOJA — prepara e atualiza o banco de cada loja pela API.
   • As migrações (sql/migrations, cópia de Dashboard/supabase) entram
     uma por vez, cada uma numa transação, e ficam anotadas na mesma
     tabela que a linha de comando do Supabase usa. Por isso dá para
     parar e continuar a qualquer momento (e atualizar lojas antigas).
   • Depois vem o seed (loja zerada), o nome da loja e a ficha "forminha"
     (código, e-mail da dona, sites) — guardada no próprio banco da loja.
   ========================================================== */
import { readFileSync, readdirSync } from "node:fs";

const PASTA_SQL = new URL("../sql/", import.meta.url);
const ARQUIVO = /^(\d{14})_([a-z0-9_]+)\.sql$/;

/** Todas as migrações, em ordem: [{ versao, nome, arquivo }]. */
export function migracoes() {
  return readdirSync(new URL("migrations/", PASTA_SQL)).map((arquivo) => {
    const m = ARQUIVO.exec(arquivo);
    return m && { versao: m[1], nome: m[2], arquivo };
  }).filter(Boolean).sort((a, b) => a.versao.localeCompare(b.versao));
}

const lerSql = (caminho) => readFileSync(new URL(caminho, PASTA_SQL), "utf8");

const CONTROLE = `create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);`;

/** O que já foi feito no banco da loja (funciona até no banco recém-criado, ainda vazio). */
export async function situacao(sb, ref) {
  const [existe] = await sb.sql(ref, `select to_regclass('supabase_migrations.schema_migrations') is not null as migracoes,
    to_regclass('public.configuracoes') is not null as configuracoes`);
  const aplicadas = existe?.migracoes
    ? (await sb.sql(ref, "select version from supabase_migrations.schema_migrations")).map((r) => r.version) : [];
  let ficha = null, semeada = false;
  if (existe?.configuracoes) {
    const linhas = await sb.sql(ref, "select chave, valor from public.configuracoes where chave in ('forminha', 'loja')");
    ficha = linhas.find((l) => l.chave === "forminha")?.valor ?? null;
    semeada = linhas.some((l) => l.chave === "loja");
  }
  const todas = migracoes();
  const pendentes = todas.filter((m) => !aplicadas.includes(m.versao));
  return { total: todas.length, feitas: todas.length - pendentes.length, pendentes, semeada, ficha: typeof ficha === "string" ? JSON.parse(ficha) : ficha };
}

/** Aplica a PRÓXIMA migração pendente (uma por chamada, para caber no tempo de uma requisição). */
export async function aplicarProxima(sb, ref) {
  await sb.sql(ref, CONTROLE);
  const antes = await situacao(sb, ref);
  const proxima = antes.pendentes[0];
  if (!proxima) return { aplicada: null, feitas: antes.feitas, total: antes.total };
  await sb.sql(ref, `begin;
${lerSql(`migrations/${proxima.arquivo}`)}
;
insert into supabase_migrations.schema_migrations (version, name) values ('${proxima.versao}', '${proxima.nome}');
commit;`);
  return { aplicada: proxima, feitas: antes.feitas + 1, total: antes.total };
}

/** Loja zerada (seed) + nome da loja + ficha da Forminha. Pode repetir sem estragar nada. */
export async function semear(sb, ref, { nome, codigo, email }) {
  await sb.sql(ref, lerSql("seed.sql")); // o seed não sobrescreve o que já existe
  await sb.sql(ref, "update public.configuracoes set valor = jsonb_set(valor, '{nome}', to_jsonb($1::text)) where chave = 'loja'", [nome]);
  await gravarFicha(sb, ref, { codigo, nome, email, criada_em: new Date().toISOString() });
}

/** Junta dados na ficha "forminha" da loja (não aparece no site; a dona não consegue alterar). */
export async function gravarFicha(sb, ref, dados) {
  // sem "on conflict": serve antes e depois da migração 24 (quando a chave da tabela passou a incluir a loja)
  await sb.sql(ref, `with atualizada as (
      update public.configuracoes set valor = valor || $1::jsonb where chave = 'forminha' returning 1)
    insert into public.configuracoes (chave, valor) select 'forminha', $1::jsonb where not exists (select 1 from atualizada)`, [JSON.stringify(dados)]);
}

/** Convite de primeiro acesso (vale 7 dias, uma vez). Devolve o código que vai no link. */
export async function gerarConvite(sb, ref, email) {
  const [linha] = await sb.sql(ref, "select public._criar_convite($1, 7) as codigo", [email || null]);
  if (!linha?.codigo) throw new Error("o banco não devolveu o código do convite");
  return linha.codigo;
}
