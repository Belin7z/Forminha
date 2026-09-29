/* ==========================================================
   PARTE LEGAL E NOTA FISCAL
     - dados da empresa (aparecem nos termos e na privacidade; a
       página pública só mostra o necessário);
     - ao pagar a loja, fica guardada a versão dos termos aceitos;
     - nota fiscal de cada pagamento recebido (número e link), a
       lista do que ainda está sem nota e quem pode registrar.
   ========================================================== */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { criarCentral } from "../../lib/central.js";
import { resumirSenha } from "../../lib/sessao.js";
import { novaChave } from "../../lib/cofre.js";
import { VERSAO_DOS_TERMOS } from "../../lib/clientes.js";
import { bancoDeTeste, criarSimulado } from "../simulado.js";

let sim, banco, servidor, base, dono, vendedora, id;

async function api(metodo, caminho, corpo, cookie = dono) {
  const r = await fetch(`${base}/api/${caminho}`, {
    method: metodo,
    headers: { ...(corpo !== undefined && { "content-type": "application/json" }), ...(cookie && { cookie }) },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const texto = await r.text();
  return { status: r.status, dados: texto ? JSON.parse(texto) : null, cookie: r.headers.get("set-cookie")?.split(";")[0] };
}
const entrar = (usuario, senha) => api("POST", "entrar", { usuario, senha }, null);

before(async () => {
  sim = criarSimulado();
  banco = await bancoDeTeste();
  const env = {
    ...sim.env, CENTRAL_EMAIL: "dono@teste.local", CENTRAL_SENHA_HASH: await resumirSenha("senha-do-dono"), SEGREDO_SESSAO: "s".repeat(48),
    CRON_SECRET: "cron", CHAVE_CRIPTOGRAFIA: novaChave(), URL_CENTRAL: "https://forminha.vercel.app",
  };
  const central = criarCentral(env, { fetchFn: sim.fetchFn, banco, esperaBancoMs: 1, email: null, mercadoPago: null, agendar: () => {} });
  servidor = createServer((req, res) => central.tratar(req, res));
  await new Promise((ok) => servidor.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${servidor.address().port}`;
  dono = (await entrar("dono@teste.local", "senha-do-dono")).cookie;
  await api("PUT", "configuracoes", { valor_padrao_centavos: 19900, pix: { chave: "pix@forminha.test", nome: "Forminha", cidade: "Sao Paulo" } });
  const { dados } = await api("POST", "equipe", { nome: "Vera Vendas", funcao: "vendedor" });
  const temp = await entrar(dados.funcionario.usuario, dados.senha_temporaria);
  vendedora = (await api("POST", "minha-senha", { atual: dados.senha_temporaria, nova: "minha-senha-123", repita: "minha-senha-123" }, temp.cookie)).cookie;
  id = (await api("POST", "clientes", { nome: "Ana Souza", email: "ana@doceria.com", nome_loja: "Doce da Ana", valor_centavos: 19900 })).dados.cliente.id;
});
after(async () => { servidor?.close(); await sim?.fechar(); await banco?.fechar(); });

describe("dados da empresa", () => {
  it("só o dono muda; CPF/CNPJ conferido", async () => {
    assert.equal((await api("PUT", "empresa", { nome: "X" }, vendedora)).status, 403);
    assert.ok((await api("PUT", "empresa", { nome: "Forminha", documento: "11.111.111/1111-11" })).dados.campos.documento);
    const r = await api("PUT", "empresa", { nome: "Forminha Sistemas", documento: "11.222.333/0001-81", email: "Contato@Forminha.test", cidade: "São Paulo/SP" });
    assert.equal(r.status, 200, JSON.stringify(r.dados));
    assert.equal(r.dados.documento, "11222333000181");
    assert.equal(r.dados.email, "contato@forminha.test");
  });

  it("a página pública dos termos lê sem login", async () => {
    const r = await api("GET", "publico/empresa", undefined, null);
    assert.deepEqual(r.dados, { nome: "Forminha Sistemas", documento: "11222333000181", email: "contato@forminha.test", cidade: "São Paulo/SP", termos_versao: VERSAO_DOS_TERMOS });
  });
});

describe("termos aceitos e nota fiscal", () => {
  let pagamento;
  it("ao pagar a loja, guarda a versão dos termos", async () => {
    const ficha = (await api("GET", `clientes/${id}`)).dados;
    pagamento = ficha.pagamentos[0].id;
    assert.equal((await api("PUT", `pagamentos/${pagamento}/nota`, { numero: "123" })).status, 409, "pendente não tem nota");
    const r = await api("POST", `clientes/${id}/pagamento-recebido`, {});
    assert.equal(r.dados.cliente.termos_versao, VERSAO_DOS_TERMOS);
    assert.ok(r.dados.cliente.termos_aceitos_em);
  });

  it("pagamento recebido aparece como sem nota até registrar", async () => {
    let r = (await api("GET", "pagamentos?situacao=sem_nota")).dados;
    assert.deepEqual(r.pagamentos.map((p) => p.id), [pagamento]);
    assert.equal(r.totais.sem_nota, 1);
    assert.equal((await api("GET", "resumo")).dados.sem_nota, 1);
    assert.equal((await api("PUT", `pagamentos/${pagamento}/nota`, { numero: "1", link: "http://nao-seguro.test" })).status, 422);
    assert.equal((await api("PUT", `pagamentos/${pagamento}/nota`, { numero: "1" }, vendedora)).status, 403);
    const n = await api("PUT", `pagamentos/${pagamento}/nota`, { numero: "NF 000123", link: "https://nfse.prefeitura.test/nota/123" });
    assert.equal(n.status, 200, JSON.stringify(n.dados));
    assert.equal(n.dados.nota_fiscal.numero, "NF 000123");
    r = (await api("GET", "pagamentos?situacao=sem_nota")).dados;
    assert.equal(r.pagamentos.length, 0);
    assert.equal((await api("GET", "pagamentos")).dados.pagamentos.find((p) => p.id === pagamento).nota_fiscal.link, "https://nfse.prefeitura.test/nota/123");
    assert.ok((await api("GET", `clientes/${id}`)).dados.historico.some((h) => /Nota fiscal NF 000123 registrada/.test(h.texto)));
  });

  it("número vazio apaga a nota", async () => {
    const r = await api("PUT", `pagamentos/${pagamento}/nota`, { numero: "" });
    assert.equal(r.dados.nota_fiscal, null);
    assert.equal((await api("GET", "pagamentos?situacao=sem_nota")).dados.pagamentos.length, 1);
  });
});
