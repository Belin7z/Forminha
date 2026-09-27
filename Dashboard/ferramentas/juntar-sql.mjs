/* ==========================================================
   JUNTAR SQL — reúne as migrações + os dados de exemplo em UM arquivo
   para colar de uma vez no SQL Editor do Supabase.
     npm run sql   ->  supabase/instalar-tudo.sql
   ========================================================== */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const pasta = join(raiz, "supabase");
const migracoes = readdirSync(join(pasta, "migrations")).filter((f) => f.endsWith(".sql")).sort();

const partes = [
  "-- ==========================================================\n" +
  "-- INSTALAÇÃO COMPLETA (gerado por `npm run sql` — não edite à mão)\n" +
  "-- Cole tudo no SQL Editor do Supabase e clique em RUN.\n" +
  "-- Rode UMA vez num projeto novo e vazio.\n" +
  "-- ==========================================================\n",
  ...migracoes.map((f) => `\n-- >>>>>>>>>> ${f}\n${readFileSync(join(pasta, "migrations", f), "utf8")}`),
  `\n-- >>>>>>>>>> seed.sql (configurações iniciais; o cardápio começa vazio)\n${readFileSync(join(pasta, "seed.sql"), "utf8")}`,
];

writeFileSync(join(pasta, "instalar-tudo.sql"), partes.join(""));
console.log(`✔ supabase/instalar-tudo.sql gerado (${migracoes.length} migrações + seed).`);
