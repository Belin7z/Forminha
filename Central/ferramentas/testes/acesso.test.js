/* ==========================================================
   ACESSO À CENTRAL — e-mail (ou usuário) + senha:
     - entra com o e-mail (sem ligar para maiúsculas) ou o usuário;
     - senha: pede a atual; a nova tem 8+ caracteres e é repetida;
       depois da troca, só a nova entra e os outros aparelhos saem;
     - e-mail e usuário mudam pelo painel, confirmando a senha;
     - o configurar (opção 7) sempre vale mais: é a volta de quem esqueceu;
     - sem o banco da Central, mudar pelo painel fica desligado.
   ========================================================== */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { criarCentral } from "../../lib/central.js";
import { resumirSenha } from "../../lib/sessao.js";
import { bancoDeTeste, criarSimulado } from "../simulado.js";

const SEGREDO = "segredo-de-teste-".padEnd(48, "x");
const EMAIL = "dona@teste.local";

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
  const entrar = async (usuario, senha) => api("POST", "entrar", { usuario, senha });
  const logado = async (cookie) => (await api("GET", "eu", undefined, cookie)).dados.logado;
  return { api, entrar, logado, fechar: () => servidor.close() };
}

describe("entrar com e-mail ou usuário", () => {
  let sim, banco, central, envBase;

  before(async () => {
    sim = criarSimulado();
    banco = await bancoDeTeste();
    envBase = { ...sim.env, SEGREDO_SESSAO: SEGREDO, CRON_SECRET: "cron", CENTRAL_EMAIL: EMAIL };
    central = await subir({ ...envBase, CENTRAL_SENHA_HASH: await resumirSenha("doce1234") }, { fetchFn: sim.fetchFn, banco });
  });
  after(async () => { central?.fechar(); await sim?.fechar(); });

  it("pede o e-mail certo junto com a senha (maiúsculas e espaços não atrapalham)", async () => {
    assert.equal((await central.api("POST", "entrar", { senha: "doce1234" })).status, 401, "só a senha não basta");
    const errado = await central.entrar("outra@teste.local", "doce1234");
    assert.equal(errado.status, 401);
    assert.match(errado.dados.erro, /E-mail \(ou usuário\) ou senha incorretos/, "não diz qual dos dois errou");
    assert.equal((await central.entrar(EMAIL, "errada123")).status, 401);
    const r = await central.entrar("  DONA@Teste.local ", "doce1234");
    assert.equal(r.status, 200);
    assert.equal(await central.logado(r.cookie), true);
    assert.deepEqual((await central.api("GET", "conta", undefined, r.cookie)).dados, { nome: "", email: EMAIL, usuario: "" });
    assert.equal((await central.api("GET", "conta")).status, 401, "sem login, não mostra a conta");
  });

  it("cria um usuário pelo painel (confirmando a senha) e passa a entrar com ele também", async () => {
    const { cookie } = await central.entrar(EMAIL, "doce1234");
    let r = await central.api("PUT", "conta", { email: EMAIL, usuario: "ana", senha: "errada123" }, cookie);
    assert.equal(r.status, 422); assert.ok(r.dados.campos.senha);
    r = await central.api("PUT", "conta", { email: EMAIL, usuario: "a b", senha: "doce1234" }, cookie);
    assert.equal(r.status, 422); assert.ok(r.dados.campos.usuario);
    r = await central.api("PUT", "conta", { email: "sem-arroba", usuario: "", senha: "doce1234" }, cookie);
    assert.equal(r.status, 422); assert.ok(r.dados.campos.email);
    r = await central.api("PUT", "conta", { email: EMAIL, usuario: "Ana", senha: "doce1234" }, cookie);
    assert.equal(r.status, 200);
    assert.deepEqual(r.dados, { nome: "", email: EMAIL, usuario: "ana" });
    assert.equal((await central.entrar("ana", "doce1234")).status, 200);
    assert.equal((await central.entrar(EMAIL, "doce1234")).status, 200, "o e-mail continua valendo");
    assert.equal(await central.logado(cookie), true, "mudar a conta não desconecta ninguém");
  });

  it("troca de senha: pede a atual, 8+ caracteres e a repetição igual", async () => {
    const { cookie } = await central.entrar("ana", "doce1234");
    let r = await central.api("POST", "senha", { atual: "errada123", nova: "brigadeiro9", repita: "brigadeiro9" }, cookie);
    assert.equal(r.status, 422); assert.ok(r.dados.campos.atual);
    r = await central.api("POST", "senha", { atual: "doce1234", nova: "curta", repita: "curta" }, cookie);
    assert.equal(r.status, 422); assert.ok(r.dados.campos.nova);
    r = await central.api("POST", "senha", { atual: "doce1234", nova: "brigadeiro9", repita: "brigadeiro8" }, cookie);
    assert.equal(r.status, 422); assert.ok(r.dados.campos.repita);
    assert.equal((await central.api("POST", "senha", { atual: "doce1234", nova: "brigadeiro9", repita: "brigadeiro9" })).status, 401, "sem login, nada");
  });

  it("depois da troca: só a nova entra, este aparelho continua e os outros saem", async () => {
    const outroAparelho = (await central.entrar(EMAIL, "doce1234")).cookie;
    const esteAparelho = (await central.entrar(EMAIL, "doce1234")).cookie;
    const r = await central.api("POST", "senha", { atual: "doce1234", nova: "brigadeiro9", repita: "brigadeiro9" }, esteAparelho);
    assert.equal(r.status, 200);
    assert.equal(await central.logado(r.cookie), true, "quem trocou segue logado");
    assert.equal(await central.logado(outroAparelho), false, "o outro aparelho saiu");
    assert.equal(await central.logado(esteAparelho), false, "o cookie antigo não vale mais");
    assert.equal((await central.entrar(EMAIL, "doce1234")).status, 401);
    assert.equal((await central.entrar("ana", "brigadeiro9")).status, 200, "o usuário continua depois da troca de senha");
    const [linha] = await banco.consultar("select valor from configuracoes where chave = 'acesso'");
    assert.doesNotMatch(JSON.stringify(linha.valor), /brigadeiro9/, "no banco fica só o resumo, nunca a senha");
  });

  it("esqueceu? o configurar (opção 7) cria e-mail e senha novos e eles valem mais que os do painel", async () => {
    const recuperada = await subir({ ...envBase, CENTRAL_EMAIL: "nova@teste.local", CENTRAL_SENHA_HASH: await resumirSenha("recomeco2026") }, { fetchFn: sim.fetchFn, banco });
    try {
      assert.equal((await recuperada.entrar("ana", "brigadeiro9")).status, 401, "o que foi trocado pelo painel deixou de valer");
      assert.equal((await recuperada.entrar("ana", "recomeco2026")).status, 401, "o usuário criado no painel também");
      const r = await recuperada.entrar("nova@teste.local", "recomeco2026");
      assert.equal(r.status, 200);
      assert.equal(await recuperada.logado(r.cookie), true);
    } finally { recuperada.fechar(); }
  });
});

describe("sem o banco da Central", () => {
  it("mudar pelo painel fica desligado e o login segue pelo configurar", async () => {
    const sim = criarSimulado();
    const central = await subir({ ...sim.env, SEGREDO_SESSAO: SEGREDO, CENTRAL_EMAIL: EMAIL, CENTRAL_SENHA_HASH: await resumirSenha("doce1234") }, { fetchFn: sim.fetchFn });
    try {
      const { cookie } = await central.entrar(EMAIL, "doce1234");
      assert.equal((await central.api("GET", "eu", undefined, cookie)).dados.recursos.trocar_senha, false);
      assert.equal((await central.api("POST", "senha", { atual: "doce1234", nova: "brigadeiro9", repita: "brigadeiro9" }, cookie)).status, 503);
      assert.equal((await central.api("PUT", "conta", { email: EMAIL, usuario: "ana", senha: "doce1234" }, cookie)).status, 503);
      assert.deepEqual((await central.api("GET", "conta", undefined, cookie)).dados, { nome: "", email: EMAIL, usuario: "" });
    } finally { central.fechar(); await sim.fechar(); }
  });

  it("instalação antiga, sem e-mail cadastrado: só a senha ainda entra", async () => {
    const sim = criarSimulado();
    const central = await subir({ ...sim.env, SEGREDO_SESSAO: SEGREDO, CENTRAL_SENHA_HASH: await resumirSenha("doce1234") }, { fetchFn: sim.fetchFn });
    try {
      assert.equal((await central.api("POST", "entrar", { senha: "doce1234" })).status, 200);
    } finally { central.fechar(); await sim.fechar(); }
  });
});
