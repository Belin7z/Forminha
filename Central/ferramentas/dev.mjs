/* ==========================================================
   DEV — a Central no seu computador: npm run dev  ->  http://localhost:3100
   • Sem chaves no .env: MODO DE TESTE (Supabase e Vercel imitados, nada é
     criado de verdade). Entrar com: teste@forminha.local / forminha
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
  // no modo de teste, o DNS de um domínio próprio "fica certo" 20 s depois de ligado
  const sim = criarSimulado({ prontoEmMs: 6000, dnsEmMs: 20_000 });
  env = {
    ...env, ...sim.env, CENTRAL_EMAIL: "teste@forminha.local", CENTRAL_SENHA_HASH: await resumirSenha("forminha"), CRON_SECRET: "cron-local",
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
}).listen(PORTA, "127.0.0.1", async () => {
  console.log(`\n✔ Central no ar → http://localhost:${PORTA}\n`);
  console.log(deVerdade ? "   ATENÇÃO: usando o Supabase e a Vercel DE VERDADE (cria lojas reais).\n"
    : "   Modo de teste: nada é criado de verdade.  Entrar com: teste@forminha.local / forminha\n");
  if (!deVerdade && process.env.EXEMPLO === "1") await exemplo();
});

/** EXEMPLO=1 (só no modo de teste): clientes e vendas espalhadas pelos últimos 14 meses, para ver os gráficos cheios. */
async function exemplo() {
  const base = `http://127.0.0.1:${PORTA}/api/`;
  const chamar = async (metodo, caminho, corpo, cookie) => {
    const r = await fetch(base + caminho, { method: metodo, headers: { "content-type": "application/json", ...(cookie && { cookie }) }, body: corpo && JSON.stringify(corpo) });
    return { dados: await r.json(), cookie: r.headers.get("set-cookie")?.split(";")[0] };
  };
  const { cookie } = await chamar("POST", "entrar", { usuario: "teste@forminha.local", senha: "forminha" });
  await chamar("PUT", "configuracoes", { valor_padrao_centavos: 19900, pix: { chave: "pix@forminha.test", nome: "Forminha", cidade: "Sao Paulo" } }, cookie);
  const nomes = ["Ana", "Bia", "Carla", "Dani", "Eva", "Fabi", "Gabi", "Helo", "Isa", "Ju", "Kika", "Lu", "Mari", "Nina", "Olga", "Pati", "Rita", "Sara", "Tati", "Vivi"];
  let n = 0;
  for (const [i, nome] of nomes.entries()) {
    const valor = [19900, 24900, 29900][i % 3];
    const { dados } = await chamar("POST", "clientes", { nome: `${nome} Doces`, email: `${nome.toLowerCase()}@exemplo.test`, nome_loja: `Doces da ${nome}`, valor_centavos: valor }, cookie);
    if (!dados.cliente) continue;
    if (i % 7 === 6) continue; // algumas ficam aguardando pagamento
    // pago e com a loja pronta direto no banco de teste (sem esperar a criação simulada de cada loja)
    const diasAtras = i < 6 ? i * 2 : Math.round(20 + (i - 6) * 28 + (i % 4) * 5); // várias neste mês, o resto espalhado
    await opcoes.banco.consultar(`update pagamentos set situacao = 'aprovado', confirmado_por = 'Dono', confirmado_em = now() - make_interval(days => $2::int)
      where cliente_id = $1 and situacao = 'pendente'`, [dados.cliente.id, diasAtras]);
    await opcoes.banco.consultar("update clientes set situacao = 'pago', etapa = 'pronta', criado_em = now() - make_interval(days => $2::int) where id = $1", [dados.cliente.id, diasAtras]);
    n += 1;
  }
  console.log(`   Exemplo: ${nomes.length} clientes e ${n} vendas nos últimos meses.\n`);
}
