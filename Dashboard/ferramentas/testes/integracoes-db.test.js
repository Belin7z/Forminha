/* ==========================================================
   INTEGRAÇÕES (banco) — PIX automático e avisos por WhatsApp.
   Chave de integração guardada só como hash, pagamento do
   gateway registrado uma única vez e nunca acima do total,
   regras de quando o aviso deve (ou não) sair.
   ========================================================== */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { iniciarEmulador } from "./emulador/servidor.js";
import { sql } from "./emulador/banco.js";
import { criarApiLoja } from "../../../Loja/src/scripts/base/api/loja.js";
import { criarApiPainel } from "../../src/scripts/base/api/painel.js";
import { gerarHorarios, dataISO } from "../../../Loja/src/scripts/base/agendamento.js";

let emu, painel, visitante, cliente, atendente, bolo, quando, segredo;
const novo = () => createClient(emu.url, emu.chaveAnon, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
async function falha(promessa) { try { await promessa; } catch (e) { return e; } assert.fail("era esperado um erro"); }
const rpcAnon = async (fn, p) => { const r = await visitante.supabase.rpc(fn, { p }); if (r.error) { const e = new Error(r.error.message); e.status = r.status; throw e; } return r.data; };
const rpcPainel = async (api, fn, p) => { const r = await api.supabase.rpc(fn, { p }); if (r.error) { const e = new Error(r.error.message); e.status = r.status; throw e; } return r.data; };

function proximaData(cfg) {
  const minimo = new Date(Date.now() + 96 * 3600_000);
  for (let i = 0; i < 30; i++) {
    const d = new Date(minimo.getFullYear(), minimo.getMonth(), minimo.getDate() + i);
    const horas = gerarHorarios(cfg.horarios, dataISO(d), minimo, cfg.pedidos.intervalo_min);
    if (horas.length) return { data: dataISO(d), hora: horas[0] };
  }
  throw new Error("sem data disponível");
}
const pedir = (extra = {}) => cliente.post("/pedidos", { itens: [{ produto_id: bolo.id, qtd: 1, opcoes: { g1: ["g1i1"] } }], tipo: "retirada", ...quando, pagamento: "dinheiro", ...extra });
const mudar = (id, status) => painel.patch(`/pedidos/${id}/status`, { status, nota: "" });

before(async () => {
  emu = await iniciarEmulador();
  const admin = await emu.criarAdmin("dona@teste.local", "Admin12345");
  painel = criarApiPainel(novo());
  await painel.post("/auth/entrar", { email: admin.email, senha: admin.senha });
  visitante = criarApiLoja(novo());
  cliente = criarApiLoja(novo());
  await cliente.post("/auth/cadastro", { nome: "Maria Cliente", email: "maria@teste.com", telefone: "(11) 99999-8888", senha: "Senha1234" });
  const conta = criarApiLoja(novo());
  await conta.post("/auth/cadastro", { nome: "Ana Atendente", email: "ana@teste.com", telefone: "11955554444", senha: "Senha1234" });
  await painel.post("/equipe", { email: "ana@teste.com", papel: "atendente" });
  atendente = criarApiPainel(novo());
  await atendente.post("/auth/entrar", { email: "ana@teste.com", senha: "Senha1234" });
  bolo = (await visitante.get("/catalogo")).produtos.find((p) => p.nome === "Bolo Ninho com Morango");
  quando = proximaData(await visitante.get("/config"));
});
after(async () => { await emu?.fechar(); });

describe("chave de integração do PIX automático", () => {
  it("nasce desligado; não liga sem chave; a chave aparece uma vez e o banco guarda só o hash", async () => {
    assert.deepEqual(await painel.get("/gateway"), { provedor: "mercadopago", ativo: false, cartao: false, tem_chave: false, conectado_em: null, conta: "" });
    assert.equal((await falha(painel.put("/gateway", { ativo: true }))).status, 422);

    ({ segredo } = await painel.post("/gateway/segredo"));
    assert.match(segredo, /^[0-9a-f]{64}$/);
    const guardado = JSON.stringify((await sql(emu.db, "select valor from public.configuracoes where chave = 'gateway'")).rows[0].valor);
    assert.ok(!guardado.includes(segredo), "a chave em texto puro não fica no banco");
    assert.match(guardado, /segredo_hash/);

    assert.equal((await painel.put("/gateway", { ativo: true })).ativo, true);
    assert.equal((await visitante.get("/config")).pagamento.pix_automatico, true, "a loja fica sabendo que está ligado");
    assert.ok(!JSON.stringify(await visitante.get("/config")).includes("segredo"), "e nunca recebe a chave nem o hash");
  });

  it("gerar outra chave desliga o recurso até religar; só o administrador mexe", async () => {
    const antiga = segredo;
    ({ segredo } = await painel.post("/gateway/segredo"));
    assert.notEqual(segredo, antiga);
    assert.equal((await painel.get("/gateway")).ativo, false);
    assert.equal((await visitante.get("/config")).pagamento.pix_automatico, false);
    await painel.put("/gateway", { ativo: true });
    for (const chamada of [() => atendente.get("/gateway"), () => atendente.put("/gateway", { ativo: false }), () => atendente.post("/gateway/segredo")]) {
      assert.equal((await falha(chamada())).status, 403);
    }
    assert.equal((await falha(criarApiPainel(cliente.supabase).get("/gateway"))).status, 403);
  });
});

describe("registro do pagamento vindo do gateway", () => {
  let pedido;
  it("recusa chave errada ou ausente e não deixa quem não é o gateway registrar nada", async () => {
    pedido = (await pedir()).pedido;
    const base = { codigo: pedido.codigo, valor: 1000, id_externo: "MP-1" };
    assert.equal((await falha(rpcAnon("gateway_registrar_pagamento", { ...base, segredo: "errada" }))).status, 403);
    assert.equal((await falha(rpcAnon("gateway_registrar_pagamento", base))).status, 403);
    assert.equal((await falha(rpcAnon("gateway_registrar_pagamento", { ...base, segredo: segredo.replace(/.$/, segredo.endsWith("0") ? "1" : "0") }))).status, 403); // sempre diferente da chave real
    assert.equal((await painel.get(`/pedidos/${pedido.id}`)).pedido.pago, 0);
  });

  it("registra uma vez (idempotente pelo id do gateway) e mostra 'PIX (automático)'", async () => {
    const dados = { segredo, codigo: pedido.codigo, valor: 1000, id_externo: "MP-100" };
    const r = await rpcAnon("gateway_registrar_pagamento", dados);
    assert.equal(r.ok, true);
    assert.equal(r.aplicado, 1000);
    assert.deepEqual(await rpcAnon("gateway_registrar_pagamento", dados), { ok: true, duplicado: true }, "o gateway costuma avisar mais de uma vez");
    const p = (await painel.get(`/pedidos/${pedido.id}`)).pedido;
    assert.equal(p.pago, 1000);
    assert.equal(p.pagamentos.length, 1);
    assert.equal(p.pagamentos[0].forma_texto, "PIX (automático)");
    assert.equal((await cliente.get(`/pedidos/${pedido.codigo}`)).pedido.pago, 1000, "o cliente vê o pagamento confirmado");
    const e = await falha(painel.delete(`/pagamentos/${p.pagamentos[0].id}`));
    assert.equal(e.status, 409, "pagamento automático só se devolve no Mercado Pago");
    assert.match(e.message, /estorno no Mercado Pago/);
  });

  it("nunca passa do total do pedido e ignora o que já está quitado", async () => {
    const total = (await painel.get(`/pedidos/${pedido.id}`)).pedido.total;
    const r = await rpcAnon("gateway_registrar_pagamento", { segredo, codigo: pedido.codigo, valor: total * 3, id_externo: "MP-200" });
    assert.equal(r.aplicado, total - 1000);
    assert.equal(r.situacao, "pago");
    const de_novo = await rpcAnon("gateway_registrar_pagamento", { segredo, codigo: pedido.codigo, valor: 500, id_externo: "MP-300" });
    assert.equal(de_novo.ignorado, true);
    assert.equal((await painel.get(`/pedidos/${pedido.id}`)).pedido.pago, total);
  });

  it("valida os dados; pedido inexistente ou cancelado não recebe", async () => {
    const e = { segredo, codigo: pedido.codigo, valor: 100, id_externo: "MP-400" };
    assert.equal((await falha(rpcAnon("gateway_registrar_pagamento", { ...e, valor: 0 }))).status, 422);
    assert.equal((await falha(rpcAnon("gateway_registrar_pagamento", { ...e, valor: "abc" }))).status, 422);
    assert.equal((await falha(rpcAnon("gateway_registrar_pagamento", { ...e, id_externo: "" }))).status, 422);
    assert.equal((await falha(rpcAnon("gateway_registrar_pagamento", { ...e, codigo: "LA999999" }))).status, 404);
    const cancelado = (await pedir()).pedido;
    await cliente.post(`/pedidos/${cancelado.codigo}/cancelar`, { motivo: "teste" });
    assert.deepEqual(await rpcAnon("gateway_registrar_pagamento", { ...e, codigo: cancelado.codigo, id_externo: "MP-500" }), { ok: false, motivo: "cancelado" });
  });

  it("com o recurso desligado, nem a chave certa registra", async () => {
    await painel.put("/gateway", { ativo: false });
    const novo1 = (await pedir()).pedido;
    assert.equal((await falha(rpcAnon("gateway_registrar_pagamento", { segredo, codigo: novo1.codigo, valor: 100, id_externo: "MP-600" }))).status, 403);
    await painel.put("/gateway", { ativo: true });
  });
});

describe("avisos por WhatsApp — regras", () => {
  let ped;
  const dados = (id, evento, extra = {}) => rpcPainel(atendente, "admin_aviso_dados", { id, evento, ...extra });

  it("configuração vem com padrões sensatos e só o administrador altera", async () => {
    const c = await painel.get("/avisos");
    assert.equal(c.whatsapp_ativo, false);
    assert.equal(c.eventos.confirmado, true);
    assert.equal(c.eventos.em_preparo, false);
    assert.equal(c.modelos.saiu_entrega, "pedido_saiu_entrega");
    assert.equal((await falha(atendente.get("/avisos"))).status, 403);
    assert.equal((await falha(atendente.put("/avisos", { whatsapp_ativo: true }))).status, 403);
  });

  it("valida o nome dos modelos e salva", async () => {
    assert.ok((await falha(painel.put("/avisos", { whatsapp_ativo: true, eventos: {}, modelos: { pronto: "Nome Inválido!" } }))).campos.modelo_pronto);
    const salvo = await painel.put("/avisos", {
      whatsapp_ativo: true, eventos: { confirmado: true, em_preparo: true, pronto: true, saiu_entrega: true, entregue: false, cancelado: true }, modelos: { pronto: "meu_modelo_pronto" },
    });
    assert.equal(salvo.whatsapp_ativo, true);
    assert.equal(salvo.eventos.em_preparo, true);
    assert.equal(salvo.modelos.pronto, "meu_modelo_pronto");
    assert.equal(salvo.modelos.confirmado, "pedido_confirmado", "o que não foi mudado mantém o padrão");
  });

  it("monta o aviso quando tudo está certo (telefone com 55, primeiro nome, dia e hora)", async () => {
    ped = (await pedir()).pedido;
    await mudar(ped.id, "confirmado");
    const d = await dados(ped.id, "confirmado");
    assert.equal(d.enviar, true);
    assert.equal(d.telefone, "5511999998888");
    assert.equal(d.modelo, "pedido_confirmado");
    assert.equal(d.idioma, "pt_BR");
    assert.equal(d.variaveis[0], "Maria");
    assert.equal(d.variaveis[1], ped.codigo);
    assert.match(d.variaveis[2], /^(domingo|segunda|terça|quarta|quinta|sexta|sábado).* \d{2}\/\d{2} às \d{2}:\d{2}$/);
  });

  it("explica por que NÃO enviou: situação, desligado, status mudou, cliente recusou, sem telefone", async () => {
    assert.equal((await dados(ped.id, "entregue")).motivo, "evento_desligado");
    assert.equal((await dados(ped.id, "pronto")).motivo, "status_mudou", "o pedido não está 'pronto'");
    assert.equal((await falha(dados(ped.id, "inventado"))).status, 422);

    await cliente.put("/conta/preferencias", { avisos_whatsapp: false });
    assert.equal((await dados(ped.id, "confirmado")).motivo, "cliente_recusou");
    assert.equal((await cliente.get("/auth/eu")).usuario.avisos_whatsapp, false);
    await cliente.put("/conta/preferencias", { avisos_whatsapp: true });
    assert.equal((await dados(ped.id, "confirmado")).enviar, true);

    const manual = (await painel.post("/pedidos", { nome: "Sem Fone", tipo: "retirada", ...quando, pagamento: "pix", itens: [{ nome: "Doce", preco: 500, qtd: 1 }] })).pedido;
    assert.equal((await dados(manual.id, "confirmado")).motivo, "sem_telefone");
    const comFone = (await painel.post("/pedidos", { nome: "Dona Marta Silva", telefone: "(27) 98888-7777", tipo: "retirada", ...quando, pagamento: "pix", itens: [{ nome: "Doce", preco: 500, qtd: 1 }] })).pedido;
    const dm = await dados(comFone.id, "confirmado");
    assert.equal(dm.telefone, "5527988887777", "pedido lançado pela equipe, sem conta, também recebe");
    assert.equal(dm.variaveis[0], "Dona");

    await painel.put("/avisos", { whatsapp_ativo: false, eventos: {}, modelos: {} });
    assert.equal((await dados(ped.id, "confirmado")).motivo, "desligado");
    await painel.put("/avisos", { whatsapp_ativo: true, eventos: { confirmado: true, pronto: true, saiu_entrega: true, cancelado: true, em_preparo: true, entregue: false }, modelos: {} });
  });

  it("não repete o mesmo aviso, a não ser que a equipe peça (reenviar); tudo fica no histórico", async () => {
    const reg = (estado, detalhe = "") => rpcPainel(atendente, "admin_aviso_registrar", { pedido_id: ped.id, evento: "confirmado", estado, detalhe });
    await reg("erro", "Número sem WhatsApp");
    assert.equal((await dados(ped.id, "confirmado")).enviar, true, "erro não conta como enviado");
    await reg("enviado", "wamid.ABC");
    assert.equal((await dados(ped.id, "confirmado")).motivo, "ja_enviado");
    assert.equal((await dados(ped.id, "confirmado", { forcar: true })).enviar, true, "reenviar de propósito");

    const lista = (await atendente.get(`/pedidos/${ped.id}/avisos`)).avisos;
    assert.deepEqual(lista.map((a) => a.estado), ["enviado", "erro"]);
    assert.equal(lista[0].usuario, "Ana Atendente");
    assert.equal(lista[0].evento_texto, "Confirmado");
    assert.equal((await falha(rpcPainel(atendente, "admin_aviso_registrar", { pedido_id: ped.id, evento: "confirmado", estado: "talvez" }))).status, 422);
    assert.equal((await falha(rpcPainel(criarApiPainel(cliente.supabase), "admin_aviso_dados", { id: ped.id, evento: "confirmado" }))).status, 403);
    assert.equal((await falha(rpcAnon("admin_aviso_dados", { id: ped.id, evento: "confirmado" }))).status, 401);
  });
});

describe("preferência do cliente", () => {
  it("exige a informação e é só do próprio cliente", async () => {
    assert.equal((await falha(cliente.put("/conta/preferencias", {}))).status, 422);
    assert.equal((await falha(visitante.put("/conta/preferencias", { avisos_whatsapp: false }))).status, 401);
  });
});
