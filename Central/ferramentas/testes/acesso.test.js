/* ==========================================================
   SENHA DA CENTRAL — trocar pelo painel e recuperar pelo configurar:
     - pede a senha atual; a nova tem 8+ caracteres e é repetida;
     - depois da troca, só a nova entra e os outros aparelhos saem;
     - o configurar (opção 7) sempre vale mais: é a volta de quem esqueceu;
     - sem o banco da Central, a troca pelo painel fica desligada.
   ========================================================== */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { criarCentral } from "../../lib/central.js";
import { resumirSenha } from "../../lib/sessao.js";
import { bancoDeTeste, criarSimulado } from "../simulado.js";

const SEGREDO = "segredo-de-teste-".padEnd(48, "x");

async function subir(env, opcoes) {
  const central = criarCentral(env, opcoes);
  const servidor = createServer((req, res) => central.tratar(req, res));
  await new Promise((ok) => servidor.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const api = async (metodo, caminho, corpo, cookie) => {
    const r = await fetch(`${base}/api/${caminho}`, {
      method: metodo,
      headers: { ...(corpo !== undefined && { "content-type": "application/json" }), ...(cookie && { cookie }) },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    return { status: r.status, dados: await r.json(), cookie: r.headers.get("set-cookie")?.split(";")[0] };
  };
  const entrar = async (senha) => api("POST", "entrar", { senha });
  const logado = async (cookie) => (await api("GET", "eu", undefined, cookie)).dados.logado;
  return { api, entrar, logado, fechar: () => servidor.close() };
}

describe("trocar a senha pelo painel", () => {
  let sim, banco, central, envBase;

  before(async () => {
    sim = criarSimulado();
    banco = await bancoDeTeste();
    envBase = { ...sim.env, SEGREDO_SESSAO: SEGREDO, CRON_SECRET: "cron" };
    central = await subir({ ...envBase, CENTRAL_SENHA_HASH: await resumirSenha("doce1234") }, { fetchFn: sim.fetchFn, banco });
  });
  after(async () => { central?.fechar(); await sim?.fechar(); });

  it("senha de 8 caracteres entra", async () => {
    const r = await central.entrar("doce1234");
    assert.equal(r.status, 200);
    assert.equal(await central.logado(r.cookie), true);
    assert.equal((await central.api("GET", "eu", undefined, r.cookie)).dados.recursos.trocar_senha, true);
  });

  it("pede a senha atual certa, 8+ caracteres e a repetição igual", async () => {
    const { cookie } = await central.entrar("doce1234");
    let r = await central.api("POST", "senha", { atual: "errada123", nova: "brigadeiro9", repita: "brigadeiro9" }, cookie);
    assert.equal(r.status, 422); assert.ok(r.dados.campos.atual);
    r = await central.api("POST", "senha", { atual: "doce1234", nova: "curta", repita: "curta" }, cookie);
    assert.equal(r.status, 422); assert.ok(r.dados.campos.nova);
    r = await central.api("POST", "senha", { atual: "doce1234", nova: "brigadeiro9", repita: "brigadeiro8" }, cookie);
    assert.equal(r.status, 422); assert.ok(r.dados.campos.repita);
    assert.equal((await central.api("POST", "senha", { atual: "doce1234", nova: "brigadeiro9", repita: "brigadeiro9" })).status, 401, "sem login, nada");
  });

  it("depois da troca: só a nova entra, este aparelho continua e os outros saem", async () => {
    const outroAparelho = (await central.entrar("doce1234")).cookie;
    const esteAparelho = (await central.entrar("doce1234")).cookie;
    const r = await central.api("POST", "senha", { atual: "doce1234", nova: "brigadeiro9", repita: "brigadeiro9" }, esteAparelho);
    assert.equal(r.status, 200);
    assert.equal(await central.logado(r.cookie), true, "quem trocou segue logado");
    assert.equal(await central.logado(outroAparelho), false, "o outro aparelho saiu");
    assert.equal(await central.logado(esteAparelho), false, "o cookie antigo não vale mais");
    assert.equal((await central.entrar("doce1234")).status, 401);
    assert.equal((await central.entrar("brigadeiro9")).status, 200);
    const [linha] = await banco.consultar("select valor from configuracoes where chave = 'acesso'");
    assert.doesNotMatch(JSON.stringify(linha.valor), /brigadeiro9/, "no banco fica só o resumo, nunca a senha");
  });

  it("esqueceu? o configurar (opção 7) cria outra senha e ela vale mais que a do painel", async () => {
    const recuperada = await subir({ ...envBase, CENTRAL_SENHA_HASH: await resumirSenha("recomeco2026") }, { fetchFn: sim.fetchFn, banco });
    try {
      assert.equal((await recuperada.entrar("brigadeiro9")).status, 401, "a do painel deixou de valer");
      const r = await recuperada.entrar("recomeco2026");
      assert.equal(r.status, 200);
      assert.equal(await recuperada.logado(r.cookie), true);
    } finally { recuperada.fechar(); }
  });
});

describe("sem o banco da Central", () => {
  it("a troca pelo painel fica desligada e o login segue pelo configurar", async () => {
    const sim = criarSimulado();
    const central = await subir({ ...sim.env, SEGREDO_SESSAO: SEGREDO, CENTRAL_SENHA_HASH: await resumirSenha("doce1234") }, { fetchFn: sim.fetchFn });
    try {
      const { cookie } = await central.entrar("doce1234");
      assert.equal((await central.api("GET", "eu", undefined, cookie)).dados.recursos.trocar_senha, false);
      const r = await central.api("POST", "senha", { atual: "doce1234", nova: "brigadeiro9", repita: "brigadeiro9" }, cookie);
      assert.equal(r.status, 503);
      assert.equal(await central.logado(cookie), true);
    } finally { central.fechar(); await sim.fechar(); }
  });
});
