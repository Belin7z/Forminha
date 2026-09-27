/* ==========================================================
   ESTOQUE — ingredientes, receitas, baixa automática e previsão
   de compras. Só o administrador mexe; a conta é feita pelo
   banco (receita ÷ rendimento × quantidade + acréscimos das
   opções escolhidas) e a baixa acontece uma vez por pedido.
   ========================================================== */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { iniciarEmulador } from "./emulador/servidor.js";
import { criarApiLoja } from "../../../Loja/src/scripts/base/api/loja.js";
import { criarApiPainel } from "../../src/scripts/base/api/painel.js";
import { gerarHorarios, dataISO } from "../../../Loja/src/scripts/base/agendamento.js";

let emu, painel, visitante, cliente, atendente, produtos, quando;
let farinha, leite, ovo, cenoura;
let pedido1, pedido2;
const novoCliente = () => createClient(emu.url, emu.chaveAnon, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
async function falha(promessa) { try { await promessa; } catch (e) { return e; } assert.fail("era esperado um erro"); }
const produto = (nome) => produtos.find((p) => p.nome === nome);
const previsao = (dias = 60) => painel.get(`/estoque/previsao?dias=${dias}`);
const linha = (prev, ing) => prev.itens.find((i) => i.id === ing.id);
const atual = async (ing) => (await painel.get("/ingredientes")).ingredientes.find((i) => i.id === ing.id);
const historico = async (ing) => (await painel.get(`/estoque/movimentos?ingrediente_id=${ing.id}`)).itens;
const auditoria = async () => (await painel.get("/auditoria?limite=300")).itens;

function proximaData(cfg) {
  const minimo = new Date(Date.now() + 96 * 3600_000);
  for (let i = 0; i < 30; i++) {
    const d = new Date(minimo.getFullYear(), minimo.getMonth(), minimo.getDate() + i);
    const horas = gerarHorarios(cfg.horarios, dataISO(d), minimo, cfg.pedidos.intervalo_min);
    if (horas.length) return { data: dataISO(d), hora: horas[0] };
  }
  throw new Error("sem data disponível");
}
const pedir = (itens) => cliente.post("/pedidos", { itens, tipo: "retirada", ...quando, pagamento: "dinheiro" });

before(async () => {
  emu = await iniciarEmulador();
  const dados = await emu.criarAdmin("dona@teste.local", "Admin12345");
  painel = criarApiPainel(novoCliente());
  await painel.post("/auth/entrar", { email: dados.email, senha: dados.senha });
  visitante = criarApiLoja(novoCliente());
  cliente = criarApiLoja(novoCliente());
  await cliente.post("/auth/cadastro", { nome: "Cliente Estoque", email: "estoque@teste.com", telefone: "11999998888", senha: "Senha1234" });
  const conta = criarApiLoja(novoCliente());
  await conta.post("/auth/cadastro", { nome: "Ana Atendente", email: "ana@teste.com", telefone: "11955554444", senha: "Senha1234" });
  await painel.post("/equipe", { email: "ana@teste.com", papel: "atendente" });
  atendente = criarApiPainel(novoCliente());
  await atendente.post("/auth/entrar", { email: "ana@teste.com", senha: "Senha1234" });
  produtos = (await visitante.get("/catalogo")).produtos;
  quando = proximaData(await visitante.get("/config"));
});
after(async () => { await emu?.fechar(); });

describe("quem pode mexer no estoque", () => {
  it("só o administrador: visitante, cliente e atendente são barrados em tudo", async () => {
    const chamadas = (api) => [
      () => api.get("/ingredientes"), () => api.post("/ingredientes", { nome: "X", unidade: "g" }), () => api.get("/estoque/previsao"),
      () => api.get("/receitas"), () => api.get("/receitas/1"), () => api.put("/receitas/1", { linhas: [] }),
      () => api.post("/estoque/movimentos", { ingrediente_id: 1, tipo: "perda", quantidade: 1 }), () => api.get("/estoque/movimentos"),
      () => api.put("/estoque/config", { baixa_automatica: true }), () => api.delete("/ingredientes/1"),
    ];
    for (const [api, status] of [[criarApiPainel(visitante.supabase), 401], [criarApiPainel(cliente.supabase), 403], [atendente, 403]]) {
      for (const chamar of chamadas(api)) assert.equal((await falha(chamar())).status, status);
    }
  });
});

describe("ingredientes", () => {
  it("cadastra com embalagem de compra e estoque inicial (que entra no histórico)", async () => {
    farinha = (await painel.post("/ingredientes", { nome: "Farinha de trigo", unidade: "g", estoque: 2000, minimo: 500, embalagem_qtd: 1000, embalagem_nome: "pacote", embalagem_preco: 500, fornecedor: "Atacado" })).ingrediente;
    assert.equal(farinha.estoque, 2000);
    assert.equal(farinha.custo_unit, 0.5, "R$ 5,00 por 1000 g = 0,5 centavo por grama");
    assert.equal(farinha.valor_estoque, 1000);
    const h = await historico(farinha);
    assert.equal(h.length, 1);
    assert.equal(h[0].tipo, "inicial");
    assert.equal(h[0].saldo, 2000);

    leite = (await painel.post("/ingredientes", { nome: "Leite condensado", unidade: "g", embalagem_qtd: 395, embalagem_nome: "lata", embalagem_preco: 700 })).ingrediente;
    ovo = (await painel.post("/ingredientes", { nome: "Ovos", unidade: "un", estoque: 6, embalagem_qtd: 12, embalagem_nome: "cartela", embalagem_preco: 1200 })).ingrediente;
    cenoura = (await painel.post("/ingredientes", { nome: "Cenoura", unidade: "g", estoque: 5000, embalagem_qtd: 1000, embalagem_nome: "kg", embalagem_preco: 600 })).ingrediente;
    assert.equal(leite.estoque, 0);
    assert.equal((await historico(leite)).length, 0, "sem estoque inicial não há lançamento");
  });

  it("valida os campos e não repete nome (sem diferenciar maiúsculas)", async () => {
    assert.ok((await falha(painel.post("/ingredientes", { nome: "", unidade: "g" }))).campos.nome);
    assert.ok((await falha(painel.post("/ingredientes", { nome: "Sal", unidade: "kg" }))).campos.unidade);
    assert.ok((await falha(painel.post("/ingredientes", { nome: "Sal", unidade: "g", embalagem_qtd: 0 }))).campos.embalagem_qtd);
    assert.ok((await falha(painel.post("/ingredientes", { nome: "Sal", unidade: "g", minimo: -1 }))).campos.minimo);
    assert.ok((await falha(painel.post("/ingredientes", { nome: "Sal", unidade: "g", embalagem_preco: 1.5 }))).campos.embalagem_preco);
    assert.equal((await falha(painel.post("/ingredientes", { nome: "FARINHA DE TRIGO", unidade: "g" }))).status, 409);
  });

  it("aceita vírgula decimal e lista em ordem alfabética com a configuração do estoque", async () => {
    const manteiga = (await painel.post("/ingredientes", { nome: "Manteiga", unidade: "g", estoque: "1,5", embalagem_qtd: "200,5", embalagem_preco: 1000 })).ingrediente;
    assert.equal(manteiga.estoque, 1.5);
    assert.equal(manteiga.embalagem_qtd, 200.5);
    const r = await painel.get("/ingredientes");
    assert.deepEqual(r.config, { baixa_automatica: true, dias_previsao: 7, dias_validade: 7 });
    const nomes = r.ingredientes.map((i) => i.nome);
    assert.deepEqual(nomes, [...nomes].sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" })));
    await painel.delete(`/ingredientes/${manteiga.id}`);
    assert.ok(!(await painel.get("/ingredientes")).ingredientes.some((i) => i.id === manteiga.id));
  });

  it("edita os dados sem mexer na quantidade", async () => {
    const r = (await painel.put(`/ingredientes/${farinha.id}`, { nome: "Farinha de trigo", unidade: "g", minimo: 600, embalagem_qtd: 1000, embalagem_nome: "pacote", embalagem_preco: 500, fornecedor: "Atacado Novo" })).ingrediente;
    assert.equal(r.minimo, 600);
    assert.equal(r.fornecedor, "Atacado Novo");
    assert.equal(r.estoque, 2000, "estoque só muda por lançamento");
    farinha = (await painel.put(`/ingredientes/${farinha.id}`, { nome: "Farinha de trigo", unidade: "g", minimo: 500, embalagem_qtd: 1000, embalagem_nome: "pacote", embalagem_preco: 500 })).ingrediente;
    assert.equal((await falha(painel.put("/ingredientes/999999", { nome: "Fantasma", unidade: "g" }))).status, 404);
  });
});

describe("entradas, contagem e perdas", () => {
  it("compra: soma embalagens × tamanho da embalagem e guarda o preço pago por embalagem", async () => {
    const r = await painel.post("/estoque/movimentos", { ingrediente_id: leite.id, tipo: "compra", embalagens: 2, valor: 1600, nota: "Mercado" });
    assert.equal(r.ingrediente.estoque, 790);
    assert.equal(r.ingrediente.embalagem_preco, 800, "R$ 16,00 por 2 latas = R$ 8,00 cada");
    const h = await historico(leite);
    assert.equal(h[0].tipo, "compra");
    assert.equal(h[0].quantidade, 790);
    assert.equal(h[0].valor, 1600);
    assert.equal(h[0].nota, "Mercado");
    // volta ao preço combinado, para as contas seguintes
    await painel.post("/estoque/movimentos", { ingrediente_id: leite.id, tipo: "compra", embalagens: 0.5, valor: 350 });
    assert.equal((await atual(leite)).embalagem_preco, 700);
    assert.equal((await atual(leite)).estoque, 987.5);
    const acerto = await painel.post("/estoque/movimentos", { ingrediente_id: leite.id, tipo: "ajuste", novo_estoque: 790, nota: "Contagem" });
    assert.equal(acerto.ingrediente.estoque, 790);
  });

  it("contagem: informa o que existe de verdade e o sistema calcula a diferença", async () => {
    const r = await painel.post("/estoque/movimentos", { ingrediente_id: farinha.id, tipo: "ajuste", novo_estoque: 1800 });
    assert.equal(r.ingrediente.estoque, 1800);
    const h = (await historico(farinha))[0];
    assert.equal(h.tipo, "ajuste");
    assert.equal(h.quantidade, -200);
    assert.equal(h.saldo, 1800);
    const igual = await painel.post("/estoque/movimentos", { ingrediente_id: farinha.id, tipo: "ajuste", novo_estoque: 1800 });
    assert.equal(igual.sem_mudanca, true);
    assert.equal((await historico(farinha)).length, 2, "contagem igual não gera lançamento");
    await painel.post("/estoque/movimentos", { ingrediente_id: farinha.id, tipo: "ajuste", novo_estoque: 2000, nota: "Achei um pacote" });
  });

  it("perda desconta o que estragou ou caiu", async () => {
    const r = await painel.post("/estoque/movimentos", { ingrediente_id: ovo.id, tipo: "perda", quantidade: 1, nota: "Quebrou" });
    assert.equal(r.ingrediente.estoque, 5);
    assert.equal((await historico(ovo))[0].quantidade, -1);
    await painel.post("/estoque/movimentos", { ingrediente_id: ovo.id, tipo: "ajuste", novo_estoque: 6 });
  });

  it("valida o lançamento", async () => {
    assert.equal((await falha(painel.post("/estoque/movimentos", { ingrediente_id: ovo.id, tipo: "roubo", quantidade: 1 }))).status, 422);
    assert.ok((await falha(painel.post("/estoque/movimentos", { ingrediente_id: ovo.id, tipo: "compra", embalagens: 0 }))).campos.embalagens);
    assert.ok((await falha(painel.post("/estoque/movimentos", { ingrediente_id: ovo.id, tipo: "perda", quantidade: -3 }))).campos.quantidade);
    assert.ok((await falha(painel.post("/estoque/movimentos", { ingrediente_id: ovo.id, tipo: "ajuste", novo_estoque: -1 }))).campos.novo_estoque);
    assert.equal((await falha(painel.post("/estoque/movimentos", { ingrediente_id: 999999, tipo: "perda", quantidade: 1 }))).status, 404);
    assert.equal((await atual(ovo)).estoque, 6, "lançamento recusado não muda nada");
  });
});

describe("receitas", () => {
  const ninho = () => produto("Bolo Ninho com Morango");
  const cenouraBolo = () => produto("Bolo de Cenoura com Brigadeiro");

  it("produto sem receita aparece como tal, sem custo", async () => {
    const lista = (await painel.get("/receitas")).produtos;
    const p = lista.find((x) => x.id === ninho().id);
    assert.equal(p.tem_receita, false);
    assert.equal(p.custo_unit, null);
    assert.equal(p.pode_fazer, null);
    const r = await painel.get(`/receitas/${ninho().id}`);
    assert.deepEqual(r.linhas, []);
    assert.equal(r.rendimento, 1);
    assert.equal(r.produto.opcoes[0].nome, "Tamanho");
  });

  it("salva a receita com acréscimos por opção e calcula custo, margem e quantos dá para fazer", async () => {
    const r = await painel.put(`/receitas/${ninho().id}`, {
      rendimento: 1,
      linhas: [
        { ingrediente_id: farinha.id, quantidade: 400 },
        { ingrediente_id: leite.id, quantidade: 395 },
        { ingrediente_id: ovo.id, quantidade: 4 },
        { ingrediente_id: farinha.id, quantidade: 200, opcao_grupo: "Tamanho", opcao_item: "1,5 kg (15 fatias)" },
        { ingrediente_id: farinha.id, quantidade: 400, opcao_grupo: "Tamanho", opcao_item: "2 kg (20 fatias)" },
        { ingrediente_id: ovo.id, quantidade: 2, opcao_grupo: "Tamanho", opcao_item: "2 kg (20 fatias)" },
      ],
    });
    assert.equal(r.custo_unit, 1300, "400 g de farinha (200) + 1 lata de leite (700) + 4 ovos (400)");

    const p = (await painel.get("/receitas")).produtos.find((x) => x.id === ninho().id);
    assert.equal(p.tem_receita, true);
    assert.equal(p.linhas, 6);
    assert.equal(p.custo_unit, 1300);
    assert.equal(p.margem, 8990 - 1300);
    assert.equal(p.margem_pct, 85.5);
    assert.equal(p.pode_fazer, 1, "só há 6 ovos e cada bolo leva 4");
    assert.equal(p.limitante, "Ovos");

    const det = await painel.get(`/receitas/${ninho().id}`);
    assert.equal(det.linhas.length, 6);
    assert.equal(det.linhas[0].opcao_grupo, null, "linhas-base primeiro");
    assert.ok(det.linhas.every((l) => l.opcao_existe));
  });

  it("rendimento: a receita inteira rende várias unidades", async () => {
    await painel.put(`/receitas/${cenouraBolo().id}`, { rendimento: 4, linhas: [{ ingrediente_id: cenoura.id, quantidade: 1000 }] });
    const p = (await painel.get("/receitas")).produtos.find((x) => x.id === cenouraBolo().id);
    assert.equal(p.custo_unit, 150, "1 kg de cenoura (R$ 6,00) ÷ 4 bolos");
    assert.equal(p.pode_fazer, 20, "5 kg de cenoura ÷ 250 g por bolo");
  });

  it("recusa receita com opção que não existe, ingrediente repetido ou linha inválida", async () => {
    const id = ninho().id;
    const ruim = (linhas) => painel.put(`/receitas/${id}`, { linhas });
    assert.equal((await falha(ruim([{ ingrediente_id: ovo.id, quantidade: 1, opcao_grupo: "Tamanho", opcao_item: "3 kg" }]))).status, 422);
    assert.equal((await falha(ruim([{ ingrediente_id: ovo.id, quantidade: 1, opcao_grupo: "Tamanho" }]))).status, 422);
    assert.equal((await falha(ruim([{ ingrediente_id: ovo.id, quantidade: 1 }, { ingrediente_id: ovo.id, quantidade: 2 }]))).status, 422);
    assert.equal((await falha(ruim([{ ingrediente_id: 999999, quantidade: 1 }]))).status, 422);
    assert.ok((await falha(ruim([{ ingrediente_id: ovo.id, quantidade: 0 }]))).campos.quantidade);
    assert.equal((await falha(painel.put(`/receitas/${id}`, { rendimento: 0, linhas: [{ ingrediente_id: ovo.id, quantidade: 1 }] }))).status, 422);
    assert.equal((await falha(painel.put("/receitas/999999", { linhas: [] }))).status, 404);
    assert.equal((await painel.get(`/receitas/${id}`)).linhas.length, 6, "a receita boa continua intacta");
  });

  it("ingrediente usado em receita não pode ser excluído nem mudar de unidade", async () => {
    const e = await falha(painel.delete(`/ingredientes/${ovo.id}`));
    assert.equal(e.status, 409);
    assert.match(e.message, /Bolo Ninho com Morango/);
    const u = await falha(painel.put(`/ingredientes/${ovo.id}`, { nome: "Ovos", unidade: "g", embalagem_qtd: 12, embalagem_preco: 1200 }));
    assert.equal(u.status, 409);
    assert.ok(u.campos?.unidade || /unidade/.test(u.message));
  });
});

describe("previsão de compras", () => {
  it("sem pedidos agendados nada falta e a lista de compras fica vazia", async () => {
    const p = await previsao();
    assert.equal(p.pedidos, 0);
    assert.equal(p.resumo.faltando, 0);
    assert.equal(p.resumo.a_comprar, 0);
    assert.equal(linha(p, ovo).necessario, 0);
    assert.equal(linha(p, ovo).situacao, "ok");
  });

  it("soma o que os pedidos vão gastar: receita, acréscimo do tamanho e rendimento", async () => {
    pedido1 = (await pedir([
      { produto_id: produto("Bolo Ninho com Morango").id, qtd: 2, opcoes: { g1: ["g1i2"] } },
      { produto_id: produto("Bolo de Cenoura com Brigadeiro").id, qtd: 3, opcoes: { g1: ["g1i1"] } },
      { produto_id: produto("Bolo Red Velvet").id, qtd: 1, opcoes: { g1: ["g1i1"] } },
    ])).pedido;
    const p = await previsao();
    assert.equal(p.pedidos, 1);
    assert.equal(linha(p, farinha).necessario, 1200, "2 × (400 + 200 do tamanho 1,5 kg)");
    assert.equal(linha(p, leite).necessario, 790);
    assert.equal(linha(p, ovo).necessario, 8);
    assert.equal(linha(p, cenoura).necessario, 750, "3 × (1000 ÷ 4)");
    assert.deepEqual(linha(p, ovo).usado_em.map((u) => u.nome), ["Bolo Ninho com Morango"]);
    assert.equal(linha(p, ovo).dias[0].data, quando.data);
  });

  it("avisa o que vai faltar, a partir de que dia, e quanto comprar (em embalagens inteiras)", async () => {
    const p = await previsao();
    const o = linha(p, ovo);
    assert.equal(o.situacao, "faltando");
    assert.equal(o.saldo, -2);
    assert.equal(o.falta_em, quando.data);
    assert.equal(o.comprar_embalagens, 1);
    assert.equal(o.comprar_qtd, 12);
    assert.equal(o.comprar_valor, 1200);
    assert.equal(linha(p, farinha).situacao, "ok");
    assert.equal(linha(p, leite).situacao, "ok", "o saldo chega a zero mas não fica negativo");
    assert.equal(linha(p, leite).comprar_embalagens, 0);
    assert.equal(p.resumo.faltando, 1);
    assert.equal(p.resumo.a_comprar, 1);
    assert.equal(p.resumo.valor_compras, 1200);
    assert.equal(p.itens[0].id, ovo.id, "o que falta vem primeiro");
  });

  it("estoque mínimo também gera compra: repõe até o mínimo depois de gastar", async () => {
    await painel.put(`/ingredientes/${farinha.id}`, { nome: "Farinha de trigo", unidade: "g", minimo: 900, embalagem_qtd: 1000, embalagem_nome: "pacote", embalagem_preco: 500 });
    const f = linha(await previsao(), farinha);
    assert.equal(f.situacao, "baixo", "sobram 800 g e o mínimo é 900 g");
    assert.equal(f.comprar_embalagens, 1);
    assert.equal(f.comprar_qtd, 1000);
    assert.equal(f.comprar_valor, 500);
    await painel.put(`/ingredientes/${farinha.id}`, { nome: "Farinha de trigo", unidade: "g", minimo: 500, embalagem_qtd: 1000, embalagem_nome: "pacote", embalagem_preco: 500 });
  });

  it("lista os produtos vendidos que ainda não têm receita (ficam de fora da conta)", async () => {
    const p = await previsao();
    assert.deepEqual(p.sem_receita.map((s) => s.nome), ["Bolo Red Velvet"]);
    assert.equal(p.sem_receita[0].qtd, 1);
  });

  it("o período escolhido manda: pedido depois dele não entra", async () => {
    const p = await previsao(1);
    assert.equal(p.dias, 1);
    assert.equal(p.pedidos, 0);
    assert.equal(linha(p, ovo).necessario, 0);
    assert.equal((await falha(painel.get("/estoque/previsao?dias=0"))).status, 422);
    assert.equal((await falha(painel.get("/estoque/previsao?dias=61"))).status, 422);
  });

  it("cancelado e entregue não contam", async () => {
    const extra = (await pedir([{ produto_id: produto("Bolo Ninho com Morango").id, qtd: 1, opcoes: { g1: ["g1i1"] } }])).pedido;
    assert.equal(linha(await previsao(), ovo).necessario, 12);
    await painel.patch(`/pedidos/${extra.id}/status`, { status: "cancelado", nota: "Desistiu" });
    assert.equal(linha(await previsao(), ovo).necessario, 8);
  });
});

describe("baixa automática", () => {
  it("confirmar o pedido não mexe no estoque; começar o preparo desconta, uma vez só", async () => {
    await painel.patch(`/pedidos/${pedido1.id}/status`, { status: "confirmado", nota: "" });
    assert.equal((await atual(ovo)).estoque, 6);

    await painel.patch(`/pedidos/${pedido1.id}/status`, { status: "em_preparo", nota: "" });
    assert.equal((await atual(farinha)).estoque, 800);
    assert.equal((await atual(leite)).estoque, 0);
    assert.equal((await atual(ovo)).estoque, -2, "estoque negativo mostra que a contagem estava desatualizada");
    assert.equal((await atual(cenoura)).estoque, 4250);

    const h = (await historico(farinha))[0];
    assert.equal(h.tipo, "uso");
    assert.equal(h.quantidade, -1200);
    assert.equal(h.pedido, pedido1.codigo);
    assert.equal(h.usuario, "Administrador");

    await painel.patch(`/pedidos/${pedido1.id}/status`, { status: "pronto", nota: "" });
    assert.equal((await atual(farinha)).estoque, 800, "mudar de etapa de novo não desconta outra vez");
    assert.equal((await historico(farinha)).filter((m) => m.tipo === "uso").length, 1);
  });

  it("depois da baixa o pedido sai da previsão (não conta em dobro)", async () => {
    const p = await previsao();
    assert.equal(p.pedidos, 0);
    assert.equal(linha(p, farinha).necessario, 0);
    assert.equal(linha(p, farinha).saldo, 800);
  });

  it("cancelar um pedido já baixado devolve os ingredientes ao estoque", async () => {
    await painel.patch(`/pedidos/${pedido1.id}/status`, { status: "cancelado", nota: "Cliente desistiu" });
    assert.equal((await atual(farinha)).estoque, 2000);
    assert.equal((await atual(leite)).estoque, 790);
    assert.equal((await atual(ovo)).estoque, 6);
    assert.equal((await atual(cenoura)).estoque, 5000);
    const h = (await historico(farinha))[0];
    assert.equal(h.tipo, "devolucao");
    assert.equal(h.quantidade, 1200);
    assert.match(h.nota, /cancelado/);
  });

  it("com a baixa automática desligada, o estoque só muda por lançamento e o pedido continua na previsão", async () => {
    const r = await painel.put("/estoque/config", { baixa_automatica: false, dias_previsao: 14 });
    assert.deepEqual(r.config, { baixa_automatica: false, dias_previsao: 14, dias_validade: 7 });
    pedido2 = (await pedir([{ produto_id: produto("Bolo Ninho com Morango").id, qtd: 1, opcoes: { g1: ["g1i3"] } }])).pedido;
    await painel.patch(`/pedidos/${pedido2.id}/status`, { status: "confirmado", nota: "" });
    await painel.patch(`/pedidos/${pedido2.id}/status`, { status: "em_preparo", nota: "" });
    assert.equal((await atual(farinha)).estoque, 2000);
    const p = await previsao();
    assert.equal(p.pedidos, 1);
    assert.equal(linha(p, farinha).necessario, 800, "400 + 400 do tamanho 2 kg");
    assert.equal(linha(p, ovo).necessario, 6, "4 + 2 do tamanho 2 kg");
    assert.equal((await falha(painel.put("/estoque/config", { baixa_automatica: true, dias_previsao: 61 }))).status, 422);
    assert.equal((await painel.get("/ingredientes")).config.dias_previsao, 14);
  });

  it("ligando de novo, o próximo pedido que entra em preparo já desconta", async () => {
    await painel.put("/estoque/config", { baixa_automatica: true, dias_previsao: 7 });
    await painel.patch(`/pedidos/${pedido2.id}/status`, { status: "pronto", nota: "" });
    assert.equal((await atual(farinha)).estoque, 1200, "o pedido 'pronto' também aciona a baixa se ainda não houve");
    assert.equal((await atual(ovo)).estoque, 0);
    assert.equal((await previsao()).pedidos, 0);
  });
});

describe("histórico e registro de atividade", () => {
  it("o histórico geral mostra tudo, do mais novo para o mais antigo, com filtro por ingrediente", async () => {
    const geral = (await painel.get("/estoque/movimentos")).itens;
    assert.ok(geral.length > 8);
    const ids = geral.map((m) => m.id);
    assert.deepEqual(ids, [...ids].sort((a, b) => b - a));
    assert.ok(geral.some((m) => m.ingrediente === "Cenoura") && geral.some((m) => m.ingrediente === "Ovos"));
    const soFarinha = (await painel.get(`/estoque/movimentos?ingrediente_id=${farinha.id}`)).itens;
    assert.ok(soFarinha.length && soFarinha.every((m) => m.ingrediente_id === farinha.id));
    assert.equal((await painel.get("/estoque/movimentos?limite=3")).itens.length, 3);
    assert.equal((await falha(painel.get("/estoque/movimentos?limite=1000"))).status, 422);
  });

  it("quem criou ou mudou ingredientes e receitas fica registrado; a quantidade em estoque não (tem histórico próprio)", async () => {
    const a = await auditoria();
    assert.ok(a.some((x) => x.tabela === "ingredientes" && x.operacao === "criou" && x.resumo === "Farinha de trigo"));
    assert.ok(a.some((x) => x.tabela === "ingredientes" && x.operacao === "alterou" && x.resumo === "Farinha de trigo" && x.detalhes.minimo));
    assert.ok(a.some((x) => x.tabela === "ingredientes" && x.operacao === "removeu" && x.resumo === "Manteiga"));
    assert.ok(a.some((x) => x.tabela === "receitas" && x.resumo === "Bolo Ninho com Morango"));
    assert.ok(a.some((x) => x.tabela === "estoque_config"));
    assert.ok(!a.some((x) => x.tabela === "ingredientes" && x.detalhes?.estoque), "contagens e baixas não poluem a atividade");
  });

  it("apagar o produto leva a receita junto, e sem receita o ingrediente pode ser excluído", async () => {
    const id = produto("Bolo de Cenoura com Brigadeiro").id;
    assert.equal((await falha(painel.delete(`/ingredientes/${cenoura.id}`))).status, 409);
    await painel.delete(`/produtos/${id}`);
    assert.equal((await painel.delete(`/ingredientes/${cenoura.id}`)).ok, true);
    assert.ok(!(await painel.get("/ingredientes")).ingredientes.some((i) => i.id === cenoura.id));
  });

  it("receita esvaziada equivale a 'sem receita'", async () => {
    const id = produto("Bolo Ninho com Morango").id;
    const r = await painel.put(`/receitas/${id}`, { linhas: [] });
    assert.equal(r.removida, true);
    assert.equal((await painel.get("/receitas")).produtos.find((x) => x.id === id).tem_receita, false);
    assert.ok((await atual(ovo)), "os ingredientes continuam cadastrados");
    assert.equal((await painel.delete(`/ingredientes/${ovo.id}`)).ok, true);
  });
});
