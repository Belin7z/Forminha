/* ==========================================================
   PEDIDOS AVANÇADOS — pedido lançado pela equipe, sinal,
   pagamentos recebidos, cupom de frete grátis e planilhas.
   Preço, sinal e total são sempre calculados no banco.
   ========================================================== */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { iniciarEmulador } from "./emulador/servidor.js";
import { criarApiLoja } from "../../../Loja/src/scripts/base/api/loja.js";
import { criarApiPainel } from "../../src/scripts/base/api/painel.js";
import { gerarHorarios, dataISO } from "../../../Loja/src/scripts/base/agendamento.js";

let emu, painel, visitante, cliente, doCliente, usuario, bolo, quando, enderecoId;
const novoCliente = () => createClient(emu.url, emu.chaveAnon, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
async function falha(promessa) { try { await promessa; } catch (e) { return e; } assert.fail("era esperado um erro"); }
const ITEM_BOLO = () => ({ produto_id: bolo.id, qtd: 1, opcoes: { g1: ["g1i1"] } });

function proximaData(cfg) {
  const minimo = new Date(Date.now() + 96 * 3600_000);
  for (let i = 0; i < 30; i++) {
    const d = new Date(minimo.getFullYear(), minimo.getMonth(), minimo.getDate() + i);
    const horas = gerarHorarios(cfg.horarios, dataISO(d), minimo, cfg.pedidos.intervalo_min);
    if (horas.length) return { data: dataISO(d), hora: horas[0] };
  }
  throw new Error("sem data disponível");
}
const pedirComoCliente = (extra = {}) => cliente.post("/pedidos", { itens: [ITEM_BOLO()], tipo: "retirada", ...quando, pagamento: "dinheiro", ...extra });
const orcar = (extra = {}) => cliente.post("/pedidos/orcamento", { itens: [ITEM_BOLO()], tipo: "retirada", ...quando, pagamento: "dinheiro", ...extra });

before(async () => {
  emu = await iniciarEmulador();
  const admin = await emu.criarAdmin("dona@teste.local", "Admin12345");
  painel = criarApiPainel(novoCliente());
  await painel.post("/auth/entrar", { email: admin.email, senha: admin.senha });
  visitante = criarApiLoja(novoCliente());
  cliente = criarApiLoja(novoCliente());
  await cliente.post("/auth/cadastro", { nome: "Cliente Avancado", email: "avancado@teste.com", telefone: "11999998888", senha: "Senha1234" });
  usuario = (await cliente.get("/auth/eu")).usuario;
  doCliente = criarApiPainel(cliente.supabase);
  await painel.put("/configuracoes/pagamento", { pix_ativo: true, pix_chave: "loja@exemplo.com", pix_nome: "Doceria Exemplo", pix_cidade: "Sao Paulo", dinheiro_ativo: true, cartao_ativo: true });
  bolo = (await visitante.get("/catalogo")).produtos.find((p) => p.nome === "Bolo Ninho com Morango");
  quando = proximaData(await visitante.get("/config"));
  const e = await cliente.post("/enderecos", { apelido: "Casa", cep: "01001-000", rua: "Praça da Sé", numero: "10", complemento: "", bairro: "Sé", cidade: "São Paulo", uf: "SP", referencia: "", lat: -23.552, lng: -46.634, principal: true });
  enderecoId = e.enderecos[0].id;
});
after(async () => { await emu?.fechar(); });

describe("pedido lançado pela equipe", () => {
  let criado;
  it("cliente sem conta: item do cardápio + item avulso, entrega com taxa e desconto combinados", async () => {
    const r = await painel.post("/pedidos", {
      nome: "Dona Marta", telefone: "(11) 98888-7777", tipo: "entrega", endereco: "Rua das Flores, 45 - Centro", taxa_entrega: 1500, desconto: 500,
      ...quando, pagamento: "pix", sinal: 5000, observacoes: "Cliente do WhatsApp",
      itens: [ITEM_BOLO(), { nome: "Topo de bolo personalizado", preco: 3000, qtd: 2 }],
    });
    criado = r.pedido;
    assert.match(criado.codigo, /^LA\d+$/);
    assert.equal(criado.origem, "manual");
    assert.equal(criado.status, "confirmado");
    assert.equal(criado.cliente.telefone, "11988887777");
    assert.equal(criado.cliente.id, null, "sem conta na loja");
    assert.equal(criado.endereco.rua, "Rua das Flores, 45 - Centro");
    assert.equal(criado.itens.length, 2);
    assert.equal(criado.itens[1].produto_id, null);
    assert.equal(criado.itens[1].total, 6000);
    assert.equal(criado.subtotal, criado.itens[0].total + 6000);
    assert.equal(criado.total, criado.subtotal + 1500 - 500, "o total é calculado pelo banco");
    assert.equal(criado.sinal, 5000);
    assert.equal(criado.pagamento_situacao, "aguardando_sinal");
  });

  it("aparece na lista de pedidos e na produção do dia", async () => {
    const lista = await painel.get("/pedidos?busca=Marta");
    assert.ok(lista.itens.some((p) => p.codigo === criado.codigo));
    const prod = await painel.get(`/producao?data=${quando.data}`);
    assert.ok(prod.itens.some((i) => i.nome === "Topo de bolo personalizado" && Number(i.qtd) === 2));
  });

  it("para cliente com conta, o pedido aparece em 'Meus pedidos' dele", async () => {
    const r = await painel.post("/pedidos", { cliente_id: usuario.id, tipo: "retirada", ...quando, pagamento: "dinheiro", status: "novo", itens: [ITEM_BOLO()] });
    assert.equal(r.pedido.cliente.nome, "Cliente Avancado");
    assert.equal(r.pedido.status, "novo");
    const meus = (await cliente.get("/pedidos")).pedidos;
    assert.ok(meus.some((p) => p.codigo === r.pedido.codigo));
    assert.equal((await cliente.get(`/pedidos/${r.pedido.codigo}`)).pedido.origem, "manual");
  });

  it("valida os dados e não deixa nem cliente nem visitante lançar pedidos", async () => {
    const base = { nome: "Fulano", telefone: "11977776666", tipo: "retirada", ...quando, pagamento: "dinheiro", itens: [ITEM_BOLO()] };
    assert.equal((await falha(painel.post("/pedidos", { ...base, itens: [] }))).status, 422);
    assert.ok((await falha(painel.post("/pedidos", { ...base, hora: "25:99" }))).campos.hora);
    assert.equal((await falha(painel.post("/pedidos", { ...base, tipo: "entrega", endereco: "abc" }))).status, 422);
    assert.ok((await falha(painel.post("/pedidos", { ...base, desconto: 99999999 }))).campos.desconto);
    assert.equal((await falha(painel.post("/pedidos", { ...base, itens: [{ produto_id: 999999, qtd: 1 }] }))).status, 422);
    assert.equal((await falha(painel.post("/pedidos", { ...base, itens: [{ produto_id: bolo.id, qtd: 1 }] }))).status, 422, "opção obrigatória do bolo");
    assert.equal((await falha(painel.post("/pedidos", { ...base, itens: [{ nome: "x", preco: 100, qtd: 1 }] }))).status, 422, "nome muito curto");
    assert.equal((await falha(painel.post("/pedidos", { ...base, nome: "A" }))).status, 422);
    assert.equal((await falha(painel.post("/pedidos", { ...base, sinal: 99999999 }))).status, 422, "sinal maior que o total");
    assert.equal((await falha(painel.post("/pedidos", { ...base, nome: undefined, cliente_id: "00000000-0000-0000-0000-000000000000" }))).status, 404);
    assert.equal((await falha(doCliente.post("/pedidos", base))).status, 403);
    assert.equal((await falha(criarApiPainel(visitante.supabase).post("/pedidos", base))).status, 401);
  });
});

describe("sinal e pagamentos recebidos", () => {
  let pedido;
  it("sem regra configurada, não há sinal; configurar exige valores válidos e é só do administrador", async () => {
    assert.equal((await pedirComoCliente()).pedido.sinal, 0);
    assert.equal((await falha(painel.put("/configuracoes/sinal", { percentual: 101, acima_de: 0 }))).status, 422);
    assert.equal((await falha(doCliente.put("/configuracoes/sinal", { percentual: 50, acima_de: 0 }))).status, 403);
    await painel.put("/configuracoes/sinal", { percentual: 50, acima_de: 0 });
    assert.deepEqual((await visitante.get("/config")).sinal, { percentual: 50, acima_de: 0 });
  });

  it("o orçamento e o pedido do cliente já trazem o sinal calculado pelo banco", async () => {
    const o = await orcar();
    assert.equal(o.sinal, Math.round(o.total * 0.5));
    pedido = (await pedirComoCliente()).pedido;
    assert.equal(pedido.sinal, o.sinal);
    assert.equal(pedido.pagamento_situacao, "aguardando_sinal");
    assert.equal(pedido.pix.motivo, "sinal", "mesmo pagando em dinheiro, o sinal vai por PIX");
    assert.equal(pedido.pix.valor, pedido.sinal);
  });

  it("valor mínimo e PIX desligado desativam o sinal", async () => {
    await painel.put("/configuracoes/sinal", { percentual: 50, acima_de: 100000 });
    assert.equal((await orcar()).sinal, 0, "pedido abaixo do valor mínimo");
    await painel.put("/configuracoes/sinal", { percentual: 50, acima_de: 0 });
    await painel.put("/configuracoes/pagamento", { pix_ativo: false, pix_chave: "loja@exemplo.com", pix_nome: "L", pix_cidade: "SP", dinheiro_ativo: true, cartao_ativo: true });
    assert.equal((await orcar()).sinal, 0, "sem PIX não há como pagar o sinal");
    await painel.put("/configuracoes/pagamento", { pix_ativo: true, pix_chave: "loja@exemplo.com", pix_nome: "Doceria Exemplo", pix_cidade: "Sao Paulo", dinheiro_ativo: true, cartao_ativo: true });
    assert.equal((await orcar()).sinal > 0, true);
  });

  it("a equipe registra o sinal e depois o restante; o PIX passa a cobrar só o que falta", async () => {
    let r = (await painel.post(`/pedidos/${pedido.id}/pagamentos`, { valor: pedido.sinal, forma: "pix" })).pedido;
    assert.equal(r.pago, pedido.sinal);
    assert.equal(r.pagamento_situacao, "sinal_pago");
    assert.equal(r.saldo, pedido.total - pedido.sinal);
    assert.equal(r.pix, undefined, "pagou o sinal e o resto é em dinheiro: sem cobrança por PIX");
    assert.equal(r.pagamentos[0].forma_texto, "PIX");

    const e = await falha(painel.post(`/pedidos/${pedido.id}/pagamentos`, { valor: r.saldo + 1, forma: "dinheiro" }));
    assert.equal(e.status, 422);
    assert.ok(e.campos.valor);
    assert.equal((await falha(painel.post(`/pedidos/${pedido.id}/pagamentos`, { valor: 0, forma: "pix" }))).status, 422);
    assert.equal((await falha(painel.post(`/pedidos/${pedido.id}/pagamentos`, { valor: 100, forma: "cheque" }))).status, 422);

    r = (await painel.post(`/pedidos/${pedido.id}/pagamentos`, { valor: r.saldo, forma: "dinheiro" })).pedido;
    assert.equal(r.pagamento_situacao, "pago");
    assert.equal(r.saldo, 0);

    const ultimo = r.pagamentos.at(-1);
    r = (await painel.delete(`/pagamentos/${ultimo.id}`)).pedido;
    assert.equal(r.pagamento_situacao, "sinal_pago", "estornar volta ao estado anterior");
    assert.equal(r.pago, pedido.sinal);
  });

  it("o cliente vê os pagamentos no próprio pedido, mas não registra nem apaga", async () => {
    const meu = (await cliente.get(`/pedidos/${pedido.codigo}`)).pedido;
    assert.equal(meu.pagamentos.length, 1);
    assert.equal((await falha(doCliente.post(`/pedidos/${pedido.id}/pagamentos`, { valor: 100, forma: "pix" }))).status, 403);
    assert.equal((await falha(doCliente.delete(`/pagamentos/${meu.pagamentos[0].id}`))).status, 403);
  });

  it("pedido cancelado não recebe pagamento", async () => {
    const novo = (await pedirComoCliente()).pedido;
    await cliente.post(`/pedidos/${novo.codigo}/cancelar`, { motivo: "teste" });
    assert.equal((await falha(painel.post(`/pedidos/${novo.id}/pagamentos`, { valor: 100, forma: "pix" }))).status, 409);
  });
});

describe("cupom de frete grátis", () => {
  it("zera só a taxa de entrega; em retirada é recusado", async () => {
    await painel.post("/cupons", { codigo: "FRETEGRATIS", descricao: "Frete por nossa conta", tipo: "frete", minimo: 0, ativo: true });
    const lista = (await painel.get("/cupons")).cupons;
    assert.equal(lista.find((c) => c.codigo === "FRETEGRATIS").tipo, "frete");

    const sem = await orcar({ tipo: "entrega", endereco_id: enderecoId });
    assert.ok(sem.taxa_entrega > 0, "o endereço de teste paga taxa de entrega");
    const com = await orcar({ tipo: "entrega", endereco_id: enderecoId, cupom: "fretegratis" });
    assert.deepEqual(com.problemas, []);
    assert.equal(com.desconto, sem.taxa_entrega);
    assert.equal(com.total, sem.subtotal, "cliente paga só os doces");
    assert.equal(com.cupom, "FRETEGRATIS");

    const retirada = await orcar({ cupom: "FRETEGRATIS" });
    assert.ok(retirada.problemas.some((x) => x.campo === "cupom"));
  });

  it("ao finalizar, o pedido guarda o desconto e o cupom conta como usado (e volta se cancelar)", async () => {
    const usos = async () => (await painel.get("/cupons")).cupons.find((c) => c.codigo === "FRETEGRATIS").usos;
    const antes = await usos();
    const r = (await pedirComoCliente({ tipo: "entrega", endereco_id: enderecoId, cupom: "FRETEGRATIS" })).pedido;
    assert.equal(r.total, r.subtotal);
    assert.equal(r.desconto, r.taxa_entrega);
    assert.equal(await usos(), antes + 1);
    await cliente.post(`/pedidos/${r.codigo}/cancelar`, { motivo: "teste" });
    assert.equal(await usos(), antes);
  });

  it("valor não é exigido para frete grátis, mas continua obrigatório nos outros tipos", async () => {
    assert.equal((await falha(painel.post("/cupons", { codigo: "SEMVALOR", descricao: "", tipo: "valor", minimo: 0, ativo: true }))).status, 422);
    assert.equal((await falha(painel.post("/cupons", { codigo: "TIPOX", descricao: "", tipo: "estranho", valor: 5, minimo: 0, ativo: true }))).status, 422);
  });
});

describe("exportações para planilha", () => {
  it("pedidos do período (com origem, itens e pagamentos) e clientes — só administrador", async () => {
    const r = await painel.get(`/exportar/pedidos?de=${quando.data}&ate=${quando.data}`);
    assert.equal(r.de, quando.data);
    const manual = r.linhas.find((l) => l.origem === "manual" && l.cliente === "Dona Marta");
    assert.ok(manual, "o pedido lançado pela equipe aparece");
    assert.match(manual.itens, /2x Topo de bolo personalizado/);
    assert.equal(manual.pagamento, "PIX");
    assert.ok(r.linhas.every((l) => l.data === quando.data), "respeita o período");

    const clientes = await painel.get("/exportar/clientes");
    assert.ok(clientes.linhas.some((c) => c.email === "avancado@teste.com" && c.pedidos >= 1));

    assert.equal((await falha(doCliente.get("/exportar/pedidos"))).status, 403);
    assert.equal((await falha(doCliente.get("/exportar/clientes"))).status, 403);
  });
});
