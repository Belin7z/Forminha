/* ==========================================================
   FUNIL DE VENDAS
     - "só o interesse": a cliente entra sem cobrança (nem precisa da
       chave PIX); a proposta (cobrança) vai depois;
     - cada cadastro guarda quem da equipe fez;
     - o funil do período: entraram -> receberam a cobrança -> pagaram
       -> loja no ar, com a conversão, o tempo até pagar e o
       resultado de cada pessoa (valores só para quem vê dinheiro).
   ========================================================== */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { criarCentral } from "../../lib/central.js";
import { resumirSenha } from "../../lib/sessao.js";
import { novaChave } from "../../lib/cofre.js";
import { bancoDeTeste, criarSimulado } from "../simulado.js";

const SENHA_DONO = "senha-do-dono";
let sim, banco, servidor, base, dono, vendedora, usuarioVendedora;
const ids = {};

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
const hoje = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
const cliente = (n, extra = {}) => ({ nome: `Cliente ${n}`, email: `cliente${n}@doceria.com`, nome_loja: `Doce ${n}`, valor_centavos: 19900, ...extra });

before(async () => {
  sim = criarSimulado();
  banco = await bancoDeTeste();
  const env = {
    ...sim.env, CENTRAL_EMAIL: "dono@teste.local", CENTRAL_SENHA_HASH: await resumirSenha(SENHA_DONO), SEGREDO_SESSAO: "s".repeat(48),
    CRON_SECRET: "cron", CHAVE_CRIPTOGRAFIA: novaChave(), URL_CENTRAL: "https://forminha.vercel.app",
  };
  const central = criarCentral(env, { fetchFn: sim.fetchFn, banco, esperaBancoMs: 1, email: null, mercadoPago: null, agendar: () => {} });
  servidor = createServer((req, res) => central.tratar(req, res));
  await new Promise((ok) => servidor.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${servidor.address().port}`;
  dono = (await entrar("dono@teste.local", SENHA_DONO)).cookie;
  const { dados } = await api("POST", "equipe", { nome: "Vera Vendas", funcao: "vendedor" });
  usuarioVendedora = dados.funcionario.usuario;
  const temp = await entrar(usuarioVendedora, dados.senha_temporaria);
  vendedora = (await api("POST", "minha-senha", { atual: dados.senha_temporaria, nova: "minha-senha-123", repita: "minha-senha-123" }, temp.cookie)).cookie;
});
after(async () => { servidor?.close(); await sim?.fechar(); await banco?.fechar(); });

describe("só o interesse", () => {
  it("entra como interessada, sem cobrança e sem precisar da chave PIX", async () => {
    assert.equal((await api("POST", "clientes", cliente(1), vendedora)).status, 409, "com cobrança, precisa da chave PIX");
    const r = await api("POST", "clientes", cliente(1, { so_interesse: true }), vendedora);
    assert.equal(r.status, 200, JSON.stringify(r.dados));
    ids.a = r.dados.cliente.id;
    assert.equal(r.dados.cliente.situacao, "interessada");
    assert.equal(r.dados.link_pagamento, null);
    assert.deepEqual(r.dados.pagamentos, []);
    assert.match(r.dados.cliente.cadastrado_por, new RegExp(`^${usuarioVendedora} · Vera$`));
    assert.match(r.dados.historico[0].texto, /Interesse registrado/);
  });

  it("dá para mudar o valor da proposta antes de enviar (sem gerar cobrança)", async () => {
    const r = await api("PUT", `clientes/${ids.a}`, { valor_centavos: 24900 }, dono);
    assert.equal(r.status, 200, JSON.stringify(r.dados));
    assert.equal(r.dados.cliente.valor_centavos, 24900);
    assert.deepEqual(r.dados.pagamentos, []);
  });

  it("proposta: gera a cobrança e vira 'aguardando pagamento'", async () => {
    await api("PUT", "configuracoes", { valor_padrao_centavos: 19900, pix: { chave: "pix@forminha.test", nome: "Forminha", cidade: "Sao Paulo" } });
    ids.b = (await api("POST", "clientes", cliente(2, { so_interesse: true }), vendedora)).dados.cliente.id;
    const r = await api("POST", `clientes/${ids.b}/cobrar`, {}, vendedora);
    assert.equal(r.status, 200, JSON.stringify(r.dados));
    assert.equal(r.dados.cliente.situacao, "aguardando_pagamento");
    assert.equal(r.dados.pagamentos.length, 1);
    assert.ok(r.dados.link_pagamento);
    assert.ok(r.dados.historico.some((h) => /Proposta enviada/.test(h.texto)));
  });

  it("interessada também pode ser cancelada", async () => {
    ids.x = (await api("POST", "clientes", cliente(9, { so_interesse: true }), vendedora)).dados.cliente.id;
    assert.equal((await api("POST", `clientes/${ids.x}/cancelar`, {})).dados.cliente.situacao, "cancelado");
  });
});

describe("o funil do período", () => {
  before(async () => {
    // C: a vendedora cadastra com cobrança; paga e a loja fica pronta
    ids.c = (await api("POST", "clientes", cliente(3), vendedora)).dados.cliente.id;
    await api("POST", `clientes/${ids.c}/pagamento-recebido`, {});
    for (let i = 0; i < 60; i++) { if ((await api("POST", `clientes/${ids.c}/avancar`, {})).dados.cliente.etapa === "pronta") break; }
    // D: o dono cadastra e cancela
    ids.d = (await api("POST", "clientes", cliente(4))).dados.cliente.id;
    await api("POST", `clientes/${ids.d}/cancelar`, {});
  });

  it("entraram -> cobrança -> pagaram -> no ar, com as porcentagens", async () => {
    const r = (await api("GET", `funil?de=${hoje()}&ate=${hoje()}`)).dados;
    assert.deepEqual(r.etapas.map((e) => [e.id, e.n]), [["entraram", 5], ["proposta", 3], ["pagaram", 1], ["no_ar", 1]]);
    assert.deepEqual(r.etapas.map((e) => e.pct_do_inicio), [100, 60, 20, 20]);
    assert.deepEqual(r.etapas.map((e) => e.pct_da_anterior), [100, 60, 33, 100]);
    assert.deepEqual(r.em_aberto, { interessadas: 1, aguardando: 1 });
    assert.equal(r.canceladas, 2);
    assert.equal(typeof r.horas_ate_pagar, "number");
    assert.equal(typeof r.horas_ate_loja, "number");
    assert.equal(r.valor, 19900);
  });

  it("cada pessoa da equipe com o que trouxe e converteu", async () => {
    const r = (await api("GET", `funil?de=${hoje()}&ate=${hoje()}`)).dados;
    const vera = r.por_pessoa.find((p) => p.quem.startsWith(usuarioVendedora));
    assert.deepEqual({ ...vera, quem: undefined }, { quem: undefined, entraram: 4, pagaram: 1, conversao: 25, valor: 19900 });
    assert.deepEqual(r.por_pessoa.find((p) => p.quem === "Dono"), { quem: "Dono", entraram: 1, pagaram: 0, conversao: 0, valor: 0 });
  });

  it("quem não vê dinheiro vê o funil sem os valores", async () => {
    const r = (await api("GET", `funil?de=${hoje()}&ate=${hoje()}`, undefined, vendedora)).dados;
    assert.equal(r.valor, undefined);
    assert.ok(r.por_pessoa.every((p) => p.valor === undefined));
  });

  it("período sem ninguém e datas erradas", async () => {
    const r = (await api("GET", "funil?de=2020-01-01&ate=2020-01-31")).dados;
    assert.deepEqual(r.etapas.map((e) => e.n), [0, 0, 0, 0]);
    assert.equal(r.horas_ate_pagar, null);
    assert.equal((await api("GET", "funil?de=2026-02-31&ate=2026-03-01")).status, 422);
    assert.equal((await api("GET", `funil?de=${hoje()}&ate=2020-01-01`)).status, 422);
  });

  it("a visão geral conta as interessadas em aberto", async () => {
    assert.equal((await api("GET", "resumo")).dados.numeros.interessadas, 1);
  });
});
