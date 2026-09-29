/* ==========================================================
   AVISOS NA HORA E METAS DO MÊS
     - o sino avisa: cliente nova (para o dono), pagamento caiu,
       loja pronta, criação parou — cada um só para quem pode ver;
     - "visto" é por pessoa e nunca volta para trás;
     - metas de faturamento e de lojas, com o quanto já foi feito e
       onde o mês fecha se o ritmo continuar. Só o dono muda a meta.
   ========================================================== */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { criarCentral } from "../../lib/central.js";
import { resumirSenha } from "../../lib/sessao.js";
import { novaChave } from "../../lib/cofre.js";
import { criarAvisos } from "../../lib/avisos.js";
import { preparadorDeEsquema } from "../../lib/dados.js";
import { bancoDeTeste, criarSimulado } from "../simulado.js";

const SENHA_DONO = "senha-do-dono";
let sim, banco, servidor, base, dono, vendedora, suporte, clienteId;

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
async function contratar(nome, funcao, senha = "minha-senha-123") {
  const { dados } = await api("POST", "equipe", { nome, funcao });
  const temp = await entrar(dados.funcionario.usuario, dados.senha_temporaria);
  const troca = await api("POST", "minha-senha", { atual: dados.senha_temporaria, nova: senha, repita: senha }, temp.cookie);
  return troca.cookie;
}
const titulos = async (cookie) => (await api("GET", "avisos", undefined, cookie)).dados.avisos.map((a) => a.titulo);

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
  await api("PUT", "configuracoes", { valor_padrao_centavos: 19900, pix: { chave: "pix@forminha.test", nome: "Forminha", cidade: "Sao Paulo" } });
  vendedora = await contratar("Vera Vendas", "vendedor");
  suporte = await contratar("Sara Suporte", "suporte");
});
after(async () => { servidor?.close(); await sim?.fechar(); await banco?.fechar(); });

describe("o sino", () => {
  it("cliente cadastrada pela equipe avisa o dono (e só ele)", async () => {
    const r = await api("POST", "clientes", { nome: "Ana Souza", email: "ana@doceria.com", nome_loja: "Doce da Ana", valor_centavos: 19900 }, vendedora);
    assert.equal(r.status, 200, JSON.stringify(r.dados));
    clienteId = r.dados.cliente.id;
    assert.deepEqual(await titulos(dono), ["Cliente nova: Doce da Ana"]);
    const [a] = (await api("GET", "avisos")).dados.avisos;
    assert.match(a.texto, /Cadastrada por FMV-\d{4} · Vera · R\$\s?199,00/);
    assert.doesNotMatch(JSON.stringify(a), /ana@doceria\.com|Ana Souza/, "sem dados pessoais no aviso");
    assert.deepEqual(await titulos(vendedora), [], "a vendedora não recebe o aviso do próprio cadastro");
  });

  it("pagamento confirmado avisa quem vê clientes", async () => {
    assert.equal((await api("POST", `clientes/${clienteId}/pagamento-recebido`, {})).status, 200);
    assert.ok((await titulos(vendedora)).includes("Pagamento recebido: Doce da Ana"));
    assert.ok((await titulos(suporte)).includes("Pagamento recebido: Doce da Ana"));
  });

  it("loja pronta avisa também", async () => {
    for (let i = 0; i < 60; i++) {
      const r = await api("POST", `clientes/${clienteId}/avancar`, {});
      if (r.dados.cliente.etapa === "pronta") break;
    }
    const lista = (await api("GET", "avisos", undefined, vendedora)).dados;
    assert.equal(lista.avisos[0].titulo, "Loja pronta: Doce da Ana");
    assert.equal(lista.avisos[0].tipo, "loja_pronta");
    assert.equal(lista.avisos[0].cliente_id, clienteId, "o aviso leva até a ficha");
  });

  it("visto é por pessoa e nunca volta para trás", async () => {
    let r = (await api("GET", "avisos", undefined, vendedora)).dados;
    assert.equal(r.nao_vistos, 2);
    assert.ok(r.avisos.every((a) => a.novo));
    await api("POST", "avisos/vistos", { ate: r.ultimo }, vendedora);
    r = (await api("GET", "avisos", undefined, vendedora)).dados;
    assert.equal(r.nao_vistos, 0);
    assert.ok(r.avisos.every((a) => !a.novo));
    await api("POST", "avisos/vistos", { ate: 1 }, vendedora);
    assert.equal((await api("GET", "avisos", undefined, vendedora)).dados.nao_vistos, 0, "marcar um número menor não desfaz");
    assert.equal((await api("GET", "avisos")).dados.nao_vistos, 3, "o dono ainda não viu os dele");
  });

  it("sem login, nada", async () => {
    assert.equal((await api("GET", "avisos", undefined, null)).status, 401);
    assert.equal((await api("POST", "avisos/vistos", { ate: 9 }, null)).status, 401);
  });

  it("cada aviso só aparece para quem tem a permissão", async () => {
    const b = await bancoDeTeste();
    const avisos = criarAvisos({ banco: b, preparar: preparadorDeEsquema(b) });
    await avisos.registrar({ tipo: "parada", titulo: "A criação parou: X", permissao: "lojas.suporte" });
    await avisos.registrar({ tipo: "geral", titulo: "Para todos" });
    await avisos.registrar({ tipo: "cadastro", titulo: "Só o dono", permissao: "dono" });
    const pessoa = (tipo, permissoes) => ({ id: `p-${tipo}-${permissoes.length}`, tipo, permissoes });
    const ver = async (q) => (await avisos.listar(q)).avisos.map((a) => a.titulo);
    assert.deepEqual(await ver(pessoa("funcionario", ["lojas.suporte"])), ["Para todos", "A criação parou: X"]);
    assert.deepEqual(await ver(pessoa("funcionario", ["clientes.ver"])), ["Para todos"]);
    assert.deepEqual(await ver(pessoa("dono", ["lojas.suporte"])), ["Só o dono", "Para todos", "A criação parou: X"]);
    await b.fechar();
  });
});

describe("metas do mês", () => {
  it("sem meta, zeros; só o dono define", async () => {
    assert.deepEqual((await api("GET", "metas")).dados, { faturamento_centavos: 0, lojas: 0 });
    assert.equal((await api("PUT", "metas", { faturamento_centavos: 100000, lojas: 5 }, vendedora)).status, 403);
    assert.equal((await api("GET", "metas", undefined, vendedora)).status, 403, "vendedora não vê dinheiro");
  });

  it("valores absurdos voltam no campo", async () => {
    const r = await api("PUT", "metas", { faturamento_centavos: -5, lojas: 5 });
    assert.equal(r.status, 422);
    assert.ok(r.dados.campos.faturamento);
    assert.ok((await api("PUT", "metas", { faturamento_centavos: 1000, lojas: 999999 })).dados.campos.lojas);
  });

  it("a visão geral mostra a meta, o feito e a projeção do mês", async () => {
    assert.equal((await api("PUT", "metas", { faturamento_centavos: 100000, lojas: 5 })).status, 200);
    const { meta, financeiro } = (await api("GET", "resumo")).dados;
    assert.equal(meta.faturamento_centavos, 100000);
    assert.equal(meta.lojas, 5);
    assert.equal(meta.faturamento_feito, financeiro.mes);
    assert.equal(meta.faturamento_feito, 19900);
    assert.equal(meta.lojas_feitas, 1);
    assert.ok(meta.dia >= 1 && meta.dia <= meta.dias_no_mes && meta.dias_no_mes >= 28);
    assert.equal(meta.projecao_centavos, Math.round((19900 / meta.dia) * meta.dias_no_mes));
    assert.equal((await api("GET", "resumo", undefined, vendedora)).dados.meta, undefined, "sem dinheiro para quem não vê faturamento");
  });
});
