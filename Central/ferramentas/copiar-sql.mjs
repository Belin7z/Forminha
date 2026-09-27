/* COPIAR SQL — traz as migrações e o seed do Dashboard (a fonte da verdade) para a Central.
   Rode depois de criar uma migração nova:  npm run copiar-sql  (e publique a Central). */
import { copyFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const origem = join(raiz, "..", "Dashboard", "supabase");
const destino = join(raiz, "sql");
for (const f of readdirSync(join(destino, "migrations"))) rmSync(join(destino, "migrations", f));
const lista = readdirSync(join(origem, "migrations")).filter((f) => f.endsWith(".sql")).sort();
for (const f of lista) copyFileSync(join(origem, "migrations", f), join(destino, "migrations", f));
copyFileSync(join(origem, "seed.sql"), join(destino, "seed.sql"));
console.log(`✔ ${lista.length} migrações + seed.sql copiados do Dashboard`);
