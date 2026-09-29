/* COPIAR SQL — traz do Dashboard (a fonte da verdade) para a Central:
     • as migrações e o seed do banco das lojas;
     • as funções do servidor (pagamento online e avisos), que a Central instala em cada loja.
   Rode depois de mudar qualquer uma delas:  npm run copiar-sql  (e publique a Central). */
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FUNCOES } from "../lib/funcoes.js";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const origem = join(raiz, "..", "Dashboard", "supabase");
const destino = join(raiz, "sql");
for (const f of readdirSync(join(destino, "migrations"))) rmSync(join(destino, "migrations", f));
const lista = readdirSync(join(origem, "migrations")).filter((f) => f.endsWith(".sql")).sort();
for (const f of lista) copyFileSync(join(origem, "migrations", f), join(destino, "migrations", f));
copyFileSync(join(origem, "seed.sql"), join(destino, "seed.sql"));

// funções: só os arquivos que vão para o Supabase (a lógica, a entrada e as peças comuns)
const funcoes = join(destino, "funcoes");
if (existsSync(funcoes)) rmSync(funcoes, { recursive: true });
mkdirSync(join(funcoes, "_shared"), { recursive: true });
copyFileSync(join(origem, "functions", "_shared", "comum.js"), join(funcoes, "_shared", "comum.js"));
for (const nome of FUNCOES) {
  mkdirSync(join(funcoes, nome));
  for (const f of ["index.ts", "logica.js"]) copyFileSync(join(origem, "functions", nome, f), join(funcoes, nome, f));
}
console.log(`✔ ${lista.length} migrações + seed.sql + ${FUNCOES.length} funções copiados do Dashboard`);
