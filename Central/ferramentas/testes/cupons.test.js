/* ==========================================================
   CUPONS E INDICAÇÃO
     - desconto em % ou em R$ (nunca abaixo de R$ 1,00), validade e
       limite de usos; o uso é reservado no cadastro e volta se ela
       cancelar; só o dono cria, quem vende confere e aplica;
     - indicação: a cliente que pagou tem um código; quem usa ganha o
       desconto da indicação e, ao pagar, quem indicou ganha crédito.
   ========================================================== */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { criarCentral } from "../../lib/central.js";
import { resumirSenha } from "../../lib/sessao.js";
import { novaChave } from "../../lib/cofre.js";
import { descontoDe, normalizarCodigo } from "../../lib/cupons.js";
import { bancoDeTeste, criarSimulado } from "../simulado.js";

const SENHA_DONO = "senha-do-dono";
let sim, banco, servidor, base, dono, vendedora;
const cupomId = {};

async function api(metodo, caminho, corpo, cookie = dono) {
  const r = await fetch(`${base}/api/${caminho}`, {
    method: metodo,
    headers: { ...(corpo !== undefined && { "content-type": "application/json" }), ...(cookie && { cookie }) },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const texto = await r.text();
  return { status: r.status, dados: texto ? JSON.parse(texto) : null, cookie: r.headers.get("set-cookie")?.split(";")[0] };
}
const entrar = (usuario, senha) => api("POST", "entrar", { usuario, senha }, null);
const ontem = () => new Date(Date.now() - 3 * 3600_000 - 86400_000).toISOString().slice(0, 10);
const cadastrar = (n, extra = {}, cookie = vendedora) =>
  api("POST", "clientes", { nome: `Cliente ${n}`, email: `c${n}@doceria.com`, nome_loja: `Doce ${n}`, valor_centavos: 19900, ...extra }, cookie);
const usosDe = async (codigo) => (await api("GET", "cupons")).dados.cupons.find((c) => c.codigo === codigo)?.usos;

before(async () => {
  sim = criarSimulado();
  banco = await bancoDeTeste();
  const env = {
    ...sim.env, CENTRAL_EMAIL: "dono@teste.local", CENTRAL_SENHA_HASH: await resumirSenha(SENHA_DONO), SEGREDO_SESSAO: "s".repeat(48),
    CRON_SECRET: "cron", CHAVE_CRIPTOGRAFIA: novaChave(), URL_CENTRAL: "https://forminha.vercel.app",
  };
  const central = criarCentral(env, { fetchFn: sim.fetchFn, banco, esperaBancoMs: 1, email: null, mercadoPago: null, agendar: () => {} });
  servidor = createServer((req, res) => central.tratar(req, res));
  await new Promise((ok) => servidor.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${servidor.address().port}`;
  dono = (await entrar("dono@teste.local", SENHA_DONO)).cookie;
  await api("PUT", "configuracoes", { valor_padrao_centavos: 19900, pix: { chave: "pix@forminha.test", nome: "Forminha", cidade: "Sao Paulo" } });
  const { dados } = await api("POST", "equipe", { nome: "Vera Vendas", funcao: "vendedor" });
  const temp = await entrar(dados.funcionario.usuario, dados.senha_temporaria);
  vendedora = (await api("POST", "minha-senha", { atual: dados.senha_temporaria, nova: "minha-senha-123", repita: "minha-senha-123" }, temp.cookie)).cookie;
});
after(async () => { servidor?.close(); await sim?.fechar(); await banco?.fechar(); });

describe("regras do desconto", () => {
  it("% ou R$, e a loja nunca sai por menos de R$ 1,00", () => {
    assert.equal(descontoDe({ tipo: "percentual", valor: 10 }, 19900), 1990);
    assert.equal(descontoDe({ tipo: "valor", valor: 2000 }, 19900), 2000);
    assert.equal(descontoDe({ tipo: "valor", valor: 50000 }, 19900), 19800);
    assert.equal(normalizarCodigo(" promo  dez "), "PROMODEZ");
    assert.equal(normalizarCodigo("Açúcar10"), "ACUCAR10");
  });
});

describe("cupons (o dono cria)", () => {
  it("cria % e R$, com validade e limite; código repetido ou estranho volta no campo", async () => {
    let r = await api("POST", "cupons", { codigo: "promo10", tipo: "percentual", valor: 10 });
    assert.equal(r.status, 200, JSON.stringify(r.dados));
    assert.equal(r.dados.codigo, "PROMO10");
    assert.equal(r.dados.descricao, "10% de desconto");
    cupomId.promo = r.dados.id;
    r = await api("POST", "cupons", { codigo: "VALE20", tipo: "valor", valor: 2000, validade: ontem() });
    assert.match(r.dados.descricao, /R\$\s?20,00 de desconto/);
    cupomId.vale = r.dados.id;
    cupomId.limite = (await api("POST", "cupons", { codigo: "LIMITE1", tipo: "percentual", valor: 5, max_usos: 1 })).dados.id;
    assert.equal((await api("POST", "cupons", { codigo: "PROMO10", tipo: "percentual", valor: 5 })).status, 409);
    assert.ok((await api("POST", "cupons", { codigo: "a", tipo: "percentual", valor: 5 })).dados.campos.codigo);
    assert.ok((await api("POST", "cupons", { codigo: "DEMAIS", tipo: "percentual", valor: 95 })).dados.campos.valor);
  });

  it("quem vende confere o cupom, mas não mexe nos cupons", async () => {
    const r = await api("GET", "cupons/conferir?codigo=promo10&valor=19900", undefined, vendedora);
    assert.equal(r.status, 200);
    assert.deepEqual({ ...r.dados, indicacao_de: undefined }, { codigo: "PROMO10", descricao: "10% de desconto", desconto_centavos: 1990, valor_final: 17910, indicacao_de: undefined });
    assert.equal((await api("GET", "cupons", undefined, vendedora)).status, 403);
    assert.equal((await api("POST", "cupons", { codigo: "MEU50", tipo: "percentual", valor: 50 }, vendedora)).status, 403);
  });

  it("cadastro com cupom: cobra com desconto, anota e reserva um uso", async () => {
    const r = await cadastrar(1, { cupom: "Promo10" });
    assert.equal(r.status, 200, JSON.stringify(r.dados));
    assert.equal(r.dados.cliente.valor_centavos, 17910);
    assert.equal(r.dados.cliente.cupom, "PROMO10");
    assert.equal(r.dados.cliente.desconto_centavos, 1990);
    assert.equal(r.dados.pagamentos[0].valor_centavos, 17910, "a cobrança já sai com desconto");
    assert.ok(r.dados.historico.some((h) => /Cupom PROMO10 aplicado: 10% de desconto/.test(h.texto)));
    assert.equal(await usosDe("PROMO10"), 1);
    const token = r.dados.link_pagamento.split("/").pop();
    const pagina = (await api("GET", `publico/pagamento/${token}`, undefined, null)).dados;
    assert.equal(pagina.desconto_centavos, 1990, "a página de pagamento mostra o desconto");
  });

  it("vencido, esgotado ou desligado: recusa sem criar nada", async () => {
    let r = await cadastrar(2, { cupom: "VALE20" });
    assert.equal(r.status, 422);
    assert.match(r.dados.campos.cupom, /venceu/);
    assert.equal((await cadastrar(2, { cupom: "LIMITE1" })).status, 200);
    r = await cadastrar(3, { cupom: "LIMITE1" });
    assert.match(r.dados.campos.cupom, /máximo/);
    await api("PUT", `cupons/${cupomId.promo}`, { ativo: false });
    assert.match((await cadastrar(3, { cupom: "PROMO10" })).dados.campos.cupom, /desligado/);
    assert.equal((await cadastrar(3)).status, 200, "o e-mail ficou livre: nada foi criado nas recusas");
  });

  it("cancelar devolve o uso do cupom", async () => {
    const lista = (await api("GET", "clientes")).dados.clientes;
    const c2 = lista.find((c) => c.nome_loja === "Doce 2");
    await api("POST", `clientes/${c2.id}/cancelar`, {});
    assert.equal(await usosDe("LIMITE1"), 0);
    assert.equal((await cadastrar(4, { cupom: "LIMITE1" })).status, 200);
  });

  it("apagar só o que nunca foi usado", async () => {
    assert.equal((await api("DELETE", `cupons/${cupomId.limite}`, {})).status, 409);
    assert.equal((await api("DELETE", `cupons/${cupomId.vale}`, {})).status, 200);
  });
});

describe("indicação", () => {
  let ana, bia;
  it("o código aparece depois que a cliente paga", async () => {
    ana = (await cadastrar(10, { nome_loja: "Doce da Ana" }, dono)).dados.cliente.id;
    assert.equal((await api("POST", `clientes/${ana}/indicacao`, {})).status, 409);
    await api("POST", `clientes/${ana}/pagamento-recebido`, {});
    const r = await api("POST", `clientes/${ana}/indicacao`, {});
    assert.equal(r.status, 200, JSON.stringify(r.dados));
    assert.equal(r.dados.codigo, "DOCEDAANA");
    assert.deepEqual([r.dados.desconto_pct, r.dados.recompensa_centavos, r.dados.credito_centavos], [10, 5000, 0]);
    assert.equal((await api("POST", `clientes/${ana}/indicacao`, {})).dados.codigo, "DOCEDAANA", "sempre o mesmo código");
  });

  it("a indicada ganha o desconto; quando paga, quem indicou ganha o crédito", async () => {
    const r = await cadastrar(11, { nome_loja: "Doce da Bia", cupom: "docedaana" });
    bia = r.dados.cliente.id;
    assert.equal(r.dados.cliente.valor_centavos, 17910);
    assert.equal(r.dados.cliente.indicada_por, ana);
    assert.ok(r.dados.historico.some((h) => /Veio por indicação de Doce da Ana/.test(h.texto)));
    await api("POST", `clientes/${bia}/pagamento-recebido`, {});
    const ind = (await api("POST", `clientes/${ana}/indicacao`, {})).dados;
    assert.equal(ind.credito_centavos, 5000);
    assert.deepEqual(ind.indicadas.map((i) => i.nome_loja), ["Doce da Bia"]);
    const ficha = (await api("GET", `clientes/${ana}`)).dados;
    assert.equal(ficha.cliente.credito_centavos, 5000);
    assert.ok(ficha.historico.some((h) => /Indicou Doce da Bia: ganhou R\$\s?50,00 de crédito/.test(h.texto)));
    assert.ok((await api("GET", "avisos", undefined, vendedora)).dados.avisos.some((a) => a.titulo === "Indicação: Doce da Ana trouxe Doce da Bia"));
  });

  it("o dono muda as regras da indicação e os códigos acompanham", async () => {
    assert.equal((await api("PUT", "indicacao", { desconto_pct: 15, recompensa_centavos: 3000 }, vendedora)).status, 403);
    assert.ok((await api("PUT", "indicacao", { desconto_pct: 95, recompensa_centavos: 0 })).dados.campos.desconto_pct);
    const r = await api("PUT", "indicacao", { desconto_pct: 15, recompensa_centavos: 3000 });
    assert.deepEqual(r.dados, { desconto_pct: 15, recompensa_centavos: 3000 });
    assert.equal((await api("GET", "cupons/conferir?codigo=DOCEDAANA&valor=10000", undefined, vendedora)).dados.desconto_centavos, 1500);
    const lista = (await api("GET", "cupons")).dados;
    assert.ok(lista.cupons.every((c) => !c.indicacao), "os códigos de indicação não se misturam com os cupons");
    assert.deepEqual([lista.indicacao.codigos, lista.indicacao.usos], [1, 1]);
  });
});
