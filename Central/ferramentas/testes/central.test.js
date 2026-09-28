/* ==========================================================
   CENTRAL — o caminho inteiro de uma loja, com Supabase e Vercel simulados
   (as migrações rodam de verdade num Postgres em memória):
   login -> criar -> preparar o banco -> publicar -> convite -> listar
   -> manter ativo -> excluir. E as travas de segurança.
   ========================================================== */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { criarCentral } from "../../lib/central.js";
import { resumirSenha } from "../../lib/sessao.js";
import { PADRAO_CODIGO, gerarCodigo, lerNomeDoProjeto, slug } from "../../lib/codigo.js";
import { migracoes } from "../../lib/banco.js";
import { criarSimulado } from "../simulado.js";

const SENHA = "senha-da-central-2026";
let sim, servidor, base, cookie = "";

async function api(metodo, caminho, corpo, { semCookie = false, cabecalhos = {} } = {}) {
  const r = await fetch(base + "/api/" + caminho, {
    method: metodo,
    headers: { ...(corpo !== undefined && { "content-type": "application/json" }), ...(!semCookie && cookie && { cookie }), ...cabecalhos },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const dados = await r.json().catch(() => null);
  return { status: r.status, dados, cookie: r.headers.get("set-cookie") };
}

before(async () => {
  sim = criarSimulado();
  const env = { ...sim.env, CENTRAL_SENHA_HASH: await resumirSenha(SENHA), SEGREDO_SESSAO: "segredo-de-teste-".padEnd(48, "x"), CRON_SECRET: "cron-de-teste" };
  const central = criarCentral(env, { fetchFn: sim.fetchFn });
  servidor = createServer((req, res) => central.tratar(req, res));
  await new Promise((ok) => servidor.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(async () => { servidor?.close(); await sim?.fechar(); });

describe("código e nomes", () => {
  it("código no formato 7XT-Tna-dRe, sem letras que confundem e sem repetir", () => {
    const vistos = new Set();
    for (let i = 0; i < 2000; i++) {
      const c = gerarCodigo();
      assert.match(c, PADRAO_CODIGO);
      assert.doesNotMatch(c, /[0O1lI]/, `${c} tem letra que confunde`);
      vistos.add(c);
    }
    assert.equal(vistos.size, 2000);
  });
  it("nomes de projeto e de site", () => {
    assert.deepEqual(lerNomeDoProjeto("7XT-Tna-dRe · Doce da Ana"), { codigo: "7XT-Tna-dRe", nome: "Doce da Ana" });
    assert.equal(lerNomeDoProjeto("E-Commerce"), null, "projetos fora do padrão são ignorados");
    assert.equal(lerNomeDoProjeto("0OO-111-lll · Loja"), null, "código com letras proibidas não vale");
    assert.equal(slug("Ateliê  Doce da Érica!"), "atelie-doce-da-erica");
    assert.equal(slug("🍰"), "loja");
  });
  it("as migrações da Central são as mesmas do Dashboard (npm run copiar-sql)", (t) => {
    const dash = new URL("../../../Dashboard/supabase/", import.meta.url);
    if (!existsSync(dash)) return t.skip("pasta do Dashboard não está ao lado");
    const daqui = new URL("../../sql/", import.meta.url);
    const lista = readdirSync(new URL("migrations/", dash)).filter((f) => f.endsWith(".sql")).sort();
    assert.deepEqual(migracoes().map((m) => m.arquivo), lista);
    for (const f of lista) assert.equal(readFileSync(new URL(`migrations/${f}`, daqui), "utf8"), readFileSync(new URL(`migrations/${f}`, dash), "utf8"), `${f} está diferente: rode npm run copiar-sql`);
    assert.equal(readFileSync(new URL("seed.sql", daqui), "utf8"), readFileSync(new URL("seed.sql", dash), "utf8"), "seed.sql está diferente: rode npm run copiar-sql");
  });
});

describe("entrada", () => {
  it("sem login, nada de lojas", async () => {
    assert.equal((await api("GET", "lojas")).status, 401);
    assert.equal((await api("POST", "lojas", { nome: "X", email: "x@y.com" })).status, 401);
    assert.deepEqual((await api("GET", "eu")).dados, { logado: false, quem: null, permissoes: [], faltando: [], chaves: [], simulado: false, recursos: null });
  });
  it("senha errada é recusada e, depois de várias, dá um tempo", async () => {
    const r = await api("POST", "entrar", { senha: "errada" });
    assert.equal(r.status, 401);
    assert.equal(r.cookie, null);
  });
  it("senha certa entra com cookie seguro (HttpOnly, SameSite=Strict)", async () => {
    const r = await api("POST", "entrar", { senha: SENHA });
    assert.equal(r.status, 200);
    assert.match(r.cookie, /HttpOnly/);
    assert.match(r.cookie, /SameSite=Strict/);
    cookie = r.cookie.split(";")[0];
    assert.equal((await api("GET", "eu")).dados.logado, true);
  });
  it("cookie adulterado não vale", async () => {
    const [corpo, assinatura] = cookie.split("=")[1].split(".");
    const outro = Buffer.from(JSON.stringify({ exp: 9999999999 })).toString("base64url");
    assert.equal((await api("GET", "lojas", undefined, { semCookie: true, cabecalhos: { cookie: `forminha_sessao=${outro}.${assinatura}` } })).status, 401);
    assert.ok(corpo);
  });
  it("rota pública não conta ao visitante o que falta configurar", async () => {
    const r = await api("GET", "publico/pagamento/abcdefghijklmnopqrstuvwx", undefined, { semCookie: true });
    assert.equal(r.status, 503);
    assert.doesNotMatch(r.dados.erro, /DATABASE_URL|CHAVE|TOKEN/);
  });
  it("pedido vindo de outro site é barrado", async () => {
    const r = await api("POST", "lojas", { nome: "Loja", email: "a@b.com" }, { cabecalhos: { origin: "https://site-malicioso.com" } });
    assert.equal(r.status, 403);
  });
});

describe("criar uma loja do começo ao fim", () => {
  let loja;
  it("valida nome e e-mail", async () => {
    const r = await api("POST", "lojas", { nome: "A", email: "sem-arroba" });
    assert.equal(r.status, 422);
    assert.ok(r.dados.campos.nome && r.dados.campos.email);
  });

  it("1. cria o projeto '<código> · <nome>' na organização da Forminha, em São Paulo", async () => {
    const r = await api("POST", "lojas", { nome: "Doce da Ana", email: "Ana@Doceria.com" });
    assert.equal(r.status, 200, JSON.stringify(r.dados));
    loja = r.dados;
    assert.match(loja.codigo, PADRAO_CODIGO);
    const p = sim.estado.projetos.get(loja.ref);
    assert.equal(p.nome, `${loja.codigo} · Doce da Ana`);
    assert.equal(p.org, sim.org);
  });

  it("2. mostra a etapa até o banco ficar pronto", async () => {
    const r = await api("GET", `lojas/${loja.ref}`);
    assert.equal(r.status, 200);
    assert.equal(r.dados.etapa, "tabelas", "no simulado o banco já nasce pronto");
    assert.equal(r.dados.feitas, 0);
  });

  it("3. aplica as migrações uma por vez e, no fim, prepara a loja zerada", async () => {
    const total = migracoes().length;
    let r, voltas = 0;
    do { r = await api("POST", `lojas/${loja.ref}/preparar`, { email: "ana@doceria.com" }); voltas++; assert.equal(r.status, 200, JSON.stringify(r.dados)); }
    while (r.dados.etapa === "tabelas" && voltas < total + 5);
    assert.equal(voltas, total + 1, "uma chamada por migração + o seed");
    assert.equal(r.dados.etapa, "sites");
    const db = sim.estado.projetos.get(loja.ref).db;
    const { rows } = await db.query("select valor from public.configuracoes where chave = 'loja'");
    assert.equal(rows[0].valor.nome, "Doce da Ana", "o nome da loja foi gravado");
    const ficha = (await db.query("select valor from public.configuracoes where chave = 'forminha'")).rows[0].valor;
    assert.equal(ficha.codigo, loja.codigo);
    assert.equal(ficha.email, "ana@doceria.com");
    const n = (await db.query("select count(*)::int n from supabase_migrations.schema_migrations")).rows[0].n;
    assert.equal(n, total);
    // repetir não estraga nada
    const de_novo = await api("POST", `lojas/${loja.ref}/preparar`, {});
    assert.equal(de_novo.dados.etapa, "sites");
  });

  it("4. publica a loja e o painel na Vercel, com a chave PÚBLICA, e ajusta o login", async () => {
    const r = await api("POST", `lojas/${loja.ref}/publicar`, {});
    assert.equal(r.status, 200, JSON.stringify(r.dados));
    assert.equal(r.dados.loja, "https://doce-da-ana.vercel.app");
    assert.equal(r.dados.painel, "https://doce-da-ana-painel.vercel.app");
    const sites = [...sim.estado.sites.values()];
    const lojaSite = sites.find((s) => s.nome === "doce-da-ana");
    const painelSite = sites.find((s) => s.nome === "doce-da-ana-painel");
    assert.equal(lojaSite.repo, "Belin7z/Forminha", "repositório oficial (um só)");
    assert.equal(painelSite.repo, "Belin7z/Forminha");
    assert.equal(lojaSite.pasta, "Loja", "a loja publica da pasta Loja");
    assert.equal(painelSite.pasta, "Dashboard", "o painel publica da pasta Dashboard");
    assert.equal(lojaSite.variaveis.SUPABASE_URL, `https://${loja.ref}.supabase.co`);
    assert.match(lojaSite.variaveis.SUPABASE_ANON_KEY, /anon-/, "usa a chave anon");
    assert.equal(painelSite.variaveis.URL_LOJA, "https://doce-da-ana.vercel.app");
    for (const s of sites) assert.ok(!JSON.stringify(s.variaveis).includes("segredo"), "a chave secreta nunca vai para os sites");
    assert.equal(sim.estado.publicacoes.length, 2, "os 2 sites foram publicados");
    const auth = sim.estado.projetos.get(loja.ref).auth;
    assert.equal(auth.site_url, "https://doce-da-ana.vercel.app");
    assert.equal(auth.uri_allow_list, "https://doce-da-ana.vercel.app/**,https://doce-da-ana-painel.vercel.app/**");
    assert.equal(auth.mailer_autoconfirm, true);
    // publicar de novo não cria sites duplicados
    await api("POST", `lojas/${loja.ref}/publicar`, {});
    assert.equal(sim.estado.sites.size, 2);
  });

  it("5. gera o convite da dona (link do painel, só para o e-mail dela)", async () => {
    const r = await api("POST", `lojas/${loja.ref}/convite`, {});
    assert.equal(r.status, 200, JSON.stringify(r.dados));
    assert.match(r.dados.link, /^https:\/\/doce-da-ana-painel\.vercel\.app\/#\/convite\/[0-9a-f]{64}$/);
    assert.equal(r.dados.email, "ana@doceria.com");
    const db = sim.estado.projetos.get(loja.ref).db;
    const codigo = r.dados.link.split("/").pop();
    const { rows } = await db.query("select email from public.convites where token_hash = public._hash_convite($1)", [codigo]);
    assert.equal(rows[0].email, "ana@doceria.com");
  });

  it("a lista mostra a loja pronta, com os links", async () => {
    const { dados } = await api("GET", "lojas");
    const l = dados.lojas.find((x) => x.ref === loja.ref);
    assert.equal(l.etapa, "pronta");
    assert.equal(l.codigo, loja.codigo);
    assert.equal(l.loja, "https://doce-da-ana.vercel.app");
    assert.equal(l.atualizar, false);
  });

  it("nome de site já ocupado ganha o código no fim", async () => {
    const r = await api("POST", "lojas", { nome: "Doce da Ana", email: "outra@doceria.com" });
    let p; do { p = await api("POST", `lojas/${r.dados.ref}/preparar`, { email: "outra@doceria.com" }); } while (p.dados.etapa === "tabelas");
    assert.equal(p.dados.etapa, "sites", JSON.stringify(p.dados));
    const pub = await api("POST", `lojas/${r.dados.ref}/publicar`, {});
    assert.equal(pub.dados.loja, `https://doce-da-ana-${r.dados.codigo.toLowerCase()}.vercel.app`);
  });

  it("todo dia: cutuca as lojas ativas e reativa as pausadas (só com a senha do agendador)", async () => {
    assert.equal((await api("GET", "manter-ativo")).status, 401);
    sim.pausar(loja.ref);
    const r = await api("GET", "manter-ativo", undefined, { cabecalhos: { authorization: "Bearer cron-de-teste" } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.dados, { cutucadas: 1, reativadas: 1, falhas: 0, aviso_de_chave: false });
    assert.equal((await api("GET", `lojas/${loja.ref}`)).dados.etapa, "pronta", "voltou");
  });

  it("excluir pede o código exato e apaga os 2 sites e o banco", async () => {
    const errado = await api("DELETE", `lojas/${loja.ref}`, { codigo: "xxx-xxx-xxx" });
    assert.equal(errado.status, 422);
    assert.ok(sim.estado.projetos.has(loja.ref));
    const antes = sim.estado.sites.size;
    const r = await api("DELETE", `lojas/${loja.ref}`, { codigo: loja.codigo });
    assert.equal(r.status, 200, JSON.stringify(r.dados));
    assert.deepEqual(r.dados.sites_apagados, ["doce-da-ana", "doce-da-ana-painel"]);
    assert.equal(sim.estado.sites.size, antes - 2);
    assert.equal(sim.estado.projetos.has(loja.ref), false);
    assert.equal((await api("GET", `lojas/${loja.ref}`)).status, 404);
  });
});

describe("nunca mexe em projetos de fora", () => {
  it("projeto de outra organização (ex.: o E-Commerce) é invisível e intocável", async () => {
    const r = await sim.fetchFn("https://api.supabase.com/v1/projects", { method: "POST", headers: { authorization: "Bearer token-supabase-simulado" }, body: JSON.stringify({ name: "E-Commerce", organization_slug: "outra-org", db_pass: "x", region_selection: { type: "specific", code: "sa-east-1" } }) });
    const alheio = await r.json();
    assert.equal((await api("GET", "lojas")).dados.lojas.some((l) => l.ref === alheio.ref), false);
    assert.equal((await api("GET", `lojas/${alheio.ref}`)).status, 404);
    assert.equal((await api("DELETE", `lojas/${alheio.ref}`, { codigo: "qualquer" })).status, 404);
    assert.ok(sim.estado.projetos.has(alheio.ref), "continua lá");
  });
  it("projeto da própria organização mas fora do padrão de nome também fica de fora", async () => {
    const r = await sim.fetchFn("https://api.supabase.com/v1/projects", { method: "POST", headers: { authorization: "Bearer token-supabase-simulado" }, body: JSON.stringify({ name: "Teste manual", organization_slug: sim.org, db_pass: "x", region_selection: { type: "specific", code: "sa-east-1" } }) });
    const manual = await r.json();
    assert.equal((await api("DELETE", `lojas/${manual.ref}`, { codigo: "x" })).status, 404);
  });
});
