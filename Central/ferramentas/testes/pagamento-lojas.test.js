/* ==========================================================
   PAGAMENTO ONLINE DAS LOJAS — a Central liga o Mercado Pago da
   doceria sem ninguém mexer no Supabase:
     - confere a chave no Mercado Pago (chave errada é recusada);
     - instala as 4 funções (um arquivo cada, carregável) e grava a
       chave só como segredo das funções (nunca volta para a tela);
     - o banco da loja liga PIX automático e cartão;
     - a dona consegue fazer o mesmo pelo painel dela, com o login dela;
       quem não é administradora da loja é recusada.
   ========================================================== */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { criarCentral } from "../../lib/central.js";
import { resumirSenha } from "../../lib/sessao.js";
import { FUNCOES, montarFuncao } from "../../lib/funcoes.js";
import { criarSimulado } from "../simulado.js";

const TOKEN_MP = "APP_USR-1234567890-abcdefghijklmnopqrstuvwxyz";
let sim, servidor, base, cookie, loja;

async function api(metodo, caminho, corpo, { semCookie = false, cabecalhos = {} } = {}) {
  const r = await fetch(`${base}/api/${caminho}`, {
    method: metodo,
    headers: { ...(corpo !== undefined && { "content-type": "application/json" }), ...(!semCookie && cookie && { cookie }), ...cabecalhos },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const texto = await r.text();
  return { status: r.status, dados: texto ? JSON.parse(texto) : null, cabecalhos: r.headers };
}

before(async () => {
  sim = criarSimulado();
  const env = { ...sim.env, CENTRAL_SENHA_HASH: await resumirSenha("senha-do-dono"), SEGREDO_SESSAO: "s".repeat(48), CRON_SECRET: "cron", URL_CENTRAL: "https://forminha.vercel.app" };
  const central = criarCentral(env, { fetchFn: sim.fetchFn });
  servidor = createServer((req, res) => central.tratar(req, res));
  await new Promise((ok) => servidor.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${servidor.address().port}`;
  cookie = (await fetch(`${base}/api/entrar`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ senha: "senha-do-dono" }) }))
    .headers.get("set-cookie").split(";")[0];
  // uma loja pronta (banco, tabelas e sites)
  loja = (await api("POST", "lojas", { nome: "Doce da Bia", email: "bia@doceria.com" })).dados;
  let r; do { r = await api("POST", `lojas/${loja.ref}/preparar`, { email: "bia@doceria.com" }); } while (r.dados.etapa === "tabelas");
  await api("POST", `lojas/${loja.ref}/publicar`, {});
});
after(async () => { servidor?.close(); await sim?.fechar(); });

describe("funções das lojas", () => {
  it("cada função vira um arquivo só, que carrega sozinho", async () => {
    for (const nome of FUNCOES) {
      const codigo = montarFuncao(nome);
      assert.doesNotMatch(codigo, /from "\.{1,2}\//, `${nome}: sobrou import de arquivo local`);
      const arquivo = join(tmpdir(), `forminha-${nome}-${Date.now()}.mjs`);
      writeFileSync(arquivo, codigo);
      let servido = null;
      globalThis.Deno = { serve: (h) => { servido = h; }, env: { get: () => "" } };
      await import(pathToFileURL(arquivo).href);
      assert.equal(typeof servido, "function", `${nome} não registrou o servidor`);
    }
  });

  it("o painel da loja nasce sabendo o endereço da Central", () => {
    const painel = [...sim.estado.sites.values()].find((s) => s.nome === "doce-da-bia-painel");
    assert.equal(painel.variaveis.URL_CENTRAL, "https://forminha.vercel.app");
  });
});

describe("ligar o pagamento online (pela Central)", () => {
  it("recusa chave que não é do Mercado Pago ou que ele não aceita", async () => {
    let r = await api("POST", `lojas/${loja.ref}/pagamento`, { token: "sbp_nada-a-ver" });
    assert.equal(r.status, 422); assert.ok(r.dados.campos.token);
    r = await api("POST", `lojas/${loja.ref}/pagamento`, { token: "APP_USR-recusada-000000000000000000000" });
    assert.equal(r.status, 422);
    assert.match(r.dados.erro, /Mercado Pago não aceitou/);
    assert.equal(sim.estado.projetos.get(loja.ref).funcoes, undefined, "nada foi instalado");
  });

  it("instala as funções, guarda a chave como segredo e liga PIX e cartão no banco da loja", async () => {
    const r = await api("POST", `lojas/${loja.ref}/pagamento`, { token: TOKEN_MP });
    assert.equal(r.status, 200, JSON.stringify(r.dados));
    assert.deepEqual(r.dados, { conectado: true, conta: "DOCERIA_SIMULADA", pix: true, cartao: true });
    assert.ok(!JSON.stringify(r.dados).includes(TOKEN_MP), "a chave não volta para a tela");
    const p = sim.estado.projetos.get(loja.ref);
    assert.deepEqual(Object.keys(p.funcoes).sort(), [...FUNCOES].sort());
    assert.ok(Object.values(p.funcoes).every((f) => f.verify_jwt === false));
    assert.equal(p.segredos.MP_ACCESS_TOKEN, TOKEN_MP);
    assert.match(p.segredos.SEGREDO_GATEWAY, /^[0-9a-f]{48}$/);
    assert.equal(p.segredos.ORIGENS_PERMITIDAS, "https://doce-da-bia.vercel.app,https://doce-da-bia-painel.vercel.app");
    const g = (await p.db.query("select valor from public.configuracoes where chave = 'gateway'")).rows[0].valor;
    assert.equal(g.ativo, true);
    assert.equal(g.cartao, true);
    assert.equal(g.conta, "DOCERIA_SIMULADA");
    const { rows } = await p.db.query("select encode(sha256(convert_to($1, 'UTF8')), 'hex') = $2 as confere", [p.segredos.SEGREDO_GATEWAY, g.segredo_hash]);
    assert.equal(rows[0].confere, true, "o banco guarda só o hash da chave de integração");
    const cfg = (await p.db.query("select public.loja_config('{}'::jsonb) as c")).rows[0].c;
    assert.equal(cfg.pagamento.cartao_online, true, "a vitrine já oferece cartão");
  });

  it("ligar de novo troca a chave sem erro", async () => {
    assert.equal((await api("POST", `lojas/${loja.ref}/pagamento`, { token: TOKEN_MP })).status, 200);
  });
});

describe("a dona liga pelo painel dela", () => {
  const daLoja = (token, corpo = { token: TOKEN_MP }) => api("POST", "loja/pagamento", corpo, { semCookie: true, cabecalhos: { authorization: `Bearer ${token}`, origin: "https://doce-da-bia-painel.vercel.app" } });

  it("aceita chamada do painel (outro endereço) com o login da administradora", async () => {
    const pre = await fetch(`${base}/api/loja/pagamento`, { method: "OPTIONS", headers: { origin: "https://doce-da-bia-painel.vercel.app" } });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get("access-control-allow-origin"), "*");
    assert.match(pre.headers.get("access-control-allow-headers"), /authorization/);
    const r = await daLoja(sim.tokenDaLoja(loja.ref, "admin"));
    assert.equal(r.status, 200, JSON.stringify(r.dados));
    assert.equal(r.dados.conectado, true);
    assert.equal(r.cabecalhos.get("access-control-allow-origin"), "*");
  });

  it("recusa sem login, login de cliente comum, de outra loja ou de projeto de fora", async () => {
    assert.equal((await api("POST", "loja/pagamento", { token: TOKEN_MP }, { semCookie: true })).status, 401);
    const cliente = await daLoja(sim.tokenDaLoja(loja.ref, "cliente"));
    assert.equal(cliente.status, 403);
    assert.equal(cliente.cabecalhos.get("access-control-allow-origin"), "*", "o erro também chega ao painel");
    assert.equal((await daLoja(sim.tokenDaLoja("zzzzzzzzzzzzzzzzzzzz", "admin"))).status, 404, "projeto que não é da Forminha");
    assert.equal((await daLoja("nao-e-um-token")).status, 401);
  });

  it("o cookie da Central não serve para essas rotas", async () => {
    assert.equal((await api("POST", "loja/pagamento", { token: TOKEN_MP })).status, 401, "com cookie e sem login da loja: nada");
  });
});
