/* ==========================================================
   ENCOMENDA POR ORÇAMENTO — o cliente pede (com fotos de
   referência), a loja responde (valor, sinal, data, horário) ou
   recusa, e o cliente aceita: vira um pedido confirmado. As regras
   valem no banco: dono do orçamento, validade da proposta, formas
   de pagamento da loja, liga/desliga.
   ========================================================== */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { iniciarEmulador } from "./emulador/servidor.js";
import { criarApiLoja } from "../../../Loja/src/scripts/base/api/loja.js";
import { criarApiPainel } from "../../src/scripts/base/api/painel.js";
import { dataISO } from "../../../Loja/src/scripts/base/agendamento.js";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
let emu, painel, visitante, cliente, outro, enderecoId;
const novoCliente = () => createClient(emu.url, emu.chaveAnon, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
async function falha(promessa) { try { await promessa; } catch (e) { return e; } assert.fail("era esperado um erro"); }
const daqui = (dias) => { const d = new Date(); d.setDate(d.getDate() + dias); return dataISO(d); };
const PEDIDO = { descricao: "Bolo de 2 andares, tema jardim, massa branca com ninho e morango.", quantidade: "40 pessoas", verba: "até R$ 300", data_desejada: daqui(20), tipo: "retirada" };
const RESPOSTA = { titulo: "Bolo jardim 2 andares", valor: 25000, sinal: 10000, data: daqui(20), hora: "15:00", mensagem: "Inclui topo de papel.", validade_dias: 7 };

before(async () => {
  emu = await iniciarEmulador();
  const admin = await emu.criarAdmin("dona@teste.local", "Admin12345");
  painel = criarApiPainel(novoCliente());
  await painel.post("/auth/entrar", { email: admin.email, senha: admin.senha });
  visitante = criarApiLoja(novoCliente());
  cliente = criarApiLoja(novoCliente());
  await cliente.post("/auth/cadastro", { nome: "Cliente Orçamento", email: "orc@teste.com", telefone: "11999998888", senha: "Senha1234" });
  outro = criarApiLoja(novoCliente());
  await outro.post("/auth/cadastro", { nome: "Outra Pessoa", email: "outra@teste.com", telefone: "11977776666", senha: "Senha1234" });
  const r = await cliente.post("/enderecos", { apelido: "Casa", cep: "01310100", rua: "Av. Paulista", numero: "1000", complemento: "", bairro: "Bela Vista",
    cidade: "São Paulo", uf: "SP", referencia: "", lat: -23.5614, lng: -46.6559, principal: true });
  enderecoId = r.enderecos[0].id;
});
after(async () => { await emu?.fechar(); });

describe("orçamento: o pedido do cliente", () => {
  let id;
  it("a loja recebe orçamentos (ligado se nunca mexeram) e só cliente com conta pede", async () => {
    assert.deepEqual((await visitante.get("/config")).orcamento, { ativo: true, texto: "" });
    assert.equal((await falha(visitante.post("/orcamentos", PEDIDO))).status, 401);
  });

  it("pede com foto de referência e acompanha em Minha conta (sem as fotos na lista)", async () => {
    const r = await cliente.post("/orcamentos", { ...PEDIDO, fotos: [PNG] });
    id = r.orcamento.id;
    assert.equal(r.orcamento.status, "novo");
    const { orcamentos } = await cliente.get("/orcamentos");
    assert.equal(orcamentos.length, 1);
    assert.deepEqual([orcamentos[0].n_fotos, orcamentos[0].fotos], [1, []]);
    assert.equal((await outro.get("/orcamentos")).orcamentos.length, 0, "cada um vê só os seus");
  });

  it("valida no banco", async () => {
    const ruim = async (extra, campo) => { const e = await falha(cliente.post("/orcamentos", { ...PEDIDO, ...extra })); assert.equal(e.status, 422, campo); if (campo) assert.ok(e.campos?.[campo], campo); };
    await ruim({ descricao: "bolo" }, "descricao");
    await ruim({ data_desejada: daqui(-1) }, "data_desejada");
    await ruim({ tipo: "entrega" }, "endereco_id");
    await ruim({ tipo: "voando" }, "tipo");
    await ruim({ fotos: ["javascript:alert(1)"] }, "fotos");
    await ruim({ fotos: [PNG, PNG, PNG, PNG] }, "fotos");
  });

  it("a dona vê no painel: contagem do menu, lista e o pedido com as fotos", async () => {
    assert.equal((await painel.get("/pedidos/contagem")).orcamentos, 1);
    const lista = await painel.get("/orcamentos?status=novo");
    assert.equal(lista.orcamentos[0].id, id);
    assert.equal(lista.contagem.novo, 1);
    const { orcamento } = await painel.get(`/orcamentos/${id}`);
    assert.deepEqual(orcamento.fotos, [PNG]);
    assert.equal(orcamento.cliente.nome, "Cliente Orçamento");
    assert.equal((await falha(criarApiPainel(cliente.supabase).get("/orcamentos"))).status, 403, "cliente não abre o painel");
  });

  it("a resposta é conferida (horário, sinal, valor)", async () => {
    for (const [extra, campo] of [[{ hora: "25:00" }, "hora"], [{ sinal: 30000 }, "sinal"], [{ valor: 0 }, "valor"], [{ data: daqui(-2) }, "data"]]) {
      const e = await falha(painel.post(`/orcamentos/${id}/responder`, { ...RESPOSTA, ...extra }));
      assert.equal(e.status, 422, campo);
    }
  });

  it("respondido: o cliente vê a proposta; aceitando, vira pedido confirmado com o sinal combinado", async () => {
    const { orcamento } = await painel.post(`/orcamentos/${id}/responder`, RESPOSTA);
    assert.equal(orcamento.status, "respondido");
    assert.equal(orcamento.resposta.total, 25000);
    assert.equal((await painel.get("/pedidos/contagem")).orcamentos, 0, "saiu dos novos");
    const doCliente = (await cliente.get("/orcamentos")).orcamentos[0];
    assert.deepEqual([doCliente.resposta.valor, doCliente.resposta.sinal, doCliente.resposta.hora], [25000, 10000, "15:00"]);

    assert.equal((await falha(outro.post(`/orcamentos/${id}/aceitar`, { pagamento: "dinheiro" }))).status, 404, "só o dono aceita");
    assert.equal((await falha(cliente.post(`/orcamentos/${id}/aceitar`, { pagamento: "boleto" }))).status, 422);

    const { pedido } = await cliente.post(`/orcamentos/${id}/aceitar`, { pagamento: "dinheiro" });
    const completo = await cliente.get(`/pedidos/${pedido.codigo}`);
    const p = completo.pedido ?? completo;
    assert.deepEqual([p.status, p.total, p.sinal, p.hora, p.origem], ["confirmado", 25000, 10000, "15:00", "orcamento"]);
    assert.equal(p.itens[0].nome, "Bolo jardim 2 andares");
    const depois = (await cliente.get("/orcamentos")).orcamentos[0];
    assert.deepEqual([depois.status, depois.pedido.codigo], ["aceito", pedido.codigo]);
    assert.equal((await falha(cliente.post(`/orcamentos/${id}/aceitar`, { pagamento: "dinheiro" }))).status, 409, "não aceita duas vezes");
  });
});

describe("orçamento: cancelar, recusar, vencer e desligar", () => {
  it("o cliente cancela enquanto está aberto", async () => {
    const { orcamento } = await cliente.post("/orcamentos", PEDIDO);
    assert.equal((await cliente.post(`/orcamentos/${orcamento.id}/cancelar`)).orcamento.status, "cancelado");
    assert.equal((await falha(cliente.post(`/orcamentos/${orcamento.id}/cancelar`))).status, 409);
    assert.equal((await falha(painel.post(`/orcamentos/${orcamento.id}/responder`, RESPOSTA))).status, 409, "cancelado não recebe proposta");
  });

  it("a loja recusa com um recado; recusado não vira pedido", async () => {
    const { orcamento } = await cliente.post("/orcamentos", { ...PEDIDO, tipo: "entrega", endereco_id: enderecoId });
    assert.equal(orcamento.endereco.rua, "Av. Paulista");
    const r = await painel.post(`/orcamentos/${orcamento.id}/recusar`, { mensagem: "Agenda cheia nessa data." });
    assert.deepEqual([r.orcamento.status, r.orcamento.resposta.mensagem], ["recusado", "Agenda cheia nessa data."]);
    assert.equal((await falha(cliente.post(`/orcamentos/${orcamento.id}/aceitar`, { pagamento: "dinheiro" }))).status, 409);
  });

  it("proposta vencida não pode ser aceita", async () => {
    const { orcamento } = await cliente.post("/orcamentos", PEDIDO);
    await painel.post(`/orcamentos/${orcamento.id}/responder`, { ...RESPOSTA, validade_dias: 1 });
    await emu.db.query("update public.orcamentos set resposta = jsonb_set(resposta, '{valido_ate}', to_jsonb('2020-01-01'::text)) where id = $1", [orcamento.id]);
    const e = await falha(cliente.post(`/orcamentos/${orcamento.id}/aceitar`, { pagamento: "dinheiro" }));
    assert.equal(e.status, 409);
    assert.match(e.message, /venceu/);
  });

  it("desligado: a loja avisa e não recebe pedidos de orçamento", async () => {
    await painel.put("/orcamentos/config", { ativo: false, texto: "" });
    assert.equal((await visitante.get("/config")).orcamento.ativo, false);
    assert.equal((await falha(outro.post("/orcamentos", PEDIDO))).status, 409);
    await painel.put("/orcamentos/config", { ativo: true, texto: "Bolos de festa sob medida" });
    assert.deepEqual((await visitante.get("/config")).orcamento, { ativo: true, texto: "Bolos de festa sob medida" });
  });
});
