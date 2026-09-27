/* ==========================================================
   INTEGRAÇÕES (funções do servidor) — pix-criar, pix-webhook e
   whatsapp-avisar, com o banco de teste de verdade e o Mercado
   Pago / Meta simulados. Prova: o valor vem do banco, o pagamento
   é conferido no Mercado Pago, nada é registrado duas vezes e o
   aviso só sai quando o banco manda.
   ========================================================== */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { iniciarEmulador } from "./emulador/servidor.js";
import { criarExternos } from "./emulador/externos.js";
import { criarApiLoja } from "../../../Loja/src/scripts/base/api/loja.js";
import { criarApiPainel } from "../../src/scripts/base/api/painel.js";
import { gerarHorarios, dataISO } from "../../../Loja/src/scripts/base/agendamento.js";
import { cabecalhosCors, criarRpc } from "../../supabase/functions/_shared/comum.js";
import { criarPix, validadeMercadoPago, valorDevido } from "../../supabase/functions/pix-criar/logica.js";
import { assinaturaValida, receberWebhook } from "../../supabase/functions/pix-webhook/logica.js";
import { avisarWhatsapp, traduzirErroMeta } from "../../supabase/functions/whatsapp-avisar/logica.js";

let emu, ext, painel, visitante, maria, joana, atendente, bolo, quando, segredo, deps, env;
const novo = () => createClient(emu.url, emu.chaveAnon, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const jwtDe = async (api) => (await api.supabase.auth.getSession()).data.session.access_token;
const pedirMaria = (extra = {}) => maria.post("/pedidos", { itens: [{ produto_id: bolo.id, qtd: 1, opcoes: { g1: ["g1i1"] } }], tipo: "retirada", ...quando, pagamento: "pix", ...extra });

function proximaData(cfg) {
  const minimo = new Date(Date.now() + 96 * 3600_000);
  for (let i = 0; i < 30; i++) {
    const d = new Date(minimo.getFullYear(), minimo.getMonth(), minimo.getDate() + i);
    const horas = gerarHorarios(cfg.horarios, dataISO(d), minimo, cfg.pedidos.intervalo_min);
    if (horas.length) return { data: dataISO(d), hora: horas[0] };
  }
  throw new Error("sem data disponível");
}

const requisicao = (metodo, { jwt, corpo, url = "http://funcao.local/x", cabecalhos = {} } = {}) => ({
  metodo, url, corpoTexto: corpo === undefined ? "" : JSON.stringify(corpo),
  cabecalhos: { ...(jwt ? { authorization: `Bearer ${jwt}` } : {}), ...cabecalhos },
});

async function assinar(dataId, { ts = String(Date.now()), idReq = "req-1", chave = "whsec-teste" } = {}) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(chave), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const id = /^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId;
  const bruto = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`id:${id};request-id:${idReq};ts:${ts};`));
  return { "x-signature": `ts=${ts},v1=${[...new Uint8Array(bruto)].map((b) => b.toString(16).padStart(2, "0")).join("")}`, "x-request-id": idReq };
}
const avisoMP = async (id, extra = {}) => receberWebhook(requisicao("POST", {
  url: `http://funcao.local/functions/v1/pix-webhook?data.id=${id}&type=payment`, corpo: { action: "payment.updated", data: { id: String(id) }, type: "payment" },
  cabecalhos: await assinar(String(id)), ...extra,
}), deps);

before(async () => {
  emu = await iniciarEmulador();
  ext = criarExternos();
  const admin = await emu.criarAdmin("dona@teste.local", "Admin12345");
  painel = criarApiPainel(novo());
  await painel.post("/auth/entrar", { email: admin.email, senha: admin.senha });
  visitante = criarApiLoja(novo());
  maria = criarApiLoja(novo());
  joana = criarApiLoja(novo());
  await maria.post("/auth/cadastro", { nome: "Maria Cliente", email: "maria@teste.com", telefone: "11999998888", senha: "Senha1234" });
  await joana.post("/auth/cadastro", { nome: "Joana Outra", email: "joana@teste.com", telefone: "11977776666", senha: "Senha1234" });
  const conta = criarApiLoja(novo());
  await conta.post("/auth/cadastro", { nome: "Ana Atendente", email: "ana@teste.com", telefone: "11955554444", senha: "Senha1234" });
  await painel.post("/equipe", { email: "ana@teste.com", papel: "atendente" });
  atendente = criarApiPainel(novo());
  await atendente.post("/auth/entrar", { email: "ana@teste.com", senha: "Senha1234" });
  await painel.put("/configuracoes/pagamento", { pix_ativo: true, pix_chave: "loja@exemplo.com", pix_nome: "Doceria Exemplo", pix_cidade: "Sao Paulo", dinheiro_ativo: true, cartao_ativo: true });
  bolo = (await visitante.get("/catalogo")).produtos.find((p) => p.nome === "Bolo Ninho com Morango");
  quando = proximaData(await visitante.get("/config"));
  ({ segredo } = await painel.post("/gateway/segredo"));
  env = { SUPABASE_URL: emu.url, MP_ACCESS_TOKEN: "TEST-mp", SEGREDO_GATEWAY: segredo, MP_WEBHOOK_SECRET: "whsec-teste",
          WHATSAPP_TOKEN: "wa-token", WHATSAPP_PHONE_ID: "1234567890", URL_LOJA: "https://loja.exemplo/" };
  deps = { env, fetchFn: ext.fetchFn, rpc: criarRpc({ url: emu.url, chaveAnon: emu.chaveAnon, fetchFn: fetch }) };
});
after(async () => { await emu?.fechar(); });

describe("pix-criar", () => {
  it("recusa quem não está logado, configuração faltando, código estranho e PIX automático desligado", async () => {
    const jwt = await jwtDe(maria);
    const pedido = (await pedirMaria()).pedido;
    assert.equal((await criarPix(requisicao("POST", { corpo: { codigo: pedido.codigo } }), deps)).status, 401);
    assert.equal((await criarPix(requisicao("POST", { jwt, corpo: { codigo: pedido.codigo } }), { ...deps, env: { ...env, MP_ACCESS_TOKEN: "" } })).status, 503);
    assert.equal((await criarPix(requisicao("POST", { jwt, corpo: { codigo: "abc" } }), deps)).status, 422);
    assert.equal((await criarPix(requisicao("GET", { jwt }), deps)).status, 405);
    assert.equal((await criarPix(requisicao("OPTIONS"), deps)).status, 204);
    const r = await criarPix(requisicao("POST", { jwt, corpo: { codigo: pedido.codigo } }), deps);
    assert.equal(r.status, 409, "o PIX automático ainda está desligado");
    assert.match(r.corpo.erro, /desligado/);
    await painel.put("/gateway", { ativo: true });
  });

  it("gera o QR Code com o valor do BANCO (ignora o valor mandado pela tela) e as referências certas", async () => {
    const jwt = await jwtDe(maria);
    const pedido = (await pedirMaria()).pedido;
    const r = await criarPix(requisicao("POST", { jwt, corpo: { codigo: pedido.codigo, valor: 1, transaction_amount: 0.01 } }), deps);
    assert.equal(r.status, 200);
    assert.equal(r.corpo.valor, pedido.total);
    assert.match(r.corpo.qr_code, /^00020126/);
    assert.ok(r.corpo.qr_code_base64.length > 10);
    const chamada = ext.estado.mpChamadas.at(-1);
    assert.equal(chamada.corpo.transaction_amount, pedido.total / 100);
    assert.equal(chamada.corpo.external_reference, pedido.codigo);
    assert.equal(chamada.corpo.payer.email, "maria@teste.com");
    assert.equal(chamada.corpo.payment_method_id, "pix");
    assert.equal(chamada.corpo.notification_url, `${emu.url}/functions/v1/pix-webhook`);
    assert.match(chamada.corpo.date_of_expiration, /-03:00$/);
    assert.equal(chamada.cabecalhos.Authorization, "Bearer TEST-mp");
    assert.equal(chamada.cabecalhos["X-Idempotency-Key"], `${pedido.codigo}-${pedido.total}-0`);
  });

  it("clicar duas vezes devolve o mesmo pagamento (não cria PIX duplicado)", async () => {
    const jwt = await jwtDe(maria);
    const pedido = (await pedirMaria()).pedido;
    const a = await criarPix(requisicao("POST", { jwt, corpo: { codigo: pedido.codigo } }), deps);
    const b = await criarPix(requisicao("POST", { jwt, corpo: { codigo: pedido.codigo } }), deps);
    assert.equal(a.corpo.id, b.corpo.id);
    assert.equal([...ext.estado.mpPagamentos.values()].filter((p) => p.external_reference === pedido.codigo).length, 1);
  });

  it("pedido de outra pessoa não existe para você; pedido pago ou cancelado não gera PIX", async () => {
    const pedido = (await pedirMaria()).pedido;
    assert.equal((await criarPix(requisicao("POST", { jwt: await jwtDe(joana), corpo: { codigo: pedido.codigo } }), deps)).status, 404);
    const jwt = await jwtDe(maria);
    const cancelado = (await pedirMaria()).pedido;
    await maria.post(`/pedidos/${cancelado.codigo}/cancelar`, { motivo: "teste" });
    assert.equal((await criarPix(requisicao("POST", { jwt, corpo: { codigo: cancelado.codigo } }), deps)).status, 409);
    const pago = (await pedirMaria()).pedido;
    await painel.post(`/pedidos/${pago.id}/pagamentos`, { valor: pago.total, forma: "dinheiro" });
    assert.match((await criarPix(requisicao("POST", { jwt, corpo: { codigo: pago.codigo } }), deps)).corpo.erro, /já está pago/);
  });

  it("com sinal, cobra primeiro o sinal e depois só o que falta", async () => {
    await painel.put("/configuracoes/sinal", { percentual: 40, acima_de: 0 });
    const jwt = await jwtDe(maria);
    const pedido = (await pedirMaria()).pedido;
    assert.ok(pedido.sinal > 0);
    const s = await criarPix(requisicao("POST", { jwt, corpo: { codigo: pedido.codigo } }), deps);
    assert.equal(s.corpo.valor, pedido.sinal);
    ext.aprovar(s.corpo.id);
    assert.equal((await avisoMP(s.corpo.id)).status, 200);
    const resto = await criarPix(requisicao("POST", { jwt, corpo: { codigo: pedido.codigo } }), deps);
    assert.equal(resto.corpo.valor, pedido.total - pedido.sinal);
    assert.equal(valorDevido({ sinal: 10, pago: 4, total: 100 }), 6);
    assert.equal(valorDevido({ sinal: 10, pago: 10, total: 100 }), 90);
    await painel.put("/configuracoes/sinal", { percentual: 0, acima_de: 0 });
  });

  it("falha do Mercado Pago vira mensagem amigável (e não vaza detalhe)", async () => {
    const jwt = await jwtDe(maria);
    const pedido = (await pedirMaria()).pedido;
    ext.estado.falhas.mpCriar = true;
    const r = await criarPix(requisicao("POST", { jwt, corpo: { codigo: pedido.codigo } }), deps);
    assert.equal(r.status, 502);
    assert.doesNotMatch(JSON.stringify(r.corpo), /erro interno/);
    ext.estado.falhas.mpCriar = false;
    ext.estado.falhas.semQr = true;
    assert.equal((await criarPix(requisicao("POST", { jwt, corpo: { codigo: pedido.codigo } }), { ...deps, fetchFn: async (u, o) => ext.fetchFn(u, { ...o, headers: { ...o?.headers, "X-Idempotency-Key": "outra" } }) })).status, 502);
    ext.estado.falhas.semQr = false;
    assert.match(validadeMercadoPago(new Date("2026-09-22T13:30:00Z")), /^2026-09-22T10:30:00\.000-03:00$/);
  });
});

describe("pix-webhook", () => {
  let pedido, pagamento;
  it("sem configuração devolve 503; avisos que não são de pagamento são ignorados", async () => {
    assert.equal((await receberWebhook(requisicao("POST", { corpo: {} }), { ...deps, env: { ...env, SEGREDO_GATEWAY: "" } })).status, 503);
    assert.equal((await receberWebhook(requisicao("GET"), deps)).status, 405);
    const r = await receberWebhook(requisicao("POST", { url: "http://x/f?data.id=1&type=merchant_order", corpo: { type: "merchant_order" } }), deps);
    assert.equal(r.corpo.ignorado, true);
  });

  it("pagamento pendente não registra nada; aprovado registra uma vez e o cliente vê pago", async () => {
    pedido = (await pedirMaria()).pedido;
    pagamento = (await criarPix(requisicao("POST", { jwt: await jwtDe(maria), corpo: { codigo: pedido.codigo } }), deps)).corpo;
    const pendente = await avisoMP(pagamento.id);
    assert.equal(pendente.status, 200);
    assert.equal(pendente.corpo.estado, "pending");
    assert.equal((await painel.get(`/pedidos/${pedido.id}`)).pedido.pago, 0);

    ext.aprovar(pagamento.id);
    const r = await avisoMP(pagamento.id);
    assert.equal(r.status, 200);
    assert.equal(r.corpo.aplicado, pedido.total);
    assert.equal(r.corpo.situacao, "pago");
    const visto = (await maria.get(`/pedidos/${pedido.codigo}`)).pedido;
    assert.equal(visto.pagamento_situacao, "pago");
    assert.equal(visto.pagamentos[0].forma_texto, "PIX (automático)");
    assert.equal(visto.pix, undefined, "pago: some a cobrança");
  });

  it("o Mercado Pago avisa várias vezes: não duplica", async () => {
    const r = await avisoMP(pagamento.id);
    assert.equal(r.corpo.duplicado, true);
    assert.equal((await painel.get(`/pedidos/${pedido.id}`)).pedido.pagamentos.length, 1);
  });

  it("assinatura: sem, errada ou de outro pagamento é recusada; a certa passa", async () => {
    const id = String(pagamento.id);
    const base = { url: `http://x/f?data.id=${id}&type=payment`, corpo: { data: { id }, type: "payment" } };
    assert.equal((await receberWebhook(requisicao("POST", { ...base }), deps)).status, 401, "sem assinatura");
    assert.equal((await receberWebhook(requisicao("POST", { ...base, cabecalhos: await assinar(id, { chave: "outra-chave" }) }), deps)).status, 401);
    assert.equal((await receberWebhook(requisicao("POST", { ...base, cabecalhos: await assinar("999") }), deps)).status, 401, "assinatura de outro id");
    assert.equal((await receberWebhook(requisicao("POST", { ...base, cabecalhos: await assinar(id) }), deps)).status, 200);
    assert.equal(await assinaturaValida({ cabecalhos: { "x-signature": "ts=1,v1=zz", "x-request-id": "a" }, dataId: "1", segredo: "s" }), false);
  });

  it("pagamento desconhecido é ignorado; Mercado Pago fora do ar pede nova tentativa (500)", async () => {
    assert.equal((await avisoMP("123456")).corpo.ignorado, true);
    ext.estado.falhas.mpConsultar = true;
    assert.equal((await avisoMP(pagamento.id)).status, 500);
    ext.estado.falhas.mpConsultar = false;
  });

  it("chave de integração errada no servidor faz o banco recusar: 500 (para tentar de novo) e nada é registrado", async () => {
    const outro = (await pedirMaria()).pedido;
    const pag = (await criarPix(requisicao("POST", { jwt: await jwtDe(maria), corpo: { codigo: outro.codigo } }), deps)).corpo;
    ext.aprovar(pag.id);
    const r = await receberWebhook(requisicao("POST", { url: `http://x/f?data.id=${pag.id}&type=payment`, corpo: { data: { id: String(pag.id) }, type: "payment" }, cabecalhos: await assinar(String(pag.id)) }),
      { ...deps, env: { ...env, SEGREDO_GATEWAY: "chave-errada" } });
    assert.equal(r.status, 500);
    assert.equal((await painel.get(`/pedidos/${outro.id}`)).pedido.pago, 0);
    assert.equal((await avisoMP(pag.id)).corpo.aplicado, outro.total, "com a chave certa, registra");
  });

  it("pedido que não é desta loja é ignorado (não adianta o Mercado Pago insistir)", async () => {
    const estranho = { id: 9001, status: "approved", payment_method_id: "pix", transaction_amount: 10, external_reference: "LA000000" };
    ext.estado.mpPagamentos.set("9001", estranho);
    assert.equal((await avisoMP(9001)).corpo.ignorado, true);
  });
});

describe("whatsapp-avisar", () => {
  let pedido;
  const chamar = async (jwt, corpo, d = deps) => avisarWhatsapp(requisicao("POST", { jwt, corpo }), d);
  const ligar = () => painel.put("/avisos", { whatsapp_ativo: true, eventos: { confirmado: true, em_preparo: false, pronto: true, saiu_entrega: true, entregue: false, cancelado: true }, modelos: {} });

  it("recusa sem login, sem chaves e pedido estranho; cliente comum não dispara aviso", async () => {
    pedido = (await pedirMaria()).pedido;
    await painel.patch(`/pedidos/${pedido.id}/status`, { status: "confirmado", nota: "" });
    const jwtEquipe = await jwtDe(atendente);
    assert.equal((await chamar(null, { pedido_id: pedido.id, evento: "confirmado" })).status, 401);
    assert.equal((await chamar(jwtEquipe, { pedido_id: "abc", evento: "confirmado" })).status, 422);
    assert.equal((await chamar(await jwtDe(maria), { pedido_id: pedido.id, evento: "confirmado" })).status, 403, "cliente não usa a função da equipe");
    assert.equal(ext.estado.metaEnvios.length, 0);
  });

  it("desligado: não chama a Meta e explica o motivo", async () => {
    const r = await chamar(await jwtDe(atendente), { pedido_id: pedido.id, evento: "confirmado" });
    assert.deepEqual(r.corpo, { enviado: false, motivo: "desligado" });
    assert.equal(ext.estado.metaEnvios.length, 0);
    const semChaves = await chamar(await jwtDe(atendente), { pedido_id: pedido.id, evento: "confirmado" }, { ...deps, env: { ...env, WHATSAPP_TOKEN: "" } });
    assert.deepEqual(semChaves.corpo, { enviado: false, motivo: "desligado" }, "quem não usa WhatsApp nunca vê erro de configuração");
  });

  it("ligado: manda o modelo aprovado com nome, código, quando e link; registra no histórico", async () => {
    await ligar();
    const semChaves = await chamar(await jwtDe(atendente), { pedido_id: pedido.id, evento: "confirmado" }, { ...deps, env: { ...env, WHATSAPP_TOKEN: "" } });
    assert.equal(semChaves.status, 503, "ligado mas sem as chaves: aí sim avisa que falta configurar");
    assert.equal(ext.estado.metaEnvios.length, 0);
    assert.equal((await painel.get(`/pedidos/${pedido.id}/avisos`)).avisos.length, 0, "e não registra como enviado");
    const r = await chamar(await jwtDe(atendente), { pedido_id: pedido.id, evento: "confirmado" });
    assert.deepEqual(r.corpo, { enviado: true });
    assert.equal(ext.estado.metaEnvios.length, 1);
    const envio = ext.estado.metaEnvios[0];
    assert.equal(envio.caminho, "/v21.0/1234567890/messages");
    assert.equal(envio.cabecalhos.Authorization, "Bearer wa-token");
    assert.equal(envio.corpo.to, "5511999998888");
    assert.equal(envio.corpo.type, "template");
    assert.equal(envio.corpo.template.name, "pedido_confirmado");
    assert.equal(envio.corpo.template.language.code, "pt_BR");
    const ps = envio.corpo.template.components[0].parameters.map((x) => x.text);
    assert.equal(ps.length, 4);
    assert.equal(ps[0], "Maria");
    assert.equal(ps[1], pedido.codigo);
    assert.match(ps[2], / às \d{2}:\d{2}$/);
    assert.equal(ps[3], `https://loja.exemplo/#/pedido/${pedido.codigo}`);
    const log = (await painel.get(`/pedidos/${pedido.id}/avisos`)).avisos;
    assert.equal(log[0].estado, "enviado");
    assert.match(log[0].detalhe, /^wamid\./);
  });

  it("não repete o mesmo aviso; 'forçar' reenvia; situação que mudou não envia", async () => {
    const jwt = await jwtDe(atendente);
    assert.equal((await chamar(jwt, { pedido_id: pedido.id, evento: "confirmado" })).corpo.motivo, "ja_enviado");
    assert.equal(ext.estado.metaEnvios.length, 1);
    assert.deepEqual((await chamar(jwt, { pedido_id: pedido.id, evento: "confirmado", forcar: true })).corpo, { enviado: true });
    assert.equal(ext.estado.metaEnvios.length, 2);
    assert.equal((await chamar(jwt, { pedido_id: pedido.id, evento: "pronto" })).corpo.motivo, "status_mudou");
  });

  it("erros da Meta viram frases em português e ficam no histórico como erro", async () => {
    const outro = (await pedirMaria()).pedido;
    await painel.patch(`/pedidos/${outro.id}/status`, { status: "confirmado", nota: "" });
    ext.estado.falhas.meta = { code: 132001, message: "Template name does not exist in the translation" };
    const r = await chamar(await jwtDe(atendente), { pedido_id: outro.id, evento: "confirmado" });
    assert.equal(r.corpo.enviado, false);
    assert.match(r.corpo.erro, /modelo de mensagem não existe/);
    assert.equal((await painel.get(`/pedidos/${outro.id}/avisos`)).avisos[0].estado, "erro");
    ext.estado.falhas.meta = { code: 999999, message: "coisa nova", error_data: { details: "detalhe da Meta" } };
    assert.match(traduzirErroMeta(ext.estado.falhas.meta), /detalhe da Meta/);
    assert.match(traduzirErroMeta({ code: 131026 }), /não tem WhatsApp/);
    assert.match(traduzirErroMeta({ code: 190 }), /venceu/);
    ext.estado.falhas.meta = null;
    assert.equal((await chamar(await jwtDe(atendente), { pedido_id: outro.id, evento: "confirmado" })).corpo.enviado, true, "erro não impede tentar de novo");
  });
});

describe("CORS das funções", () => {
  it("só os endereços da loja e do painel, quando configurados", () => {
    assert.equal(cabecalhosCors("https://qualquer.com", "")["Access-Control-Allow-Origin"], "*");
    const lista = "https://loja.exemplo, https://painel.exemplo/";
    assert.equal(cabecalhosCors("https://loja.exemplo", lista)["Access-Control-Allow-Origin"], "https://loja.exemplo");
    assert.equal(cabecalhosCors("https://painel.exemplo", lista)["Access-Control-Allow-Origin"], "https://painel.exemplo");
    assert.equal(cabecalhosCors("https://invasor.com", lista)["Access-Control-Allow-Origin"], undefined);
    assert.match(cabecalhosCors("https://loja.exemplo", lista)["Access-Control-Allow-Headers"], /authorization/);
  });
});
