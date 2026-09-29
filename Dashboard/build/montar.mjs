/* ==========================================================
   MONTAR — prepara a pasta de publicação DESTE site.
     node build/montar.mjs loja        (dentro de Loja/)
     node build/montar.mjs dashboard   (dentro de Dashboard/)
   A Vercel roda isto como "Build Command" (npm run build).
   Tudo o que precisa está dentro da própria pasta do site: junta
   index.html + src e gera o config.js a partir das variáveis de
   ambiente. Resultado em ./dist
   ========================================================== */
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { carregarAmbiente, configDoApp, textoDoConfig } from "./ambiente.mjs";
import { buscarLoja, faviconDaLoja, manifestoDaLoja, manifestoDoPainel, pacoteDoTema, personalizarHtmlLoja, personalizarHtmlPainel } from "./personalizar.mjs";

const pasta = join(dirname(fileURLToPath(import.meta.url)), "..");
const site = process.argv[2];

function falhar(mensagem) {
  console.error(`\n✖ ${mensagem}\n`);
  process.exit(1);
}

if (!["loja", "dashboard"].includes(site)) falhar('Use: node build/montar.mjs loja   ou   node build/montar.mjs dashboard');
for (const item of ["index.html", "src"]) {
  if (!existsSync(join(pasta, item))) falhar(`Não encontrei "${item}" na pasta do site.`);
}

carregarAmbiente(pasta);
let config;
try { config = configDoApp(site); } catch (e) { falhar(e.message); }

const saida = join(pasta, "dist");
await rm(saida, { recursive: true, force: true });
await mkdir(saida, { recursive: true });

await cp(join(pasta, "index.html"), join(saida, "index.html"));
await cp(join(pasta, "src"), join(saida, "src"), { recursive: true });
// arquivos que precisam ficar na raiz do site (aplicativo instalável, buscadores)
const RAIZ_EXTRAS = ["sw.js", "manifest.webmanifest", "robots.txt", "sitemap.xml"];
for (const arquivo of RAIZ_EXTRAS) if (existsSync(join(pasta, arquivo))) await cp(join(pasta, arquivo), join(saida, arquivo));

// nome, textos e cores DESTA loja (só na Vercel, ou pedindo com BUSCAR_LOJA=1): ver build/personalizar.mjs
if (process.env.VERCEL || process.env.BUSCAR_LOJA === "1") {
  try {
    const dados = await buscarLoja(config);
    config.tema = pacoteDoTema(dados.aparencia);
    const html = await readFile(join(saida, "index.html"), "utf8");
    await writeFile(join(saida, "index.html"), site === "loja" ? personalizarHtmlLoja(html, dados) : personalizarHtmlPainel(html, dados));
    await writeFile(join(saida, "src", "imagens", "favicon.svg"), faviconDaLoja(dados));
    if (existsSync(join(saida, "manifest.webmanifest"))) {
      const manifesto = JSON.parse(await readFile(join(saida, "manifest.webmanifest"), "utf8"));
      const personalizado = site === "loja" ? manifestoDaLoja(manifesto, dados) : manifestoDoPainel(manifesto, dados);
      await writeFile(join(saida, "manifest.webmanifest"), JSON.stringify(personalizado, null, 2));
    }
    console.log(`✔ personalizado para "${dados.loja.nome}"`);
  } catch (e) {
    console.warn(`! não consegui ler os dados da loja no banco (${e.message}).\n  O site sai com o visual padrão e se ajusta sozinho quando o visitante abrir.`);
  }
}
await writeFile(join(saida, "config.js"), textoDoConfig(config));
// mapa do site para o Google (usa o endereço público, se a Vercel ou o .env informarem)
const dominio = process.env.URL_SITE || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "");
if (site === "loja" && dominio) {
  const base = dominio.replace(/\/+$/, "");
  const mapa = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${base}/</loc></url></urlset>\n`;
  await writeFile(join(saida, "sitemap.xml"), mapa);
  await writeFile(join(saida, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n`);
}
// o Dashboard não deve aparecer em buscadores
if (site === "dashboard") await writeFile(join(saida, "robots.txt"), "User-agent: *\nDisallow: /\n");

console.log(`✔ ${site} montado em dist/  (Supabase: ${config.supabaseUrl})`);
