/* ==========================================================
   CADA SITE É PUBLICADO SOZINHO
   A Loja e o Dashboard vão para projetos separados da Vercel, cada um
   com a própria pasta como raiz. Estes testes copiam SÓ a pasta do site
   para outro lugar, montam o site e conferem que:
     - o build funciona sem nenhum arquivo de fora;
     - toda referência (scripts, estilos, mapa…) aponta para um arquivo
       que existe dentro do site;
     - o build recusa a chave secreta do Supabase.
   Rodar:  npm test
   ========================================================== */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DASHBOARD = join(dirname(fileURLToPath(import.meta.url)), "..", ".."); // esta pasta (Dashboard/)
const PASTAS = { loja: join(DASHBOARD, "..", "Loja"), dashboard: DASHBOARD };
const NOMES = { loja: "Loja", dashboard: "Dashboard" };
// o que faz parte do SITE (o Dashboard também guarda o banco, os guias e as ferramentas, que não vão para o ar)
const PARTES_DO_SITE = ["index.html", "src", "build", "vercel.json", "package.json"];

// chave "anon" de mentira, só para o build passar (nada é acessado)
const jwt = (papel) => `x.${Buffer.from(JSON.stringify({ role: papel })).toString("base64url")}.y`;
const ENV = { ...process.env, SUPABASE_URL: "https://exemplo.supabase.co", SUPABASE_ANON_KEY: jwt("anon"), URL_LOJA: "https://loja.exemplo.com" };

const listar = (pasta) => readdirSync(pasta, { withFileTypes: true, recursive: true }).filter((e) => e.isFile()).map((e) => join(e.parentPath ?? e.path, e.name));
const copiarSoOSite = (pasta) => {
  const temp = mkdtempSync(join(tmpdir(), "site-"));
  cpSync(pasta, temp, { recursive: true, filter: (o) => !/[\\/](node_modules|dist)([\\/]|$)/.test(o) });
  return temp;
};

for (const [site, pasta] of Object.entries(PASTAS)) {
  describe(`${NOMES[site]}: pasta independente`, () => {
    it("não usa nada de fora da própria pasta", () => {
      const problemas = [];
      const arquivos = PARTES_DO_SITE.flatMap((p) => (existsSync(join(pasta, p)) ? (p.includes(".") ? [join(pasta, p)] : listar(join(pasta, p))) : []));
      for (const f of arquivos.filter((x) => /\.(js|mjs|css|html|json)$/.test(x) && !/[\\/](node_modules|dist|vendor)[\\/]/.test(x))) {
        const texto = readFileSync(f, "utf8");
        const rel = f.slice(pasta.length + 1);
        if (/\/compartilhado\/|\/biblioteca\/|\.\.\/(Loja|Dashboard|supabase)\b/.test(texto)) problemas.push(`${rel} aponta para fora do site`);
        for (const m of texto.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*["'](\.\.\/[^"']+)["']/g)) {
          // "../" a mais do que a pasta permite = arquivo fora do site
          const profundidade = rel.split(/[\\/]/).length - 1;
          const sobe = m[1].match(/\.\.\//g).length;
          if (sobe > profundidade) problemas.push(`${rel} importa ${m[1]} (fora do site)`);
        }
      }
      assert.deepEqual(problemas, []);
    });

    it("build funciona só com a pasta do site e todas as referências resolvem", () => {
      const temp = copiarSoOSite(pasta);
      try {
        const r = spawnSync(process.execPath, ["build/montar.mjs", site], { cwd: temp, env: ENV, encoding: "utf8" });
        assert.equal(r.status, 0, `o build falhou:\n${r.stdout}\n${r.stderr}`);

        const dist = join(temp, "dist");
        for (const item of ["index.html", "config.js", "src/vendor/supabase.js", "src/scripts/main.js"]) assert.ok(existsSync(join(dist, item)), `dist/${item} não foi gerado`);
        assert.equal(existsSync(join(dist, "build")), false, "as ferramentas de build não vão para o site publicado");

        const config = readFileSync(join(dist, "config.js"), "utf8");
        assert.match(config, /"supabaseUrl":"https:\/\/exemplo\.supabase\.co"/);
        assert.equal(config.includes("service_role"), false);

        const faltando = [];
        const existe = (caminhoNoSite, origem) => { if (!existsSync(join(dist, caminhoNoSite))) faltando.push(`${origem} -> ${caminhoNoSite}`); };
        for (const arquivo of listar(dist).filter((f) => /\.(html|js|css)$/.test(f))) {
          const origem = arquivo.slice(dist.length + 1);
          const texto = readFileSync(arquivo, "utf8");
          const pasta = join(arquivo, "..");
          // endereços absolutos:  /src/... (scripts, estilos, mapa, favicon)
          for (const m of texto.matchAll(/["'(]\/(src\/[A-Za-z0-9_./-]+\.\w+)/g)) existe(m[1], origem);
          if (origem === "index.html") for (const m of texto.matchAll(/(?:href|src)="(src\/[^"]+)"/g)) existe(m[1], origem);
          if (/vendor/.test(origem)) continue; // bibliotecas de terceiros não são nossas
          // relativos:  @import "x.css"  e  import "./x.js"
          const refs = [...texto.matchAll(/@import\s+(?:url\(\s*)?["']?([^"');\s]+)/g)].map((m) => m[1]).filter((x) => !/^(\/|https?:|data:)/.test(x));
          if (arquivo.endsWith(".js")) refs.push(...[...texto.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)].map((m) => m[1]));
          for (const x of refs) if (!existsSync(join(pasta, x))) faltando.push(`${origem} -> ${x}`);
        }
        assert.deepEqual(faltando, [], "referências quebradas");
      } finally {
        rmSync(temp, { recursive: true, force: true });
      }
    });

    it("o build recusa a chave secreta (service_role)", () => {
      const temp = copiarSoOSite(pasta);
      try {
        const r = spawnSync(process.execPath, ["build/montar.mjs", site], { cwd: temp, env: { ...ENV, SUPABASE_ANON_KEY: jwt("service_role") }, encoding: "utf8" });
        assert.notEqual(r.status, 0);
        assert.match(r.stderr, /SECRETA/);
        assert.equal(existsSync(join(temp, "dist", "config.js")), false);
      } finally {
        rmSync(temp, { recursive: true, force: true });
      }
    });
  });
}
