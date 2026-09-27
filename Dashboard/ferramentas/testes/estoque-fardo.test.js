/* ==========================================================
   ESTOQUE — compra em fardo (caixa com várias embalagens), do
   jeito que se compra no atacado. fardo_qtd = 0 quer dizer "não
   compra em fardo": por dentro, tudo continua na mesma unidade
   de sempre — receita, custo e previsão não mudam.
   ========================================================== */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { iniciarEmulador } from "./emulador/servidor.js";
import { criarApiPainel } from "../../src/scripts/base/api/painel.js";

let emu, painel, atendente;
const novoCliente = () => createClient(emu.url, emu.chaveAnon, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
async function falha(promessa) { try { await promessa; } catch (e) { return e; } assert.fail("era esperado um erro"); }
const atual = async (id) => (await painel.get("/ingredientes")).ingredientes.find((i) => i.id === id);
const historico = async (id) => (await painel.get(`/estoque/movimentos?ingrediente_id=${id}`)).itens;

before(async () => {
  emu = await iniciarEmulador();
  const dados = await emu.criarAdmin("dona@teste.local", "Admin12345");
  painel = criarApiPainel(novoCliente());
  await painel.post("/auth/entrar", { email: dados.email, senha: dados.senha });
  const conta = createClient(emu.url, emu.chaveAnon, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  await conta.auth.signUp({ email: "ana@teste.com", password: "Senha1234", options: { data: { nome: "Ana Atendente", telefone: "11955554444" } } });
  await painel.post("/equipe", { email: "ana@teste.com", papel: "atendente" });
  atendente = criarApiPainel(novoCliente());
  await atendente.post("/auth/entrar", { email: "ana@teste.com", senha: "Senha1234" });
});
after(async () => { await emu?.fechar(); });

describe("cadastro do fardo no ingrediente", () => {
  it("nasce sem fardo (fardo_qtd 0) e o campo não aparece na conta de custo", async () => {
    const farinha = (await painel.post("/ingredientes", { nome: "Farinha de trigo", unidade: "g", embalagem_qtd: 1000, embalagem_nome: "pacote", embalagem_preco: 500 })).ingrediente;
    assert.equal(farinha.fardo_qtd, 0);
    assert.equal(farinha.fardo_nome, "fardo");
    assert.equal(farinha.fardo_preco, 0);
    assert.equal(farinha.fardo_custo_unit, null);
    assert.equal(farinha.fardo_economia_pct, null);
  });

  it("cadastra com fardo e calcula o custo por grama e a economia", async () => {
    // pacote de 1 kg a R$ 5,00 (0,5 centavo/g); fardo com 10 pacotes a R$ 42,00 (0,42 centavo/g) = 16% mais barato
    const r = (await painel.post("/ingredientes", { nome: "Açúcar", unidade: "g", embalagem_qtd: 1000, embalagem_nome: "pacote", embalagem_preco: 500,
      fardo_nome: "caixa", fardo_qtd: 10, fardo_preco: 4200 })).ingrediente;
    assert.equal(r.fardo_nome, "caixa");
    assert.equal(r.fardo_qtd, 10);
    assert.equal(r.fardo_preco, 4200);
    assert.equal(r.fardo_custo_unit, 0.42);
    assert.equal(r.fardo_economia_pct, 16);
  });

  it("fardo mais caro que a embalagem avulsa não mostra economia (fica null ou negativo, nunca some o dado)", async () => {
    const r = (await painel.post("/ingredientes", { nome: "Manteiga", unidade: "g", embalagem_qtd: 200, embalagem_nome: "tablete", embalagem_preco: 1000,
      fardo_qtd: 5, fardo_preco: 6000 })).ingrediente;
    assert.equal(r.fardo_economia_pct, -20, "fardo saiu 20% mais caro por grama");
  });

  it("valida os campos do fardo", async () => {
    const base = { nome: "Teste Fardo", unidade: "g", embalagem_qtd: 1000, embalagem_preco: 500 };
    assert.ok((await falha(painel.post("/ingredientes", { ...base, fardo_qtd: -1 }))).campos.fardo_qtd);
    assert.ok((await falha(painel.post("/ingredientes", { ...base, fardo_preco: -1 }))).campos.fardo_preco);
    assert.ok((await falha(painel.post("/ingredientes", { ...base, fardo_nome: "x".repeat(31) }))).campos.fardo_nome);
  });

  it("fardo_qtd = 0 zera o preço do fardo automaticamente (evita ficar preço sem fardo)", async () => {
    const r = (await painel.post("/ingredientes", { nome: "Chocolate em pó", unidade: "g", embalagem_qtd: 1000, embalagem_preco: 3000, fardo_qtd: 0, fardo_preco: 9999 })).ingrediente;
    assert.equal(r.fardo_preco, 0);
  });

  it("editar sem mandar os campos do fardo reseta para 'sem fardo' (mesma regra da embalagem — o formulário sempre reenvia tudo)", async () => {
    const acucar = (await painel.get("/ingredientes")).ingredientes.find((i) => i.nome === "Açúcar");
    const editado = (await painel.put(`/ingredientes/${acucar.id}`, { nome: "Açúcar", unidade: "g", embalagem_qtd: 1000, embalagem_nome: "pacote", embalagem_preco: 500 })).ingrediente;
    assert.equal(editado.fardo_qtd, 0);
    assert.equal(editado.fardo_preco, 0);
  });

  it("só o administrador cadastra fardo; atendente é recusado", async () => {
    assert.equal((await falha(atendente.post("/ingredientes", { nome: "X", unidade: "g", fardo_qtd: 5 }))).status, 403);
  });
});

describe("lançamento avulso em fardo", () => {
  let manteiga;
  before(async () => {
    manteiga = (await painel.post("/ingredientes", { nome: "Manteiga em barra", unidade: "g", estoque: 400, embalagem_qtd: 200, embalagem_nome: "tablete", embalagem_preco: 1000,
      fardo_nome: "caixa", fardo_qtd: 12, fardo_preco: 11400 })).ingrediente;
  });

  it("recusa comprar em fardo quando o ingrediente não tem fardo cadastrado", async () => {
    const farinha = (await painel.get("/ingredientes")).ingredientes.find((i) => i.nome === "Farinha de trigo");
    const e = await falha(painel.post("/estoque/movimentos", { ingrediente_id: farinha.id, tipo: "compra", forma: "fardo", embalagens: 1 }));
    assert.equal(e.status, 422);
    assert.match(e.message, /não tem fardo cadastrado/);
  });

  it("compra 1 caixa (12 tabletes): soma 12×200 g e atualiza o preço do tablete pelo valor pago", async () => {
    const r = await painel.post("/estoque/movimentos", { ingrediente_id: manteiga.id, tipo: "compra", forma: "fardo", embalagens: 1, valor: 11400, nota: "Atacado" });
    assert.equal(r.ingrediente.estoque, 400 + 2400, "12 tabletes de 200 g = 2400 g");
    assert.equal(r.ingrediente.embalagem_preco, 950, "R$ 114,00 ÷ 12 tabletes = R$ 9,50 cada");
    const h = (await historico(manteiga.id))[0];
    assert.equal(h.tipo, "compra");
    assert.equal(h.quantidade, 2400);
    assert.equal(h.valor, 11400);
    assert.equal(h.nota, "Atacado");
  });

  it("comprar 0,5 fardo funciona (meia caixa) e sem informar valor não mexe no preço", async () => {
    const antes = await atual(manteiga.id);
    const r = await painel.post("/estoque/movimentos", { ingrediente_id: manteiga.id, tipo: "compra", forma: "fardo", embalagens: "0,5" });
    assert.equal(r.ingrediente.estoque, antes.estoque + 1200, "6 tabletes de 200 g");
    assert.equal(r.ingrediente.embalagem_preco, antes.embalagem_preco, "sem valor informado, o preço não muda");
  });

  it("comprar em embalagem continua funcionando normalmente (forma padrão)", async () => {
    const antes = await atual(manteiga.id);
    const r = await painel.post("/estoque/movimentos", { ingrediente_id: manteiga.id, tipo: "compra", embalagens: 2, valor: 1900 });
    assert.equal(r.ingrediente.estoque, antes.estoque + 400);
    assert.equal(r.ingrediente.embalagem_preco, 950);
  });
});

describe("receber compra em lote com fardo", () => {
  it("mistura itens em embalagem e em fardo na mesma nota", async () => {
    const ings = (await painel.get("/ingredientes")).ingredientes;
    const manteiga = ings.find((i) => i.nome === "Manteiga em barra");
    const farinha = ings.find((i) => i.nome === "Farinha de trigo");
    const antesManteiga = await atual(manteiga.id);
    const antesFarinha = await atual(farinha.id);
    const r = await painel.post("/estoque/compra", { nota: "Nota 900", itens: [
      { ingrediente_id: manteiga.id, forma: "fardo", embalagens: 1, valor: 11400 },
      { ingrediente_id: farinha.id, embalagens: 3, valor: 1650 },
    ] });
    assert.deepEqual([r.itens, r.total], [2, 13050]);
    assert.equal((await atual(manteiga.id)).estoque, antesManteiga.estoque + 2400);
    assert.equal((await atual(farinha.id)).estoque, antesFarinha.estoque + 3000);
    assert.equal((await atual(farinha.id)).embalagem_preco, 550, "R$ 16,50 ÷ 3 pacotes = R$ 5,50");
  });

  it("recusa fardo para um item que não tem fardo cadastrado (tudo ou nada)", async () => {
    const farinha = (await painel.get("/ingredientes")).ingredientes.find((i) => i.nome === "Farinha de trigo");
    const antes = await atual(farinha.id);
    const e = await falha(painel.post("/estoque/compra", { itens: [{ ingrediente_id: farinha.id, forma: "fardo", embalagens: 1 }] }));
    assert.equal(e.status, 422);
    assert.match(e.message, /Farinha de trigo não tem fardo cadastrado/);
    assert.equal((await atual(farinha.id)).estoque, antes.estoque, "nada foi lançado");
  });
});

describe("registro de atividade", () => {
  it("mudar o fardo de um ingrediente fica registrado na atividade", async () => {
    const manteiga = (await painel.get("/ingredientes")).ingredientes.find((i) => i.nome === "Manteiga em barra");
    await painel.put(`/ingredientes/${manteiga.id}`, { nome: "Manteiga em barra", unidade: "g", embalagem_qtd: 200, embalagem_nome: "tablete", embalagem_preco: 950,
      fardo_nome: "caixa", fardo_qtd: 24, fardo_preco: 22000 });
    const a = (await painel.get("/auditoria?limite=50")).itens;
    assert.ok(a.some((x) => x.tabela === "ingredientes" && x.resumo === "Manteiga em barra" && x.detalhes.fardo_qtd));
  });
});
