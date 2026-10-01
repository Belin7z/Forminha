/* ==========================================================
   MONTE SUA CAIXA — grupo de opções "quantidade": a caixa tem um
   total certo e o cliente diz quantos de cada sabor. O banco confere
   a soma, cobra o adicional por unidade, guarda "10× Brigadeiro"
   no pedido e o estoque desconta a receita de cada sabor por unidade.
   As contas da tela (base/opcoes.js) são as mesmas.
   ========================================================== */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { iniciarEmulador } from "./emulador/servidor.js";
import { criarApiLoja } from "../../../Loja/src/scripts/base/api/loja.js";
import { criarApiPainel } from "../../src/scripts/base/api/painel.js";
import { gerarHorarios, dataISO } from "../../../Loja/src/scripts/base/agendamento.js";
import { chaveDaSelecao, descricaoDaSelecao, extrasDaSelecao, faltandoNaSelecao, opcoesEmTexto, selecaoDaDescricao, somaDaCaixa } from "../../../Loja/src/scripts/base/opcoes.js";

let emu, painel, cliente, caixa, quando;
const novoCliente = () => createClient(emu.url, emu.chaveAnon, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
async function falha(promessa) { try { await promessa; } catch (e) { return e; } assert.fail("era esperado um erro"); }

function proximaData(cfg) {
  const minimo = new Date(Date.now() + 96 * 3600_000);
  for (let i = 0; i < 30; i++) {
    const d = new Date(minimo.getFullYear(), minimo.getMonth(), minimo.getDate() + i);
    const horas = gerarHorarios(cfg.horarios, dataISO(d), minimo, cfg.pedidos.intervalo_min);
    if (horas.length) return { data: dataISO(d), hora: horas[0] };
  }
  throw new Error("sem data disponível");
}

const SABORES = { nome: "Sabores", tipo: "quantidade", total: 25, itens: [{ nome: "Brigadeiro", preco: 0 }, { nome: "Beijinho", preco: 0 }, { nome: "Pistache", preco: 50 }] };
const pedidoCom = (opcoes, qtd = 2) => ({ itens: [{ produto_id: caixa.id, qtd, opcoes }], tipo: "retirada", ...quando, pagamento: "dinheiro" });

before(async () => {
  emu = await iniciarEmulador();
  const admin = await emu.criarAdmin("dona@teste.local", "Admin12345");
  painel = criarApiPainel(novoCliente());
  await painel.post("/auth/entrar", { email: admin.email, senha: admin.senha });
  cliente = criarApiLoja(novoCliente());
  await cliente.post("/auth/cadastro", { nome: "Cliente Caixa", email: "caixa@teste.com", telefone: "11999998888", senha: "Senha1234" });
  quando = proximaData(await criarApiLoja(novoCliente()).get("/config"));
  const categoria_id = (await painel.get("/categorias")).categorias[0].id;
  caixa = (await painel.post("/produtos", { categoria_id, nome: "Caixa com 25 docinhos", descricao: "Monte do seu jeito", preco: 5000, unidade: "caixa", min_qtd: 1,
    emoji: "🍬", tag: "", antecedencia_horas: 24, ativo: true, destaque: false, opcoes: [SABORES] })).produto;
});
after(async () => { await emu?.fechar(); });

describe("monte sua caixa: no cadastro", () => {
  it("o grupo guarda o total e é sempre obrigatório", () => {
    const g = caixa.opcoes[0];
    assert.deepEqual([g.tipo, g.total, g.obrigatorio, g.max], ["quantidade", 25, true, null]);
    assert.deepEqual(g.itens.map((i) => i.id), ["g1i1", "g1i2", "g1i3"]);
  });

  it("sem o total (ou fora de 2 a 500) não salva", async () => {
    const base = { ...caixa, opcoes: [{ ...SABORES, total: null }] };
    for (const total of [null, 1, 501, "dez"]) {
      const e = await falha(painel.put(`/produtos/${caixa.id}`, { ...base, opcoes: [{ ...SABORES, total }] }));
      assert.equal(e.status, 422, String(total));
    }
  });
});

describe("monte sua caixa: no pedido", () => {
  it("a soma certa passa, e o adicional conta por unidade", async () => {
    const o = await cliente.post("/pedidos/orcamento", pedidoCom({ g1: { g1i1: 10, g1i2: 10, g1i3: 5 } }));
    assert.deepEqual(o.problemas, [], JSON.stringify(o.problemas));
    assert.equal(o.subtotal, (5000 + 5 * 50) * 2);
  });

  it("soma errada, quantidade estranha ou sabor que não existe: o banco recusa", async () => {
    const recusa = async (opcoes, padrao) => {
      const o = await cliente.post("/pedidos/orcamento", pedidoCom(opcoes));
      assert.ok(o.problemas.some((p) => padrao.test(p.mensagem)), `${JSON.stringify(opcoes)} -> ${JSON.stringify(o.problemas)}`);
    };
    await recusa({ g1: { g1i1: 24 } }, /escolha 25 unidades em "Sabores" \(você escolheu 24\)/);
    await recusa({ g1: { g1i1: 20, g1i2: 6 } }, /você escolheu 26/);
    await recusa({}, /você escolheu 0/);
    await recusa({ g1: ["g1i1"] }, /você escolheu 0/);
    await recusa({ g1: { g1i1: -5, g1i2: 30 } }, /quantidade inválida/);
    await recusa({ g1: { g1i1: 12.5, g1i2: 12.5 } }, /quantidade inválida/);
    await recusa({ g1: { g1i9: 25 } }, /opção inválida/);
    assert.equal((await falha(cliente.post("/pedidos", pedidoCom({ g1: { g1i1: 24 } })))).status, 422, "e não cria o pedido");
  });

  it("o pedido guarda quantos de cada sabor (sem os zeros)", async () => {
    const { pedido } = await cliente.post("/pedidos", pedidoCom({ g1: { g1i1: 15, g1i2: 0, g1i3: 10 } }, 1));
    assert.deepEqual(pedido.itens[0].opcoes, [{ grupo: "Sabores", itens: [{ nome: "Brigadeiro", preco: 0, qtd: 15 }, { nome: "Pistache", preco: 50, qtd: 10 }] }]);
    assert.equal(pedido.itens[0].preco_unit, 5000 + 10 * 50);
    assert.equal(opcoesEmTexto(pedido.itens[0].opcoes), "Sabores: 15× Brigadeiro, 10× Pistache");
  });

  it("o pedido lançado pela loja também confere a caixa", async () => {
    const corpo = (opcoes) => ({ nome: "Cliente do balcão", telefone: "(11) 98888-7777", itens: [{ produto_id: caixa.id, qtd: 1, opcoes }], tipo: "retirada", ...quando, pagamento: "dinheiro" });
    const e = await falha(painel.post("/pedidos", corpo({ g1: { g1i1: 3 } })));
    assert.equal(e.status, 422);
    const { pedido } = await painel.post("/pedidos", corpo({ g1: { g1i1: 20, g1i2: 5 } }));
    assert.equal(pedido.itens[0].opcoes[0].itens.length, 2);
  });
});

describe("monte sua caixa: no estoque", () => {
  it("a receita de cada sabor conta pelo número de unidades na caixa", async () => {
    const leite = (await painel.post("/ingredientes", { nome: "Leite condensado da caixa", unidade: "g" })).ingrediente;
    const coco = (await painel.post("/ingredientes", { nome: "Coco ralado da caixa", unidade: "g" })).ingrediente;
    await painel.put(`/receitas/${caixa.id}`, { rendimento: 1, linhas: [
      { ingrediente_id: leite.id, quantidade: 10, opcao_grupo: "Sabores", opcao_item: "Brigadeiro" },
      { ingrediente_id: leite.id, quantidade: 8, opcao_grupo: "Sabores", opcao_item: "Beijinho" },
      { ingrediente_id: coco.id, quantidade: 3, opcao_grupo: "Sabores", opcao_item: "Beijinho" },
    ] });
    const prev = await painel.get("/estoque/previsao?dias=60");
    const usa = (ing) => prev.itens.find((i) => i.id === ing.id)?.necessario;
    // pedidos com a caixa até aqui: 1 caixa com 15 brigadeiros + 1 caixa (da loja) com 20 brigadeiros e 5 beijinhos
    assert.equal(usa(leite), 15 * 10 + 20 * 10 + 5 * 8);
    assert.equal(usa(coco), 5 * 3);
  });
});

describe("monte sua caixa: as contas da tela", () => {
  const produto = { preco: 5000, opcoes: [
    { id: "g1", nome: "Sabores", tipo: "quantidade", total: 4, obrigatorio: true, itens: [{ id: "g1i1", nome: "Ninho", preco: 0 }, { id: "g1i2", nome: "Pistache", preco: 100 }] },
    { id: "g2", nome: "Fita", tipo: "unica", obrigatorio: true, itens: [{ id: "g2i1", nome: "Rosa", preco: 0 }, { id: "g2i2", nome: "Dourada", preco: 300 }] },
  ] };

  it("o que falta, o que custa e como fica no texto", () => {
    assert.equal(faltandoNaSelecao(produto, {}).texto, "Sabores: faltam 4");
    assert.equal(faltandoNaSelecao(produto, { g1: { g1i1: 5 } }).texto, "Sabores: tire 1");
    assert.equal(faltandoNaSelecao(produto, { g1: { g1i1: 4 } }).texto, "Escolha: Fita");
    const certo = { g1: { g1i1: 1, g1i2: 3 }, g2: ["g2i2"] };
    assert.equal(faltandoNaSelecao(produto, certo), null);
    assert.equal(somaDaCaixa(certo.g1), 4);
    assert.equal(extrasDaSelecao(produto, certo), 3 * 100 + 300);
    assert.equal(opcoesEmTexto(descricaoDaSelecao(produto, certo)), "Sabores: 1× Ninho, 3× Pistache · Fita: Dourada");
  });

  it("a mesma caixa em outra ordem é o mesmo item no carrinho; pedir de novo refaz a escolha", () => {
    assert.equal(chaveDaSelecao({ g1: { g1i2: 3, g1i1: 1 }, g2: ["g2i2"] }), chaveDaSelecao({ g2: ["g2i2"], g1: { g1i1: 1, g1i2: 3, g1i3: 0 } }));
    assert.notEqual(chaveDaSelecao({ g1: { g1i1: 2, g1i2: 2 } }), chaveDaSelecao({ g1: { g1i1: 1, g1i2: 3 } }));
    const descricao = [{ grupo: "Sabores", itens: [{ nome: "Ninho", qtd: 1 }, { nome: "Pistache", qtd: 3 }] }, { grupo: "Fita", itens: [{ nome: "Dourada" }] }];
    assert.deepEqual(selecaoDaDescricao(produto, descricao), { g1: { g1i1: 1, g1i2: 3 }, g2: ["g2i2"] });
    const caixaMaior = { ...produto, opcoes: [{ ...produto.opcoes[0], total: 6 }, produto.opcoes[1]] };
    assert.equal(selecaoDaDescricao(caixaMaior, descricao).g1, undefined, "a caixa mudou de tamanho: o cliente escolhe de novo");
  });
});
