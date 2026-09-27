/* ==========================================================
   MONTAR — prepara a parte visual da Central em ./dist (a Vercel roda
   isto no build). A API (api/ + lib/ + sql/) a Vercel publica sozinha.
   ========================================================== */
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pasta = join(dirname(fileURLToPath(import.meta.url)), "..");
const saida = join(pasta, "dist");
await rm(saida, { recursive: true, force: true });
await mkdir(saida, { recursive: true });
await cp(join(pasta, "index.html"), join(saida, "index.html"));
await cp(join(pasta, "src"), join(saida, "src"), { recursive: true });
await writeFile(join(saida, "robots.txt"), "User-agent: *\nDisallow: /\n");
console.log("✔ Central montada em dist/");
