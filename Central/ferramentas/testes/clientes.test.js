/* ==========================================================
   CLIENTES — o caminho inteiro de uma cliente, com Supabase, Vercel,
   Mercado Pago e e-mail simulados (e bancos de verdade em memória):
   cadastro cifrado -> cobrança -> pagamento -> loja criada sozinha
   -> e-mail com o convite -> suporte. E as travas de segurança.
   ========================================================== */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash, createHmac } from "node:crypto";
import { criarCentral } from "../../lib/central.js";
import { resumirSenha } from "../../lib/sessao.js";
import { novaChave } from "../../lib/cofre.js";
import { criarEmail } from "../../lib/email.js";
import { criarMercadoPago } from "../../lib/mercadopago.js";
import { bancoDeTeste, criarSimulado, emailDeTeste } from "../simulado.js";

const SENHA = "senha-da-central-2026";
const ASSINATURA_MP = "segredo-assinatura-mp";
let sim, banco, correio, servidor, base, cookie = "";
const agendados = [];

async function api(metodo, caminho, corpo, { semCookie = false, cabecalhos = {} } = {}) {
  const r = await fetch(base + "/api/" + caminho, {
    method: metodo,
    headers: { ...(corpo !== undefined && { "content-type": "application/json" }), ...(!semCookie && cookie && { cookie }), ...cabecalhos },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const texto = await r.text();
  return { status: r.status, dados: texto ? JSON.parse(texto) : null, texto };
}
const tokenDoLink = (link) => link.split("/").pop();
/** Aviso do Mercado Pago assinado como ele assina. */
function aviso(dataId, segredo = ASSINATURA_MP) {
  const ts = String(Date.now()), requisicao = `req-${dataId}`;
  const v1 = createHmac("sha256", segredo).update(`id:${dataId};request-id:${requisicao};ts:${ts};`).digest("hex");
  return api("POST", `webhook/mercadopago?type=payment&data.id=${dataId}`, { type: "payment", data: { id: dataId } },
    { semCookie: true, cabecalhos: { "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": requisicao } });
}
/** Anda com a criação da loja até ficar pronta (como a Central faz sozinha, chamada após chamada). */
async function ateFicarPronta(id) {
  for (let i = 0; i < 60; i++) {
    const r = await api("POST", `clientes/${id}/avancar`, {});
    assert.equal(r.status, 200, r.texto);
    if (r.dados.cliente.etapa === "pronta") return r.dados;
  }
  assert.fail("a loja não ficou pronta");
}

before(async () => {
  sim = criarSimulado();
  banco = await bancoDeTeste();
  correio = emailDeTeste();
  const env = {
    ...sim.env, CENTRAL_SENHA_HASH: await resumirSenha(SENHA), SEGREDO_SESSAO: "s".repeat(48), CRON_SECRET: "cron-de-teste",
    CHAVE_CRIPTOGRAFIA: novaChave(), MP_WEBHOOK_SECRET: ASSINATURA_MP, URL_CENTRAL: "https://forminha.vercel.app",
  };
  const central = criarCentral(env, {
    fetchFn: sim.fetchFn, banco, esperaBancoMs: 1,
    email: criarEmail({ usuario: "forminha@teste.local", transporte: correio.transporte }),
    mercadoPago: criarMercadoPago({ token: "mp-simulado", fetchFn: sim.fetchFn }),
    agendar: (id) => agendados.push(id),
  });
  servidor = createServer((req, res) => central.tratar(req, res));
  await new Promise((ok) => servidor.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${servidor.address().port}`;
  const login = await fetch(base + "/api/entrar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ senha: SENHA }) });
  cookie = login.headers.get("set-cookie").split(";")[0];
});
after(async () => { servidor?.close(); await sim?.fechar(); await banco?.fechar(); });

describe("configuração e travas", () => {
  it("sem login, nada de clientes nem configurações", async () => {
    for (const [m, c] of [["GET", "clientes"], ["POST", "clientes"], ["GET", "configuracoes"]]) assert.equal((await api(m, c, m === "POST" ? {} : undefined, { semCookie: true })).status, 401);
  });
  it("mostra que banco, e-mail e Mercado Pago estão ligados", async () => {
    const { dados } = await api("GET", "eu");
    assert.deepEqual(dados.recursos, { clientes: true, email: true, email_provedor: "gmail", email_reserva: null, mercado_pago: true, assinatura_mp: true, trocar_senha: true, equipe: true });
  });
  it("sem a sua chave PIX, não dá para cadastrar", async () => {
    const r = await api("POST", "clientes", { nome: "Ana Souza", email: "ana@doceria.com", nome_loja: "Doce da Ana", valor_centavos: 19900 });
    assert.equal(r.status, 409);
    assert.match(r.dados.erro, /chave PIX/);
  });
  it("configurações: valor padrão e chave PIX (nome e cidade obrigatórios junto)", async () => {
    let r = await api("PUT", "configuracoes", { valor_padrao_centavos: 19900, pix: { chave: "pix@forminha.com" } });
    assert.equal(r.status, 422);
    r = await api("PUT", "configuracoes", { valor_padrao_centavos: 19900, pix: { chave: "pix@forminha.com", nome: "Forminha Sistemas", cidade: "Sao Paulo" } });
    assert.equal(r.status, 200);
    assert.equal((await api("GET", "configuracoes")).dados.pix.nome, "Forminha Sistemas");
  });
});

describe("uma cliente do cadastro à loja pronta (PIX automático)", () => {
  let cliente, link;
  it("valida os dados (CPF com dígito errado, e-mail inválido)", async () => {
    const r = await api("POST", "clientes", { nome: "A", email: "x", documento: "12345678900", nome_loja: "D" });
    assert.equal(r.status, 422);
    assert.ok(r.dados.campos.nome && r.dados.campos.email && r.dados.campos.documento && r.dados.campos.nome_loja);
  });

  it("cadastra, gera a cobrança e manda o e-mail com a página de pagamento", async () => {
    const r = await api("POST", "clientes", { nome: "Ana Souza", email: "Ana@Doceria.com", telefone: "(11) 98765-4321", documento: "529.982.247-25", nome_loja: "Doce da Ana" });
    assert.equal(r.status, 200, r.texto);
    cliente = r.dados.cliente;
    link = r.dados.link_pagamento;
    assert.equal(cliente.nome, "Ana Souza");
    assert.equal(cliente.email, "ana@doceria.com");
    assert.equal(cliente.telefone, "11987654321");
    assert.equal(cliente.valor_centavos, 19900, "usou o valor padrão");
    assert.equal(cliente.situacao, "aguardando_pagamento");
    assert.match(link, /^https:\/\/forminha\.vercel\.app\/#\/pagar\/[A-Za-z0-9_-]{32}$/);
    assert.equal(r.dados.email_enviado, true);
    const m = correio.enviados.at(-1);
    assert.equal(m.to, "ana@doceria.com");
    assert.match(m.subject, /Pagamento da sua loja Doce da Ana/);
    assert.ok(m.html.includes(link), "o e-mail leva o link de pagamento");
  });

  it("no banco, os dados pessoais estão CIFRADOS (nada legível)", async () => {
    const [linha] = (await banco.db.query("select * from clientes where id = $1", [cliente.id])).rows;
    const tudo = JSON.stringify(linha);
    for (const aberto of ["Ana Souza", "ana@doceria.com", "11987654321", "52998224725"]) assert.ok(!tudo.includes(aberto), `"${aberto}" apareceu aberto no banco`);
    assert.equal(linha.email_indice.length, 64, "só o índice cego do e-mail");
    const hist = JSON.stringify((await banco.db.query("select texto from historico where cliente_id = $1", [cliente.id])).rows);
    assert.ok(!hist.includes("Cliente cadastrada"), "o histórico também é cifrado");
    const [pag] = (await banco.db.query("select * from pagamentos where cliente_id = $1", [cliente.id])).rows;
    assert.ok(!JSON.stringify(pag).includes(tokenDoLink(link)), "o link de pagamento não fica aberto");
    assert.equal(pag.token_hash, createHash("sha256").update(tokenDoLink(link)).digest("hex"));
  });

  it("e-mail repetido (com outra caixa) é recusado", async () => {
    const r = await api("POST", "clientes", { nome: "Outra Ana", email: "ANA@doceria.com", nome_loja: "Outra loja" });
    assert.equal(r.status, 409);
  });

  it("página de pagamento (pública): valor, PIX e e-mail escondido — sem dados pessoais", async () => {
    const r = await api("GET", `publico/pagamento/${tokenDoLink(link)}`, undefined, { semCookie: true });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.dados.nome_loja, "Doce da Ana");
    assert.equal(r.dados.valor_centavos, 19900);
    assert.equal(r.dados.situacao, "pendente");
    assert.equal(r.dados.automatico, true);
    assert.match(r.dados.pix, /MP-SIMULADO/);
    assert.equal(r.dados.email, "an•••@doceria.com");
    for (const aberto of ["Ana Souza", "ana@doceria.com", "11987654321", "52998224725"]) assert.ok(!r.texto.includes(aberto));
    assert.equal((await api("GET", "publico/pagamento/nao-existe-este-token-1234", undefined, { semCookie: true })).status, 404);
  });

  it("aviso do Mercado Pago com assinatura falsa é recusado; sem pagar, nada muda", async () => {
    const [pag] = (await banco.db.query("select mp_id from pagamentos where cliente_id = $1 and situacao = 'pendente'", [cliente.id])).rows;
    assert.equal((await aviso(pag.mp_id, "assinatura-errada")).status, 401);
    const r = await aviso(pag.mp_id);
    assert.equal(r.status, 200);
    assert.equal(r.dados.ignorado, true, "ainda não pago");
    assert.equal((await api("GET", `clientes/${cliente.id}`)).dados.cliente.situacao, "aguardando_pagamento");
  });

  it("pago no Mercado Pago: a Central confere na API dele e libera (aviso repetido não conta duas vezes)", async () => {
    const [pag] = (await banco.db.query("select mp_id from pagamentos where cliente_id = $1 and situacao = 'pendente'", [cliente.id])).rows;
    sim.aprovarMp(pag.mp_id);
    assert.equal((await aviso(pag.mp_id)).dados.ok, true);
    assert.equal((await aviso(pag.mp_id)).status, 200, "aviso repetido responde bem");
    const d = (await api("GET", `clientes/${cliente.id}`)).dados;
    assert.equal(d.cliente.situacao, "pago");
    assert.equal(d.cliente.etapa, "criar_projeto");
    assert.equal(d.historico.filter((h) => /confirmado pelo Mercado Pago/.test(h.texto)).length, 1);
    assert.ok(agendados.includes(cliente.id), "pediu para continuar a criação sozinha");
  });

  it("a loja é criada sozinha: banco com o código, tabelas, 2 sites, convite e e-mail de boas-vindas", async () => {
    const d = await ateFicarPronta(cliente.id);
    const c = d.cliente;
    assert.match(c.loja_codigo, /^\S{3}-\S{3}-\S{3}$/);
    assert.equal(sim.estado.projetos.get(c.loja_ref).nome, `${c.loja_codigo} · Doce da Ana`);
    assert.equal(c.loja_url, "https://doce-da-ana.vercel.app");
    assert.equal(c.painel_url, "https://doce-da-ana-painel.vercel.app");
    assert.match(c.convite, /^https:\/\/doce-da-ana-painel\.vercel\.app\/#\/convite\/[0-9a-f]{64}$/);
    const m = correio.enviados.at(-1);
    assert.match(m.subject, /Sua loja Doce da Ana está pronta/);
    assert.ok(m.html.includes(c.convite), "o convite vai no e-mail");
    const convites = await sim.estado.projetos.get(c.loja_ref).db.query("select email from public.convites");
    assert.equal(convites.rows[0].email, "ana@doceria.com", "convite preso ao e-mail dela");
    const pub = (await api("GET", `publico/pagamento/${tokenDoLink(link)}`, undefined, { semCookie: true })).dados;
    assert.equal(pub.situacao, "pago");
    assert.equal(pub.loja_pronta, true);
    assert.equal(pub.progresso, 1);
  });

  it("suporte: redefinir senha antes de a dona criar o acesso avisa para mandar o convite", async () => {
    const r = await api("POST", `clientes/${cliente.id}/redefinir-senha`, {});
    assert.equal(r.status, 409);
    assert.match(r.dados.erro, /convite/);
  });

  it("suporte: redefinir senha gera o link, manda por e-mail e a chave administrativa nunca aparece", async () => {
    const c = (await api("GET", `clientes/${cliente.id}`)).dados.cliente;
    const loja = sim.estado.projetos.get(c.loja_ref);
    await loja.db.query("insert into auth.users (email) values ('ana@doceria.com')"); // a dona criou o acesso
    const r = await api("POST", `clientes/${cliente.id}/redefinir-senha`, {});
    assert.equal(r.status, 200, r.texto);
    assert.match(r.dados.link, /type=recovery/);
    assert.ok(r.dados.link.includes(encodeURIComponent("https://doce-da-ana.vercel.app")), "volta para a loja dela");
    assert.equal(r.dados.email_enviado, true);
    assert.ok(!r.texto.includes("segredo"), "a chave administrativa não sai na resposta");
    assert.ok(!JSON.stringify(correio.enviados).includes("service-"), "nem no e-mail");
    assert.ok(sim.estado.segredosLidos.includes(c.loja_ref), "foi lida só na hora");
  });

  it("suporte: convite novo, notas cifradas e edição de telefone", async () => {
    const antes = (await api("GET", `clientes/${cliente.id}`)).dados.cliente.convite;
    const novo = await api("POST", `clientes/${cliente.id}/convite`, {});
    assert.equal(novo.status, 200, novo.texto);
    assert.notEqual(novo.dados.link, antes);
    assert.equal(novo.dados.email_enviado, true);
    await api("POST", `clientes/${cliente.id}/notas`, { texto: "Pediu ajuda para trocar o logo. CPF conferido." });
    const d = (await api("GET", `clientes/${cliente.id}`)).dados;
    assert.ok(d.historico.some((h) => h.tipo === "nota" && /trocar o logo/.test(h.texto)));
    assert.ok(!JSON.stringify((await banco.db.query("select texto from historico")).rows).includes("trocar o logo"));
    const ed = await api("PUT", `clientes/${cliente.id}`, { telefone: "11 91234-5678" });
    assert.equal(ed.dados.cliente.telefone, "11912345678");
    assert.equal((await api("PUT", `clientes/${cliente.id}`, { nome_loja: "Outro nome" })).status, 409, "depois de criada, o nome da loja é da dona");
    assert.equal((await api("POST", `clientes/${cliente.id}/cancelar`, {})).status, 409, "pago não se cancela");
  });
});

describe("PIX manual (você confirma) e a trava contra loja duplicada", () => {
  let bia;
  it("cadastra outra cliente e você confirma o pagamento pelo painel", async () => {
    const r = await api("POST", "clientes", { nome: "Bia Lima", email: "bia@brigaderia.com", nome_loja: "Brigaderia da Bia", valor_centavos: 25000 });
    assert.equal(r.status, 200, r.texto);
    bia = r.dados.cliente;
    const pagamento = r.dados.pagamentos[0];
    assert.match(pagamento.pix_copia_cola, /^000201/, "PIX com a sua chave");
    assert.ok(pagamento.pix_copia_cola.includes("pix@forminha.com"));
  });

  it("duas chamadas ao mesmo tempo nunca criam dois bancos", async () => {
    const [p] = (await banco.db.query("select id from pagamentos where cliente_id = $1 and situacao = 'pendente'", [bia.id])).rows;
    await banco.db.query("update pagamentos set situacao = 'aprovado' where id = $1", [p.id]);
    await banco.db.query("update clientes set situacao = 'pago', etapa = 'criar_projeto' where id = $1", [bia.id]);
    const antes = [...sim.estado.projetos.values()].filter((x) => x.nome.endsWith("Brigaderia da Bia")).length;
    await Promise.all([api("POST", `clientes/${bia.id}/avancar`, {}), api("POST", `clientes/${bia.id}/avancar`, {}), api("POST", `clientes/${bia.id}/avancar`, {})]);
    const depois = [...sim.estado.projetos.values()].filter((x) => x.nome.endsWith("Brigaderia da Bia")).length;
    assert.equal(depois - antes, 1);
    await ateFicarPronta(bia.id);
  });

  it("confirmação manual pelo botão", async () => {
    const r = await api("POST", "clientes", { nome: "Carla Reis", email: "carla@doces.com", nome_loja: "Doces da Carla" });
    const ok = await api("POST", `clientes/${r.dados.cliente.id}/pagamento-recebido`, {});
    assert.equal(ok.status, 200, ok.texto);
    assert.equal(ok.dados.cliente.situacao, "pago");
    assert.ok(ok.dados.historico.some((h) => /confirmado manualmente\. \(Dono\)/.test(h.texto)), "o histórico diz quem confirmou");
    assert.equal((await api("POST", `clientes/${r.dados.cliente.id}/pagamento-recebido`, {})).status, 409, "não confirma duas vezes");
  });

  it("cancelar antes do pagamento", async () => {
    const r = await api("POST", "clientes", { nome: "Duda Alves", email: "duda@bolos.com", nome_loja: "Bolos da Duda" });
    const c = await api("POST", `clientes/${r.dados.cliente.id}/cancelar`, {});
    assert.equal(c.dados.cliente.situacao, "cancelado");
    const pub = await api("GET", `publico/pagamento/${tokenDoLink(r.dados.link_pagamento)}`, undefined, { semCookie: true });
    assert.equal(pub.dados.situacao, "cancelado");
  });

  it("a continuação interna e o agendador exigem a senha interna", async () => {
    assert.equal((await api("POST", "interno/avancar", { id: bia.id }, { semCookie: true })).status, 401);
    assert.equal((await api("GET", "manter-ativo", undefined, { semCookie: true })).status, 401);
    const r = await api("GET", "manter-ativo", undefined, { semCookie: true, cabecalhos: { authorization: "Bearer cron-de-teste" } });
    assert.equal(r.status, 200);
    assert.equal(typeof r.dados.criacoes_retomadas, "number");
  });

  it("a lista mostra as clientes com nome aberto só para você", async () => {
    const { dados } = await api("GET", "clientes");
    assert.ok(dados.clientes.length >= 4);
    const ana = dados.clientes.find((c) => c.email === "ana@doceria.com");
    assert.equal(ana.etapa, "pronta");
    assert.equal(ana.nome, "Ana Souza");
  });
});
