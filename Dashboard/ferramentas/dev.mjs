/* ==========================================================
   DEV — ambiente local para experimentar antes de publicar.
     npm run dev
   Sobe a Loja (http://localhost:3000) e o Dashboard (http://localhost:3001)
   em endereços separados, como será na Vercel.

   • Sem configuração: liga um "mini-Supabase" local (banco de verdade em
     memória + as mesmas migrações), já com o cardápio de exemplo e um
     administrador de teste. Os dados somem ao fechar.
   • Com SUPABASE_URL e SUPABASE_ANON_KEY (no .env ou no terminal): usa o
     seu projeto Supabase de verdade.
   ========================================================== */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { carregarAmbiente, configDoApp, textoDoConfig } from "../build/ambiente.mjs";

const raiz = join(dirname(fileURLToPath(import.meta.url)), ".."); // a pasta Dashboard
carregarAmbiente(raiz);

// nome usado aqui -> pasta do site
const SITES = { loja: join(raiz, "..", "Loja"), dashboard: raiz };

const PORTA_LOJA = Number(process.env.PORTA_LOJA ?? 3000);
const PORTA_DASHBOARD = Number(process.env.PORTA_DASHBOARD ?? 3001);
const PORTA_SUPABASE = Number(process.env.PORTA_SUPABASE ?? 54321);

const TIPOS = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif",
  ".ico": "image/x-icon", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".map": "application/json", ".webmanifest": "application/manifest+json", ".xml": "application/xml",
};

/* ---------- Supabase: o de verdade (se configurado) ou o simulador local ---------- */
let emulador = null;
let conviteTeste = "";
let supabaseUrl;
let supabaseChave;

if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
  ({ supabaseUrl, supabaseAnonKey: supabaseChave } = configDoApp("loja"));
  console.log(`Usando o Supabase configurado: ${supabaseUrl}`);
} else {
  const { iniciarEmulador } = await import("./testes/emulador/servidor.js");
  console.log("Preparando o banco local (as migrações rodam agora, leva alguns segundos)…");
  // SEM_EXEMPLO=1 liga o banco de teste sem cardápio (como o banco de verdade nasce)
  emulador = await iniciarEmulador({ porta: PORTA_SUPABASE, exemplo: process.env.SEM_EXEMPLO !== "1" });
  supabaseUrl = emulador.url;
  supabaseChave = emulador.chaveAnon;
  await emulador.criarAdmin("admin@exemplo.com", "Admin12345");
  // um convite de primeiro acesso, para experimentar o caminho da dona de uma loja nova
  conviteTeste = (await emulador.db.query("select public._criar_convite(null, 7) as c")).rows[0].c;
}

/* ---------- Cabeçalhos de segurança: os mesmos do vercel.json de cada app ---------- */
function cabecalhosDe(app) {
  const conf = JSON.parse(readFileSync(join(SITES[app], "vercel.json"), "utf8"));
  const bloco = conf.headers.find((h) => h.source === "/(.*)");
  const cabecalhos = Object.fromEntries(bloco.headers.map(({ key, value }) => [key, value]));
  if (emulador) { // libera a conexão com o simulador local
    cabecalhos["Content-Security-Policy"] = cabecalhos["Content-Security-Policy"]
      .replace("connect-src ", `connect-src ${supabaseUrl} `)
      .replace("img-src ", `img-src ${supabaseUrl} `);
  }
  delete cabecalhos["Strict-Transport-Security"]; // localhost é http
  return cabecalhos;
}

/* ---------- Servidor de arquivos ---------- */
function servir(app, porta, config) {
  const pastaApp = SITES[app];
  // só o que vai para a Vercel: nunca expõe build/, package.json, .env…
  const PUBLICO = ["index.html", "src", "robots.txt", "sw.js", "manifest.webmanifest", "sitemap.xml"];
  const cabecalhos = cabecalhosDe(app);
  const configJs = textoDoConfig(config);

  const dentro = (base, alvo) => alvo === base || alvo.startsWith(base + sep);

  const servidor = createServer(async (req, res) => {
    try {
      const caminho = decodeURIComponent(new URL(req.url, "http://x").pathname);
      const resposta = (status, corpo, tipo = "text/plain; charset=utf-8") => {
        res.writeHead(status, { ...cabecalhos, "Content-Type": tipo, "Cache-Control": "no-store" });
        res.end(corpo);
      };

      if (caminho === "/config.js") return resposta(200, configJs, TIPOS[".js"]);

      let arquivo = resolve(pastaApp, "." + caminho);
      const primeiro = relative(pastaApp, arquivo).split(sep)[0];
      if (!dentro(pastaApp, arquivo) || (arquivo !== pastaApp && !PUBLICO.includes(primeiro))) return resposta(403, "Acesso negado");
      if ((await stat(arquivo).catch(() => null))?.isDirectory()) arquivo = join(arquivo, "index.html");
      const dados = await readFile(arquivo).catch(() => null);
      if (!dados) return resposta(404, "Não encontrado");
      resposta(200, dados, TIPOS[extname(arquivo).toLowerCase()] ?? "application/octet-stream");
    } catch {
      res.writeHead(400).end("Requisição inválida");
    }
  });
  return new Promise((ok, falhar) => {
    servidor.once("error", falhar);
    servidor.listen(porta, "127.0.0.1", () => ok(servidor));
  });
}

const urlLoja = `http://localhost:${PORTA_LOJA}`;
const urlDashboard = `http://localhost:${PORTA_DASHBOARD}`;
const base = { supabaseUrl, supabaseAnonKey: supabaseChave };

try {
  await servir("loja", PORTA_LOJA, { ...base, urlLoja: "" });
  // com o simulador, o próprio simulador faz o papel da Central (ligar o pagamento online pelo painel)
  await servir("dashboard", PORTA_DASHBOARD, { ...base, urlLoja, ...(emulador && { urlCentral: `${emulador.url}/central` }) });
} catch (erro) {
  console.error(erro.code === "EADDRINUSE" ? `\n✖ A porta ${erro.port ?? ""} já está em uso. Feche o outro terminal do "npm run dev" e tente de novo.\n` : erro);
  await emulador?.fechar();
  process.exit(1);
}

console.log(`
✔ Tudo no ar!

   Loja      → ${urlLoja}
   Dashboard → ${urlDashboard}
${emulador ? `
   Login do Dashboard (teste):  admin@exemplo.com  /  Admin12345
   Convite de primeiro acesso:  ${urlDashboard}/#/convite/${conviteTeste}
   ${process.env.SEM_EXEMPLO === "1" ? "Cardápio: vazio (SEM_EXEMPLO=1)" : "Cupom de exemplo:            BEMVINDO10"}
   (banco local em memória: os dados somem quando você fecha este terminal)
` : ""}
   Para parar: Ctrl+C
`);

process.on("SIGINT", async () => { await emulador?.fechar(); process.exit(0); });
