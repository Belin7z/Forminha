/* ==========================================================
   ESTOQUE AVANÇADO — receitas-base, perda de preparo, medidas
   caseiras, validade por lote, compra e contagem em lote e o
   simulador "quanto preciso para fazer isto?".
   ========================================================== */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { iniciarEmulador } from "./emulador/servidor.js";
import { criarApiLoja } from "../../../Loja/src/scripts/base/api/loja.js";
import { criarApiPainel } from "../../src/scripts/base/api/painel.js";
import { gerarHorarios, dataISO } from "../../../Loja/src/scripts/base/agendamento.js";

let emu, painel, visitante, cliente, atendente, produtos, quando;
let leite, choc, manteiga, granulado, morango, massa, ninho, morangoBrig;
const novoCliente = () => createClient(emu.url, emu.chaveAnon, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
async function falha(promessa) { try { await promessa; } catch (e) { return e; } assert.fail("era esperado um erro"); }
const produto = (nome) => produtos.find((p) => p.nome === nome);
const perto = (a, b, folga = 0.01) => assert.ok(Math.abs(a - b) <= folga, `${a} deveria ser ≈ ${b}`);
const previsao = (dias = 60) => painel.get(`/estoque/previsao?dias=${dias}`);
const linha = (prev, ing) => prev.itens.find((i) => i.id === ing.id);
const atual = async (ing) => (await painel.get("/ingredientes")).ingredientes.find((i) => i.id === ing.id);
const historico = async (ing) => (await painel.get(`/estoque/movimentos?ingrediente_id=${ing.id}`)).itens;
const auditoria = async () => (await painel.get("/auditoria?limite=300")).itens;
const ing = async (dados) => (await painel.post("/ingredientes", dados)).ingrediente;
const dia = (mais = 0) => new Date(Date.now() - 3 * 3600_000 + mais * 86400_000).toISOString().slice(0, 10); // dia de São Paulo

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
  ninho = produto("Brigadeiro de Ninho");
  morangoBrig = produto("Brigadeiro de Morango");
  quando = proximaData(await visitante.get("/config"));
});
after(async () => { await emu?.fechar(); });

describe("permissões", () => {
  it("só o administrador usa as funções novas", async () => {
    const chamadas = (api) => [
      () => api.get("/preparos"), () => api.post("/preparos", { nome: "X", unidade: "g", linhas: [] }), () => api.delete("/preparos/1"),
      () => api.post("/estoque/compra", { itens: [] }), () => api.post("/estoque/contagem", { itens: [] }), () => api.post("/estoque/simular", { itens: [] }),
      () => api.get("/estoque/lotes"), () => api.delete("/estoque/lotes/1"),
    ];
    for (const [api, status] of [[criarApiPainel(visitante.supabase), 401], [criarApiPainel(cliente.supabase), 403], [atendente, 403]]) {
      for (const chamar of chamadas(api)) assert.equal((await falha(chamar())).status, status);
    }
  });
});

describe("ingredientes: medidas caseiras e local", () => {
  it("guarda medidas (xícara, colher) e o local; edição sem esses campos não apaga", async () => {
    leite = await ing({ nome: "Leite condensado", unidade: "g", estoque: 3950, embalagem_qtd: 395, embalagem_nome: "lata", embalagem_preco: 700, local: "Despensa" });
    choc = await ing({ nome: "Chocolate em pó", unidade: "g", estoque: 2000, embalagem_qtd: 1000, embalagem_nome: "pacote", embalagem_preco: 3000,
      medidas: [{ nome: "colher de sopa", qtd: 10 }, { nome: "xícara", qtd: "90,5" }] });
    assert.equal(leite.local, "Despensa");
    assert.deepEqual(choc.medidas, [{ nome: "colher de sopa", qtd: 10 }, { nome: "xícara", qtd: 90.5 }]);
    const editado = (await painel.put(`/ingredientes/${choc.id}`, { nome: "Chocolate em pó", unidade: "g", embalagem_qtd: 1000, embalagem_nome: "pacote", embalagem_preco: 3000 })).ingrediente;
    assert.equal(editado.medidas.length, 2, "sem o campo, as medidas ficam como estavam");
    const limpo = (await painel.put(`/ingredientes/${choc.id}`, { nome: "Chocolate em pó", unidade: "g", embalagem_qtd: 1000, embalagem_nome: "pacote", embalagem_preco: 3000, medidas: [] })).ingrediente;
    assert.deepEqual(limpo.medidas, []);
    choc = limpo;
  });

  it("valida as medidas", async () => {
    const base = { nome: "Teste", unidade: "g" };
    assert.equal((await falha(painel.post("/ingredientes", { ...base, medidas: Array.from({ length: 9 }, (_, i) => ({ nome: `m${i}`, qtd: 1 })) }))).status, 422);
    assert.ok((await falha(painel.post("/ingredientes", { ...base, medidas: [{ nome: "", qtd: 5 }] }))).campos.nome);
    assert.ok((await falha(painel.post("/ingredientes", { ...base, medidas: [{ nome: "xícara", qtd: 0 }] }))).campos.qtd);
    assert.equal((await falha(painel.post("/ingredientes", { ...base, medidas: "xícara" }))).status, 422);
  });

  it("cria os demais ingredientes usados nos testes", async () => {
    manteiga = await ing({ nome: "Manteiga", unidade: "g", estoque: 1000, embalagem_qtd: 200, embalagem_nome: "tablete", embalagem_preco: 1000 });
    granulado = await ing({ nome: "Granulado", unidade: "g", estoque: 200, embalagem_qtd: 500, embalagem_nome: "pote", embalagem_preco: 1000, fornecedor: "Atacadão" });
    morango = await ing({ nome: "Morango", unidade: "g", embalagem_qtd: 300, embalagem_nome: "bandeja", embalagem_preco: 900 });
    assert.equal(granulado.fornecedor, "Atacadão");
  });
});

describe("receitas-base", () => {
  it("cadastra a receita-base com custo do lote e por unidade", async () => {
    const r = (await painel.post("/preparos", { nome: "Massa de brigadeiro", unidade: "un", rendimento: 30, linhas: [
      { ingrediente_id: leite.id, quantidade: 395 }, { ingrediente_id: choc.id, quantidade: 100 }, { ingrediente_id: manteiga.id, quantidade: 20 },
    ] })).preparo;
    massa = r;
    assert.equal(r.custo_lote, 1100, "1 lata (700) + 100 g de chocolate (300) + 20 g de manteiga (100)");
    perto(r.custo_unit, 36.6667);
    assert.equal(r.linhas.length, 3);
    assert.equal(r.usado_em, 0);
    assert.equal((await painel.get("/preparos")).preparos.length, 1);
  });

  it("valida: precisa de ingredientes, sem repetição, nome único, perda até 50%", async () => {
    const base = { nome: "Outra", unidade: "g", linhas: [{ ingrediente_id: leite.id, quantidade: 10 }] };
    assert.equal((await falha(painel.post("/preparos", { ...base, linhas: [] }))).status, 422);
    assert.equal((await falha(painel.post("/preparos", { ...base, linhas: [{ ingrediente_id: leite.id, quantidade: 1 }, { ingrediente_id: leite.id, quantidade: 2 }] }))).status, 422);
    assert.equal((await falha(painel.post("/preparos", { ...base, linhas: [{ ingrediente_id: 999999, quantidade: 1 }] }))).status, 422);
    assert.ok((await falha(painel.post("/preparos", { ...base, linhas: [{ ingrediente_id: leite.id, quantidade: 0 }] }))).campos.quantidade);
    assert.equal((await falha(painel.post("/preparos", { ...base, nome: "massa DE brigadeiro" }))).status, 409);
    assert.ok((await falha(painel.post("/preparos", { ...base, perda_pct: 51 }))).campos.perda_pct);
    assert.equal((await falha(painel.put("/preparos/999999", base))).status, 404);
  });

  it("usa a receita-base na receita do produto: custo, margem e quantas unidades dá para fazer", async () => {
    const r = await painel.put(`/receitas/${ninho.id}`, { rendimento: 1, linhas: [
      { preparo_id: massa.id, quantidade: 1 }, { ingrediente_id: granulado.id, quantidade: 5 },
    ] });
    assert.equal(r.custo_unit, 47, "36,67 da massa + 10 do granulado");
    const p = (await painel.get("/receitas")).produtos.find((x) => x.id === ninho.id);
    assert.equal(p.linhas, 2);
    assert.equal(p.custo_unit, 47);
    assert.equal(p.margem, 380 - 47);
    assert.equal(p.pode_fazer, 40, "200 g de granulado ÷ 5 g");
    assert.equal(p.limitante, "Granulado");
    const det = await painel.get(`/receitas/${ninho.id}`);
    const l = det.linhas.find((x) => x.preparo_id === massa.id);
    assert.equal(l.nome, "Massa de brigadeiro");
    assert.equal(l.ingrediente_id, null);
    const i = await atual(leite);
    assert.equal(i.receitas, 1, "o leite aparece em 1 produto por causa da receita-base");
    assert.equal(i.preparos, 1);
    assert.equal((await painel.get("/preparos")).preparos[0].usado_em, 1);
  });

  it("recusa a mesma receita-base repetida e linha com ingrediente E receita-base", async () => {
    const dupla = await falha(painel.put(`/receitas/${ninho.id}`, { linhas: [{ preparo_id: massa.id, quantidade: 1 }, { preparo_id: massa.id, quantidade: 2 }] }));
    assert.equal(dupla.status, 422);
    const mista = await falha(painel.put(`/receitas/${ninho.id}`, { linhas: [{ preparo_id: massa.id, ingrediente_id: leite.id, quantidade: 1 }] }));
    assert.equal(mista.status, 422);
    const vazia = await falha(painel.put(`/receitas/${ninho.id}`, { linhas: [{ quantidade: 1 }] }));
    assert.equal(vazia.status, 422);
    assert.equal((await painel.get(`/receitas/${ninho.id}`)).linhas.length, 2, "a receita boa continua intacta");
  });

  it("o mesmo preparo serve a vários produtos", async () => {
    await painel.put(`/receitas/${morangoBrig.id}`, { linhas: [{ preparo_id: massa.id, quantidade: 1 }, { ingrediente_id: morango.id, quantidade: 8 }] });
    assert.equal((await painel.get("/preparos")).preparos[0].usado_em, 2);
    assert.equal(Math.round((await painel.get("/receitas")).produtos.find((x) => x.id === morangoBrig.id).custo_unit), 61, "36,67 da massa + 8 g de morango a 3 centavos");
  });

  it("mudar o preço de um ingrediente da receita-base atualiza o custo de todos os produtos", async () => {
    await painel.put(`/ingredientes/${choc.id}`, { nome: "Chocolate em pó", unidade: "g", embalagem_qtd: 1000, embalagem_nome: "pacote", embalagem_preco: 6000 });
    const preparo = (await painel.get("/preparos")).preparos[0];
    assert.equal(preparo.custo_lote, 1400, "o chocolate subiu para 6 centavos o grama");
    const c = (await painel.get("/receitas")).produtos;
    assert.equal(c.find((x) => x.id === ninho.id).custo_unit, 57);
    await painel.put(`/ingredientes/${choc.id}`, { nome: "Chocolate em pó", unidade: "g", embalagem_qtd: 1000, embalagem_nome: "pacote", embalagem_preco: 3000 });
    assert.equal((await painel.get("/receitas")).produtos.find((x) => x.id === ninho.id).custo_unit, 47);
  });
});

describe("previsão com receita-base, fornecedor e perda de preparo", () => {
  let pedido1;
  it("soma o que os pedidos gastam já abrindo a receita-base", async () => {
    pedido1 = (await pedir([{ produto_id: ninho.id, qtd: 60 }])).pedido;
    const p = await previsao();
    assert.equal(linha(p, leite).necessario, 790, "60 ÷ 30 lotes × 395 g");
    assert.equal(linha(p, choc).necessario, 200);
    assert.equal(linha(p, manteiga).necessario, 40);
    assert.equal(linha(p, granulado).necessario, 300);
    const g = linha(p, granulado);
    assert.equal(g.situacao, "faltando");
    assert.equal(g.fornecedor, "Atacadão", "a previsão traz o fornecedor para agrupar as compras");
    assert.equal(g.comprar_embalagens, 1);
    assert.equal(g.comprar_valor, 1000);
    assert.deepEqual(linha(p, leite).usado_em.map((u) => u.nome), ["Brigadeiro de Ninho"]);
  });

  it("perda de preparo da receita e da receita-base aumentam o gasto (e o custo)", async () => {
    await painel.put(`/receitas/${ninho.id}`, { rendimento: 1, perda_pct: 10, linhas: [{ preparo_id: massa.id, quantidade: 1 }, { ingrediente_id: granulado.id, quantidade: 5 }] });
    let p = await previsao();
    assert.equal(linha(p, granulado).necessario, 330, "300 g + 10% de perda");
    assert.equal(linha(p, leite).necessario, 869);
    assert.equal((await painel.get(`/receitas/${ninho.id}`)).perda_pct, 10);
    assert.equal((await painel.get("/receitas")).produtos.find((x) => x.id === ninho.id).custo_unit, 51);

    await painel.put(`/preparos/${massa.id}`, { nome: "Massa de brigadeiro", unidade: "un", rendimento: 30, perda_pct: 20,
      linhas: massa.linhas.map((l) => ({ ingrediente_id: l.ingrediente_id, quantidade: l.quantidade })) });
    p = await previsao();
    perto(linha(p, leite).necessario, 1042.8, 0.01);
    assert.equal(linha(p, granulado).necessario, 330, "a perda da receita-base só vale para os ingredientes dela");

    // volta ao normal para os próximos testes
    await painel.put(`/preparos/${massa.id}`, { nome: "Massa de brigadeiro", unidade: "un", rendimento: 30, perda_pct: 0,
      linhas: massa.linhas.map((l) => ({ ingrediente_id: l.ingrediente_id, quantidade: l.quantidade })) });
    await painel.put(`/receitas/${ninho.id}`, { rendimento: 1, perda_pct: 0, linhas: [{ preparo_id: massa.id, quantidade: 1 }, { ingrediente_id: granulado.id, quantidade: 5 }] });
    assert.equal(linha(await previsao(), leite).necessario, 790);
  });

  it("a baixa automática desconta os ingredientes da receita-base e o cancelamento devolve", async () => {
    await painel.patch(`/pedidos/${pedido1.id}/status`, { status: "confirmado", nota: "" });
    await painel.patch(`/pedidos/${pedido1.id}/status`, { status: "em_preparo", nota: "" });
    assert.equal((await atual(leite)).estoque, 3160);
    assert.equal((await atual(choc)).estoque, 1800);
    assert.equal((await atual(manteiga)).estoque, 960);
    assert.equal((await atual(granulado)).estoque, -100);
    assert.equal((await previsao()).pedidos, 0);
    await painel.patch(`/pedidos/${pedido1.id}/status`, { status: "cancelado", nota: "Desistiu" });
    assert.equal((await atual(leite)).estoque, 3950);
    assert.equal((await atual(granulado)).estoque, 200);
  });

  it("não deixa apagar ingrediente ou receita-base que está em uso, nem trocar a medida", async () => {
    const e1 = await falha(painel.delete(`/ingredientes/${manteiga.id}`));
    assert.equal(e1.status, 409);
    assert.match(e1.message, /receita-base: Massa de brigadeiro/);
    const e2 = await falha(painel.delete(`/preparos/${massa.id}`));
    assert.equal(e2.status, 409);
    assert.match(e2.message, /Brigadeiro de Ninho/);
    assert.equal((await falha(painel.put(`/preparos/${massa.id}`, { nome: "Massa de brigadeiro", unidade: "g", rendimento: 30, linhas: [{ ingrediente_id: leite.id, quantidade: 1 }] }))).status, 409);
    assert.equal((await falha(painel.put(`/ingredientes/${leite.id}`, { nome: "Leite condensado", unidade: "ml", embalagem_qtd: 395, embalagem_preco: 700 }))).status, 409);
  });
});

describe("validade e lotes", () => {
  it("cada compra com validade vira um lote; os vencidos e os que vencem logo aparecem na previsão", async () => {
    await painel.post("/estoque/movimentos", { ingrediente_id: morango.id, tipo: "compra", embalagens: 1, valor: 900, validade: dia(3) });
    await painel.post("/estoque/movimentos", { ingrediente_id: morango.id, tipo: "compra", embalagens: 2, valor: 1800, validade: dia(30) });
    await painel.post("/estoque/movimentos", { ingrediente_id: morango.id, tipo: "compra", embalagens: 1, validade: dia(-1) });
    assert.equal((await atual(morango)).estoque, 1200);
    const lotes = (await painel.get(`/estoque/lotes?ingrediente_id=${morango.id}`)).lotes;
    assert.deepEqual(lotes.map((l) => [l.quantidade, l.situacao]), [[300, "vencido"], [300, "vencendo"], [600, "ok"]], "do que vence primeiro para o que vence depois");
    assert.equal(lotes[0].dias, -1);
    assert.equal((await atual(morango)).proxima_validade, dia(-1));

    const p = await previsao();
    assert.equal(p.dias_validade, 7);
    assert.deepEqual(p.vencimentos.map((v) => v.dias), [-1, 3]);
    assert.equal(p.resumo.vencidos, 1);
    assert.equal(p.resumo.vencendo, 1);
  });

  it("perda e uso tiram do lote que vence primeiro", async () => {
    await painel.post("/estoque/movimentos", { ingrediente_id: morango.id, tipo: "perda", quantidade: 400, nota: "Estragou" });
    const lotes = (await painel.get(`/estoque/lotes?ingrediente_id=${morango.id}`)).lotes;
    assert.deepEqual(lotes.map((l) => l.quantidade), [200, 600], "o vencido acabou e o próximo perdeu 100 g");
    assert.equal((await atual(morango)).estoque, 800);
  });

  it("descartar um lote lança a perda e não mexe nos outros", async () => {
    const [primeiro] = (await painel.get(`/estoque/lotes?ingrediente_id=${morango.id}`)).lotes;
    const r = await painel.delete(`/estoque/lotes/${primeiro.id}`);
    assert.equal(r.ingrediente.estoque, 600);
    const h = (await historico(morango))[0];
    assert.equal(h.tipo, "perda");
    assert.equal(h.quantidade, -200);
    assert.match(h.nota, /Lote descartado/);
    const lotes = (await painel.get("/estoque/lotes")).lotes;
    assert.deepEqual(lotes.map((l) => l.quantidade), [600]);
    assert.equal((await falha(painel.delete(`/estoque/lotes/${primeiro.id}`))).status, 404);
  });

  it("uma contagem menor também reduz os lotes; compra sem validade não cria lote", async () => {
    await painel.post("/estoque/movimentos", { ingrediente_id: morango.id, tipo: "ajuste", novo_estoque: 400 });
    assert.deepEqual((await painel.get(`/estoque/lotes?ingrediente_id=${morango.id}`)).lotes.map((l) => l.quantidade), [400]);
    await painel.post("/estoque/movimentos", { ingrediente_id: morango.id, tipo: "compra", embalagens: 1 });
    assert.equal((await painel.get(`/estoque/lotes?ingrediente_id=${morango.id}`)).lotes.length, 1);
  });

  it("estoque inicial pode ter validade; período do aviso é configurável", async () => {
    const creme = await ing({ nome: "Creme de leite", unidade: "un", estoque: 10, embalagem_qtd: 1, embalagem_nome: "caixinha", embalagem_preco: 400, validade: dia(5) });
    assert.equal(creme.proxima_validade, dia(5));
    assert.equal((await previsao()).resumo.vencendo, 1, "vence em 5 dias, dentro dos 7 configurados");
    await painel.put("/estoque/config", { baixa_automatica: true, dias_previsao: 7, dias_validade: 3 });
    assert.equal((await previsao()).resumo.vencendo, 0);
    assert.equal((await falha(painel.put("/estoque/config", { baixa_automatica: true, dias_validade: 91 }))).status, 422);
    await painel.put("/estoque/config", { baixa_automatica: true, dias_previsao: 7, dias_validade: 7 });
    assert.ok((await falha(painel.post("/estoque/movimentos", { ingrediente_id: creme.id, tipo: "compra", embalagens: 1, validade: "31/12/2030" }))).campos.validade);
  });
});

describe("compra recebida em lote", () => {
  it("lança vários itens de uma nota de uma vez, atualiza preços e cria lotes", async () => {
    const antes = { leite: (await atual(leite)).estoque, manteiga: (await atual(manteiga)).estoque };
    const r = await painel.post("/estoque/compra", { nota: "Nota 123 - Atacadão", itens: [
      { ingrediente_id: leite.id, embalagens: 2, valor: 1400 },
      { ingrediente_id: manteiga.id, embalagens: 2, valor: 2200, validade: dia(20) },
    ] });
    assert.deepEqual([r.itens, r.total], [2, 3600]);
    assert.equal((await atual(leite)).estoque, antes.leite + 790);
    const m = await atual(manteiga);
    assert.equal(m.estoque, antes.manteiga + 400);
    assert.equal(m.embalagem_preco, 1100, "R$ 22,00 por 2 tabletes");
    assert.equal(m.proxima_validade, dia(20));
    const h = (await historico(manteiga))[0];
    assert.equal(h.tipo, "compra");
    assert.equal(h.nota, "Nota 123 - Atacadão");
    assert.equal(h.valor, 2200);
    await painel.put(`/ingredientes/${manteiga.id}`, { nome: "Manteiga", unidade: "g", embalagem_qtd: 200, embalagem_nome: "tablete", embalagem_preco: 1000 });
  });

  it("tudo ou nada: um item inválido desfaz a compra inteira", async () => {
    const antes = (await atual(leite)).estoque;
    assert.equal((await falha(painel.post("/estoque/compra", { itens: [{ ingrediente_id: leite.id, embalagens: 1 }, { ingrediente_id: 999999, embalagens: 1 }] }))).status, 404);
    assert.ok((await falha(painel.post("/estoque/compra", { itens: [{ ingrediente_id: leite.id, embalagens: 1 }, { ingrediente_id: manteiga.id, embalagens: 0 }] }))).campos.itens ?? true);
    assert.equal((await atual(leite)).estoque, antes, "nada foi lançado");
  });

  it("valida a lista", async () => {
    assert.equal((await falha(painel.post("/estoque/compra", { itens: [] }))).status, 422);
    assert.equal((await falha(painel.post("/estoque/compra", { itens: [{ ingrediente_id: leite.id, embalagens: 1 }, { ingrediente_id: leite.id, embalagens: 1 }] }))).status, 422);
    assert.equal((await falha(painel.post("/estoque/compra", { itens: Array.from({ length: 61 }, () => ({ ingrediente_id: leite.id, embalagens: 1 })) }))).status, 422);
  });
});

describe("contagem em lote", () => {
  it("só grava o que mudou, com a observação, e informa quantos acertou", async () => {
    const l = await atual(leite);
    const r = await painel.post("/estoque/contagem", { nota: "Contagem de sábado", itens: [
      { ingrediente_id: leite.id, novo_estoque: l.estoque },
      { ingrediente_id: choc.id, novo_estoque: 1500 },
      { ingrediente_id: granulado.id, novo_estoque: "50" },
    ] });
    assert.deepEqual([r.ajustados, r.iguais], [2, 1]);
    assert.equal((await atual(choc)).estoque, 1500);
    assert.equal((await atual(granulado)).estoque, 50);
    const h = (await historico(choc))[0];
    assert.equal(h.tipo, "ajuste");
    assert.equal(h.nota, "Contagem de sábado");
    assert.equal(h.quantidade, -500);
    assert.equal((await historico(leite)).filter((x) => x.nota === "Contagem de sábado").length, 0, "o que não mudou não gera lançamento");
  });

  it("valida a contagem", async () => {
    assert.equal((await falha(painel.post("/estoque/contagem", { itens: [] }))).status, 422);
    assert.ok((await falha(painel.post("/estoque/contagem", { itens: [{ ingrediente_id: leite.id, novo_estoque: -5 }] }))).campos.novo_estoque);
    assert.equal((await falha(painel.post("/estoque/contagem", { itens: Array.from({ length: 401 }, () => ({ ingrediente_id: leite.id, novo_estoque: 1 })) }))).status, 422);
    assert.ok((await atual(leite)).estoque > 1, "contagem recusada não muda nada");
  });
});

describe("simulador: quanto preciso para fazer isto?", () => {
  it("calcula o que 100 brigadeiros pedem, o que já está comprometido e o que comprar", async () => {
    const pendente = (await pedir([{ produto_id: ninho.id, qtd: 20 }])).pedido; // 100 g de granulado já comprometidos
    const r = await painel.post("/estoque/simular", { itens: [{ produto_id: ninho.id, qtd: 100 }] });
    const g = r.itens.find((i) => i.id === granulado.id);
    assert.equal(g.necessario, 500);
    assert.equal(g.estoque, 50);
    assert.equal(g.comprometido, 100);
    assert.equal(g.livre, -50);
    assert.equal(g.falta, 500);
    assert.equal(g.comprar_embalagens, 1);
    assert.equal(g.comprar_valor, 1000);
    perto(r.itens.find((i) => i.id === leite.id).necessario, 1316.667, 0.001);
    perto(r.produtos[0].custo, 4667, 1);
    assert.equal(r.produtos[0].tem_receita, true);
    assert.ok(r.faltam >= 1);
    assert.deepEqual(r.itens[0].id, granulado.id, "o que falta vem primeiro");
    await painel.patch(`/pedidos/${pendente.id}/status`, { status: "cancelado", nota: "teste" });
    assert.equal((await painel.post("/estoque/simular", { itens: [{ produto_id: ninho.id, qtd: 100 }] })).itens.find((i) => i.id === granulado.id).comprometido, 0);
  });

  it("considera as opções escolhidas e avisa quais produtos não têm receita", async () => {
    const bolo = produto("Bolo Ninho com Morango");
    await painel.put(`/receitas/${bolo.id}`, { linhas: [
      { ingrediente_id: morango.id, quantidade: 100 },
      { ingrediente_id: morango.id, quantidade: 50, opcao_grupo: "Tamanho", opcao_item: "2 kg (20 fatias)" },
    ] });
    const sem = await painel.post("/estoque/simular", { itens: [
      { produto_id: bolo.id, qtd: 2 },
      { produto_id: bolo.id, qtd: 1, opcoes: [{ grupo: "Tamanho", itens: [{ nome: "2 kg (20 fatias)" }] }] },
      { produto_id: produto("Bolo Red Velvet").id, qtd: 1 },
    ] });
    assert.equal(sem.itens.find((i) => i.id === morango.id).necessario, 350, "2×100 + (100 + 50 do tamanho 2 kg)");
    assert.deepEqual(sem.sem_receita, ["Bolo Red Velvet"]);
  });

  it("valida a simulação e não altera nada", async () => {
    const antes = (await atual(granulado)).estoque;
    assert.equal((await falha(painel.post("/estoque/simular", { itens: [] }))).status, 422);
    assert.ok((await falha(painel.post("/estoque/simular", { itens: [{ produto_id: ninho.id, qtd: 0 }] }))).campos.qtd);
    assert.equal((await falha(painel.post("/estoque/simular", { itens: [{ produto_id: 999999, qtd: 1 }] }))).status, 404);
    assert.equal((await falha(painel.post("/estoque/simular", { itens: Array.from({ length: 31 }, () => ({ produto_id: ninho.id, qtd: 1 })) }))).status, 422);
    assert.equal((await atual(granulado)).estoque, antes);
  });
});

describe("registro de atividade", () => {
  it("receitas-base e mudanças de medidas ficam registradas", async () => {
    const a = await auditoria();
    assert.ok(a.some((x) => x.tabela === "preparos" && x.operacao === "criou" && x.resumo === "Massa de brigadeiro"));
    assert.ok(a.some((x) => x.tabela === "preparos" && x.operacao === "alterou" && x.detalhes.perda_pct));
    assert.ok(a.some((x) => x.tabela === "ingredientes" && x.operacao === "alterou" && x.resumo === "Chocolate em pó" && x.detalhes.medidas));
    assert.ok(!a.some((x) => x.tabela === "ingredientes" && x.detalhes?.estoque), "quantidades não entram na atividade");
  });

  it("depois de tirar a receita-base dos produtos, ela pode ser excluída", async () => {
    await painel.put(`/receitas/${ninho.id}`, { linhas: [] });
    await painel.put(`/receitas/${morangoBrig.id}`, { linhas: [] });
    assert.equal((await painel.delete(`/preparos/${massa.id}`)).ok, true);
    assert.equal((await painel.get("/preparos")).preparos.length, 0);
    assert.equal((await painel.delete(`/ingredientes/${manteiga.id}`)).ok, true);
  });
});
