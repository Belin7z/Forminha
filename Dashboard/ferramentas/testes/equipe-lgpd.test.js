/* ==========================================================
   EQUIPE, REGISTRO DE ATIVIDADE, LGPD E PRIMEIROS PASSOS
   O atendente cuida de pedidos, agenda e produção — nada da
   gestão. Toda mudança de gestão fica registrada. O cliente pode
   baixar e excluir os próprios dados.
   ========================================================== */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { iniciarEmulador } from "./emulador/servidor.js";
import { criarApiLoja } from "../../../Loja/src/scripts/base/api/loja.js";
import { criarApiPainel } from "../../src/scripts/base/api/painel.js";
import { gerarHorarios, dataISO } from "../../../Loja/src/scripts/base/agendamento.js";

let emu, admin, painel, visitante, cliente, atendente, bolo, quando, dadosAdmin;
const novoCliente = () => createClient(emu.url, emu.chaveAnon, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
async function falha(promessa) { try { await promessa; } catch (e) { return e; } assert.fail("era esperado um erro"); }
const ITEM = () => ({ produto_id: bolo.id, qtd: 1, opcoes: { g1: ["g1i1"] } });

function proximaData(cfg) {
  const minimo = new Date(Date.now() + 96 * 3600_000);
  for (let i = 0; i < 30; i++) {
    const d = new Date(minimo.getFullYear(), minimo.getMonth(), minimo.getDate() + i);
    const horas = gerarHorarios(cfg.horarios, dataISO(d), minimo, cfg.pedidos.intervalo_min);
    if (horas.length) return { data: dataISO(d), hora: horas[0] };
  }
  throw new Error("sem data disponível");
}
const pedir = (api, extra = {}) => api.post("/pedidos", { itens: [ITEM()], tipo: "retirada", ...quando, pagamento: "dinheiro", ...extra });
const auditoria = async () => (await painel.get("/auditoria?limite=300")).itens;

before(async () => {
  emu = await iniciarEmulador();
  dadosAdmin = await emu.criarAdmin("dona@teste.local", "Admin12345");
  painel = criarApiPainel(novoCliente());
  await painel.post("/auth/entrar", { email: dadosAdmin.email, senha: dadosAdmin.senha });
  visitante = criarApiLoja(novoCliente());
  cliente = criarApiLoja(novoCliente());
  await cliente.post("/auth/cadastro", { nome: "Cliente Comum", email: "comum@teste.com", telefone: "11999998888", senha: "Senha1234" });
  bolo = (await visitante.get("/catalogo")).produtos.find((p) => p.nome === "Bolo Ninho com Morango");
  quando = proximaData(await visitante.get("/config"));
});
after(async () => { await emu?.fechar(); });

describe("atendente", () => {
  let pedido;
  it("o administrador dá o papel a quem já tem conta e o atendente entra no painel", async () => {
    const conta = criarApiLoja(novoCliente());
    await conta.post("/auth/cadastro", { nome: "Ana Atendente", email: "ana@teste.com", telefone: "11955554444", senha: "Senha1234" });
    await painel.post("/equipe", { email: "ana@teste.com", papel: "atendente" });
    const equipe = (await painel.get("/equipe")).equipe;
    assert.equal(equipe.find((m) => m.email === "ana@teste.com").papel, "atendente");

    atendente = criarApiPainel(novoCliente());
    const r = await atendente.post("/auth/entrar", { email: "ana@teste.com", senha: "Senha1234" });
    assert.equal(r.usuario.papel, "atendente");
    assert.equal((await atendente.get("/auth/eu")).usuario.papel, "atendente");
    // cliente comum continua sem entrar no painel
    assert.equal((await falha(criarApiPainel(novoCliente()).post("/auth/entrar", { email: "comum@teste.com", senha: "Senha1234" }))).status, 403);
  });

  it("faz o trabalho do dia a dia: pedidos, status, pedido manual, pagamento, agenda e produção", async () => {
    pedido = (await pedir(cliente)).pedido;
    const lista = await atendente.get("/pedidos");
    assert.ok(lista.itens.some((p) => p.codigo === pedido.codigo));
    assert.equal((await atendente.get(`/pedidos/${pedido.id}`)).pedido.codigo, pedido.codigo);
    assert.equal((await atendente.patch(`/pedidos/${pedido.id}/status`, { status: "confirmado", nota: "" })).pedido.status, "confirmado");
    assert.ok((await atendente.get("/pedidos/contagem")));

    const manual = await atendente.post("/pedidos", { nome: "Cliente Telefone", tipo: "retirada", ...quando, pagamento: "pix", itens: [ITEM()] });
    assert.equal(manual.pedido.origem, "manual");
    const pago = await atendente.post(`/pedidos/${manual.pedido.id}/pagamentos`, { valor: 1000, forma: "pix" });
    assert.equal(pago.pedido.pago, 1000);

    assert.ok((await atendente.get(`/agenda?mes=${quando.data.slice(0, 7)}`)).dias.length >= 28);
    assert.ok((await atendente.get(`/producao?data=${quando.data}`)).itens.length >= 1);
    assert.ok((await atendente.get("/produtos")).produtos.length > 0, "precisa ver o cardápio para lançar pedidos");
    assert.ok((await atendente.get("/categorias")).categorias.length > 0);
    assert.ok((await atendente.get("/clientes?busca=comum")).clientes.some((c) => c.email === "comum@teste.com"), "busca de cliente para o pedido manual");
  });

  it("não acessa a gestão da loja", async () => {
    const proibidos = [
      () => atendente.get("/resumo"), () => atendente.get("/cupons"), () => atendente.get("/configuracoes"),
      () => atendente.put("/configuracoes/loja", {}), () => atendente.get("/equipe"), () => atendente.post("/equipe", { email: "comum@teste.com", papel: "admin" }),
      () => atendente.post("/cupons", { codigo: "HACK", tipo: "frete", minimo: 0, ativo: true }), () => atendente.put("/agenda/data", { data: quando.data, bloquear: true, motivo: "x" }),
      () => atendente.put("/configuracoes/agenda", { max_pedidos_dia: 1 }), () => atendente.get("/exportar/pedidos"), () => atendente.get("/exportar/clientes"),
      () => atendente.get("/auditoria"), () => atendente.get("/checklist"), () => atendente.get("/zonas"), () => atendente.get("/avaliacoes"),
      () => atendente.post("/produtos", { categoria_id: 1, nome: "Hack", preco: 1, unidade: "un", min_qtd: 1, ativo: true, opcoes: [] }),
    ];
    for (const chamada of proibidos) assert.equal((await falha(chamada())).status, 403);
    const idCliente = (await atendente.get("/clientes?busca=comum")).clientes[0].id;
    assert.equal((await falha(atendente.get(`/clientes/${idCliente}`))).status, 403, "detalhe financeiro do cliente é da gestão");
  });

  it("papéis: ninguém altera o próprio acesso e conta desativada perde tudo", async () => {
    assert.equal((await falha(painel.post("/equipe", { email: dadosAdmin.email, papel: "atendente" }))).status, 409);
    assert.equal((await falha(painel.post("/equipe", { email: dadosAdmin.email, papel: "cliente" }))).status, 409);
    assert.equal((await falha(painel.post("/equipe", { email: "ana@teste.com", papel: "chefe" }))).status, 422);

    const ana = (await painel.get("/equipe")).equipe.find((m) => m.email === "ana@teste.com");
    await painel.patch(`/equipe/${ana.id}`, { ativo: false });
    assert.equal((await falha(atendente.get("/pedidos"))).status, 401);
    await painel.patch(`/equipe/${ana.id}`, { ativo: true });
    assert.ok((await atendente.get("/pedidos")).itens.length > 0);
  });
});

describe("registro de atividade", () => {
  it("guarda quem criou, alterou e removeu, com o que mudou", async () => {
    await painel.post("/cupons", { codigo: "AUDIT10", descricao: "", tipo: "percentual", valor: 10, minimo: 0, ativo: true });
    const cupom = (await painel.get("/cupons")).cupons.find((c) => c.codigo === "AUDIT10");
    await painel.put(`/cupons/${cupom.id}`, { codigo: "AUDIT10", descricao: "", tipo: "percentual", valor: 15, minimo: 0, ativo: true });
    await painel.delete(`/cupons/${cupom.id}`);

    const linhas = (await auditoria()).filter((a) => a.tabela === "cupons" && a.resumo === "AUDIT10");
    assert.deepEqual(linhas.map((l) => l.operacao).reverse(), ["criou", "alterou", "removeu"]);
    const alteracao = linhas.find((l) => l.operacao === "alterou");
    assert.deepEqual(alteracao.detalhes.valor, { de: "10", para: "15" });
    assert.ok(linhas.every((l) => l.usuario.length > 0), "sempre sabe quem foi");
  });

  it("registra configurações, mudança de papel e pagamentos feitos pela equipe", async () => {
    await painel.put("/configuracoes/pedidos", { pausados: false, mensagem_pausa: "", antecedencia_horas: 24, pedido_minimo: 0, intervalo_min: 30, dias_maximos: 45 });
    const a = await auditoria();
    assert.ok(a.some((x) => x.tabela === "configuracoes" && x.resumo === "pedidos"));
    const papel = a.find((x) => x.tabela === "perfis" && x.detalhes.papel?.para === "atendente");
    assert.ok(papel, "a promoção da atendente ficou registrada");
    assert.equal(papel.resumo, "Ana Atendente");
    const pagamento = a.find((x) => x.tabela === "pagamentos_pedido");
    assert.ok(pagamento, "o pagamento registrado pela atendente aparece");
    assert.equal(pagamento.usuario, "Ana Atendente");
  });

  it("não registra dados de clientes e só o administrador lê", async () => {
    const antes = (await auditoria()).length;
    await cliente.post("/enderecos", { apelido: "Casa", cep: "01001-000", rua: "Praça da Sé", numero: "10", complemento: "", bairro: "Sé", cidade: "São Paulo", uf: "SP", referencia: "", lat: -23.552, lng: -46.634, principal: true });
    await cliente.put("/conta", { nome: "Cliente Comum", telefone: "11999998888" });
    assert.equal((await auditoria()).length, antes, "endereço e perfil do cliente ficam fora do registro");
    assert.ok((await auditoria()).every((a) => !["enderecos", "pedidos", "favoritos"].includes(a.tabela)));
    assert.equal((await falha(criarApiPainel(cliente.supabase).get("/auditoria"))).status, 403);
    assert.equal((await falha(criarApiPainel(visitante.supabase).get("/auditoria"))).status, 401);
  });
});

describe("dados pessoais (LGPD)", () => {
  let lgpd;
  const dados = { nome: "Beatriz Excluida", email: "beatriz@teste.com", telefone: "11933332222", senha: "Senha1234" };

  it("guarda quando o cliente aceitou os termos e permite baixar todos os dados", async () => {
    lgpd = criarApiLoja(novoCliente());
    await lgpd.post("/auth/cadastro", { ...dados, aceite: true });
    await lgpd.post("/enderecos", { apelido: "Casa", cep: "01001-000", rua: "Rua Secreta", numero: "77", complemento: "", bairro: "Centro", cidade: "São Paulo", uf: "SP", referencia: "", lat: -23.552, lng: -46.634, principal: true });
    await lgpd.put(`/favoritos/${bolo.id}`);
    await pedir(lgpd);

    const d = await lgpd.get("/conta/dados");
    assert.equal(d.perfil.email, dados.email);
    assert.ok(d.perfil.aceite_termos_em, "registrou o aceite");
    assert.equal(d.enderecos[0].rua, "Rua Secreta");
    assert.equal(d.pedidos.length, 1);
    assert.deepEqual(d.favoritos, [bolo.nome]);
    assert.equal((await cliente.get("/conta/dados")).perfil.aceite_termos_em, null, "quem não aceitou (conta antiga) fica sem data");
    assert.equal((await falha(visitante.get("/conta/dados"))).status, 401);
  });

  it("não exclui com pedido em andamento nem com senha errada", async () => {
    assert.equal((await falha(lgpd.post("/conta/excluir", { senha: dados.senha }))).status, 409);
    const abertos = (await lgpd.get("/pedidos")).pedidos;
    for (const p of abertos) await lgpd.post(`/pedidos/${p.codigo}/cancelar`, { motivo: "vou excluir a conta" });
    const e = await falha(lgpd.post("/conta/excluir", { senha: "SenhaErrada1" }));
    assert.equal(e.status, 422);
    assert.ok(e.campos.senha);
    assert.equal((await lgpd.get("/auth/eu")).usuario.email, dados.email, "continua com a conta");
  });

  it("exclui a conta: sessão encerrada, login impossível e pedidos antigos sem dados pessoais", async () => {
    assert.deepEqual(await lgpd.post("/conta/excluir", { senha: dados.senha }), { ok: true });
    assert.equal((await lgpd.get("/auth/eu")).usuario, null);
    assert.equal((await falha(criarApiLoja(novoCliente()).post("/auth/entrar", { email: dados.email, senha: dados.senha }))).status >= 400, true);

    const lista = (await painel.get("/pedidos?status=todos&busca=Cliente removido")).itens;
    assert.ok(lista.length >= 1, "o histórico de vendas permanece");
    assert.ok(lista.every((p) => p.cliente.nome === "Cliente removido" && p.cliente.telefone === null && p.cliente.id === null));
    assert.ok(lista.every((p) => p.endereco === null));

    assert.ok(!JSON.stringify((await painel.get("/exportar/clientes")).linhas).includes(dados.email));
    assert.ok(!(await painel.get("/clientes?busca=beatriz")).clientes.length);
    assert.ok(!JSON.stringify(await auditoria()).includes("Beatriz"), "o registro de atividade também não guarda o cliente");
  });
});

describe("primeiros passos da loja", () => {
  it("mostra o que já está pronto e atualiza conforme a dona configura", async () => {
    const antes = (await painel.get("/checklist")).itens;
    const por = (lista, id) => lista.find((i) => i.id === id);
    assert.equal(por(antes, "produtos").feito, true, "cardápio de exemplo");
    assert.equal(por(antes, "pix").feito, false);
    assert.equal(por(antes, "imagens").feito, false);
    assert.ok(antes.every((i) => i.titulo && i.link.startsWith("/")));

    await painel.put("/configuracoes/pagamento", { pix_ativo: true, pix_chave: "loja@exemplo.com", pix_nome: "Doceria Exemplo", pix_cidade: "Sao Paulo", dinheiro_ativo: true, cartao_ativo: true });
    assert.equal(por((await painel.get("/checklist")).itens, "pix").feito, true);
  });
});
