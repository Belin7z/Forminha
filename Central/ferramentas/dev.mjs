/* ==========================================================
   DEV — a Central no seu computador: npm run dev  ->  http://localhost:3100
   • Sem chaves no .env: MODO DE TESTE (Supabase e Vercel imitados, nada é
     criado de verdade). Senha: forminha
   • Com SUPABASE_ACCESS_TOKEN, VERCEL_TOKEN, FORMINHA_ORG e CENTRAL_SENHA_HASH
     no .env: usa as contas DE VERDADE (cuidado: cria lojas reais).
   ========================================================== */
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { criarCentral } from "../lib/central.js";
import { resumirSenha } from "../lib/sessao.js";
import { novaChave } from "../lib/cofre.js";
import { criarEmail } from "../lib/email.js";
import { criarMercadoPago } from "../lib/mercadopago.js";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
if (existsSync(join(raiz, ".env"))) {
  for (const linha of readFileSync(join(raiz, ".env"), "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(linha);
    if (m && !linha.trimStart().startsWith("#") && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

const PORTA = Number(process.env.PORTA ?? 3100);
let env = { ...process.env };
let opcoes = {};
const deVerdade = Boolean(env.SUPABASE_ACCESS_TOKEN && env.VERCEL_TOKEN);
if (!deVerdade) {
  const { bancoDeTeste, criarSimulado } = await import("./simulado.js");
  const sim = criarSimulado({ prontoEmMs: 6000 });
  env = {
    ...env, ...sim.env, CENTRAL_SENHA_HASH: await resumirSenha("forminha"), CRON_SECRET: "cron-local",
    CHAVE_CRIPTOGRAFIA: novaChave(), URL_CENTRAL: `http://localhost:${PORTA}`,
  };
  opcoes = {
    fetchFn: sim.fetchFn, simulado: true, banco: await bancoDeTeste(), esperaBancoMs: 1500,
    // e-mails de teste aparecem aqui no terminal, em vez de sair de verdade
    email: criarEmail({ usuario: "forminha@teste.local", transporte: { sendMail: async (m) => console.log(`\n✉  E-mail (teste) para ${m.to}: ${m.subject}\n   ${String(m.text).split("\n").find((l) => l.includes("http")) ?? ""}\n`) } }),
    mercadoPago: criarMercadoPago({ token: "mp-simulado", fetchFn: sim.fetchFn }),
  };
}
env.SEGREDO_SESSAO ||= randomBytes(32).toString("hex");
const central = criarCentral(env, opcoes);

const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };
const cabecalhos = Object.fromEntries(JSON.parse(readFileSync(join(raiz, "vercel.json"), "utf8")).headers[0].headers
  .filter((h) => h.key !== "Strict-Transport-Security").map((h) => [h.key, h.value.replace("upgrade-insecure-requests", "")]));

createServer(async (req, res) => {
  const caminho = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (caminho.startsWith("/api/")) return central.tratar(req, res);
  let arquivo = resolve(raiz, "." + (caminho === "/" ? "/index.html" : caminho));
  const primeiro = relative(raiz, arquivo).split(sep)[0];
  if (!arquivo.startsWith(raiz + sep) || !["index.html", "src"].includes(primeiro)) { res.writeHead(403).end("Acesso negado"); return; }
  if ((await stat(arquivo).catch(() => null))?.isDirectory()) arquivo = join(arquivo, "index.html");
  const dados = await readFile(arquivo).catch(() => null);
  if (!dados) { res.writeHead(404).end("Não encontrado"); return; }
  res.writeHead(200, { ...cabecalhos, "Content-Type": TIPOS[extname(arquivo)] ?? "application/octet-stream", "Cache-Control": "no-store" });
  res.end(dados);
}).listen(PORTA, "127.0.0.1", () => {
  console.log(`\n✔ Central no ar → http://localhost:${PORTA}\n`);
  console.log(deVerdade ? "   ATENÇÃO: usando o Supabase e a Vercel DE VERDADE (cria lojas reais).\n"
    : "   Modo de teste: nada é criado de verdade.  Senha: forminha\n");
});
