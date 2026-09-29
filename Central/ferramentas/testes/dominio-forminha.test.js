/* ==========================================================
   DOMÍNIO DA FORMINHA (ex.: forminha.com.br) E ENDEREÇOS DAS LOJAS
     - a Central liga a raiz e o "www" no projeto dela e diz os
       registros de DNS (incluindo o coringa "*" das lojas);
     - quando a raiz funciona, os links novos (pagamento, e-mails)
       usam o domínio;
     - com o coringa pronto, cada loja ganha anadoces.<domínio> e
       anadoces-painel.<domínio> (as novas sozinhas, ao publicar);
     - trocar o nome, nome ocupado, tirar, e o domínio da Forminha
       fica reservado (nenhuma loja usa como domínio próprio).
   ========================================================== */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { criarCentral } from "../../lib/central.js";
import { resumirSenha } from "../../lib/sessao.js";
import { novaChave } from "../../lib/cofre.js";
import { enderecosNaForminha, normalizarSubdominio } from "../../lib/dominios.js";
import { bancoDeTeste, criarSimulado } from "../simulado.js";

let sim, banco, servidor, base, cookie, bia;

async function api(metodo, caminho, corpo, { semCookie = false } = {}) {
  const r = await fetch(`${base}/api/${caminho}`, {
    method: metodo,
    headers: { ...(corpo !== undefined && { "content-type": "application/json" }), ...(!semCookie && cookie && { cookie }) },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const texto = await r.text();
  return { status: r.status, dados: texto ? JSON.parse(texto) : null };
}
const site = (nome) => [...sim.estado.sites.values()].find((s) => s.nome === nome);
const dominiosDo = (nome) => [...(site(nome).dominios?.keys() ?? [])].sort();
const daCentral = () => [...sim.estado.central.dominios.keys()].sort();
async function lojaPronta(nome, email) {
  const loja = (await api("POST", "lojas", { nome, email })).dados;
  let r; do { r = await api("POST", `lojas/${loja.ref}/preparar`, { email }); } while (r.dados.etapa === "tabelas");
  return { ...loja, publicada: (await api("POST", `lojas/${loja.ref}/publicar`, {})).dados };
}
/** O link de pagamento de uma cliente nova (mostra o endereço que a Central está usando). */
let clientes = 0;
async function linkDePagamento(nomeLoja) {
  const r = await api("POST", "clientes", { nome: "Cliente Teste", email: `cliente${++clientes}@doceria.test`, nome_loja: nomeLoja, valor_centavos: 19900 });
  assert.equal(r.status, 200, JSON.stringify(r.dados));
  const id = r.dados.cliente.id;
  return (await api("GET", `clientes/${id}`)).dados.pagamentos[0].link;
}

before(async () => {
  sim = criarSimulado();
  banco = await bancoDeTeste();
  // sem URL_CENTRAL fixa (como na Vercel): o endereço vem do projeto e, depois, do domínio da Forminha
  const env = {
    ...sim.env, CENTRAL_SENHA_HASH: await resumirSenha("senha-do-dono"), SEGREDO_SESSAO: "s".repeat(48), CRON_SECRET: "cron",
    CHAVE_CRIPTOGRAFIA: novaChave(), VERCEL_PROJECT_PRODUCTION_URL: "forminha.vercel.app",
  };
  const central = criarCentral(env, { fetchFn: sim.fetchFn, banco, email: null, mercadoPago: null, esperaBancoMs: 1, agendar: () => {} });
  servidor = createServer((req, res) => central.tratar(req, res));
  await new Promise((ok) => servidor.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${servidor.address().port}`;
  cookie = (await fetch(`${base}/api/entrar`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ senha: "senha-do-dono" }) }))
    .headers.get("set-cookie").split(";")[0];
  await api("PUT", "configuracoes", { valor_padrao_centavos: 19900, pix: { chave: "pix@forminha.test", nome: "Forminha Sistemas", cidade: "Sao Paulo" } });
  bia = await lojaPronta("Doce da Bia", "bia@doceria.test"); // uma loja que já existia antes do domínio
});
after(async () => { servidor?.close(); await sim?.fechar(); await banco?.fechar(); });

describe("regras do nome da loja no endereço", () => {
  it("arruma o que a pessoa digita", () => {
    assert.equal(normalizarSubdominio("Ana Doces"), "ana-doces");
    assert.equal(normalizarSubdominio("  Açúcar & Cia "), "acucar-cia");
    assert.equal(normalizarSubdominio("-ana--doces-"), "ana-doces");
    assert.deepEqual(enderecosNaForminha("ana", "forminha.com.br").map((e) => [e.host, e.site]),
      [["ana.forminha.com.br", "loja"], ["ana-painel.forminha.com.br", "painel"]]);
  });
  it("recusa reservado, vazio e comprido demais", () => {
    for (const ruim of ["", " & ", "www", "painel", "Central", "bia-painel", "x".repeat(51)]) {
      assert.throws(() => normalizarSubdominio(ruim), (e) => e.status === 422 && Boolean(e.campos?.subdominio), `aceitou "${ruim}"`);
    }
  });
});

describe("domínio da Forminha na Central", () => {
  it("sem domínio, nada muda", async () => {
    const r = await api("GET", "dominio");
    assert.equal(r.status, 200, JSON.stringify(r.dados));
    assert.equal(r.dados.dominio, null);
    assert.match(await linkDePagamento("Loja Um"), /^https:\/\/forminha\.vercel\.app\/#\/pagar\//);
    const loja = (await api("GET", `lojas/${bia.ref}/subdominio`)).dados;
    assert.deepEqual([loja.raiz, loja.pronta, loja.subdominio, loja.sugestao], [null, false, null, "doce-da-bia"]);
  });

  it("só o dono mexe; e tem que ser o domínio principal", async () => {
    assert.equal((await api("POST", "dominio", { dominio: "forminha.test" }, { semCookie: true })).status, 401);
    const r = await api("POST", "dominio", { dominio: "loja.forminha.test" });
    assert.equal(r.status, 422);
    assert.match(r.dados.campos.dominio, /principal.*forminha\.test/);
    assert.deepEqual(daCentral(), []);
  });

  it("liga a raiz e o www no projeto da Central e diz os 3 registros", async () => {
    const r = await api("POST", "dominio", { dominio: "https://www.Forminha.test/" });
    assert.equal(r.status, 200, JSON.stringify(r.dados));
    assert.equal(r.dados.dominio, "forminha.test");
    assert.deepEqual([r.dados.situacao, r.dados.ativo, r.dados.coringa], ["aguardando", false, false]);
    assert.deepEqual(daCentral(), ["forminha.test", "www.forminha.test"]);
    assert.equal(sim.estado.central.dominios.get("www.forminha.test").redirect, "forminha.test", "o www leva para a raiz");
    assert.deepEqual(r.dados.enderecos.map((e) => [e.host, e.registros[0].tipo, e.registros[0].nome, e.registros[0].valor]), [
      ["forminha.test", "A", "@", "216.198.79.1"],
      ["www.forminha.test", "CNAME", "www", "d1d4fc829fe7bc7c.vercel-dns-017.com"],
      ["*.forminha.test", "CNAME", "*", "cname.vercel-dns.com"],
    ]);
  });

  it("antes do coringa, as lojas ainda não ganham endereço", async () => {
    const r = await api("POST", `lojas/${bia.ref}/subdominio`, {});
    assert.equal(r.status, 409);
    assert.match(r.dados.erro, /coringa/);
  });

  it("raiz funcionando: a Central passa a usar o domínio nos links", async () => {
    sim.configurarDns("forminha.test", "www.forminha.test");
    const r = await api("POST", "dominio/conferir", {});
    assert.deepEqual([r.dados.situacao, r.dados.ativo, r.dados.coringa, r.dados.url], ["parcial", true, false, "https://forminha.test"]);
    assert.match(await linkDePagamento("Loja Dois"), /^https:\/\/forminha\.test\/#\/pagar\//);
  });

  it("o domínio da Forminha fica reservado", async () => {
    const r = await api("POST", `lojas/${bia.ref}/dominio`, { dominio: "bia.forminha.test" });
    assert.equal(r.status, 422);
    assert.match(r.dados.campos.dominio, /reservado/);
  });

  it("coringa pronto: tudo funcionando", async () => {
    sim.configurarDns("*.forminha.test");
    const r = await api("POST", "dominio/conferir", {});
    assert.deepEqual([r.dados.situacao, r.dados.coringa], ["ok", true]);
  });
});

describe("endereço de cada loja", () => {
  it("loja antiga: ganha o endereço pelo botão e passa a usar em tudo", async () => {
    const painel = site("doce-da-bia-painel");
    const publicacoes = sim.estado.publicacoes.filter((p) => p.projeto === painel.id).length;
    const r = await api("POST", `lojas/${bia.ref}/subdominio`, {});
    assert.equal(r.status, 200, JSON.stringify(r.dados));
    assert.deepEqual([r.dados.subdominio, r.dados.situacao, r.dados.endereco_loja, r.dados.endereco_painel],
      ["doce-da-bia", "ok", "https://doce-da-bia.forminha.test", "https://doce-da-bia-painel.forminha.test"]);
    assert.deepEqual(dominiosDo("doce-da-bia"), ["doce-da-bia.forminha.test"]);
    assert.deepEqual(dominiosDo("doce-da-bia-painel"), ["doce-da-bia-painel.forminha.test"]);
    const projeto = sim.estado.projetos.get(bia.ref);
    assert.equal(projeto.auth.site_url, "https://doce-da-bia.forminha.test", "os links de login voltam para o endereço novo");
    assert.match(projeto.segredos.ORIGENS_PERMITIDAS, /https:\/\/doce-da-bia-painel\.forminha\.test/);
    assert.equal(painel.variaveis.URL_LOJA, "https://doce-da-bia.forminha.test");
    assert.equal(sim.estado.publicacoes.filter((p) => p.projeto === painel.id).length, publicacoes + 1, "o painel é publicado de novo com o link novo");
    const lista = (await api("GET", "lojas")).dados.lojas.find((l) => l.ref === bia.ref);
    assert.deepEqual([lista.loja, lista.subdominio], ["https://doce-da-bia.forminha.test", "doce-da-bia.forminha.test"]);
  });

  it("troca o nome: o endereço antigo sai dos sites", async () => {
    const r = await api("POST", `lojas/${bia.ref}/subdominio`, { subdominio: "Bia Doces" });
    assert.equal(r.status, 200, JSON.stringify(r.dados));
    assert.equal(r.dados.endereco_loja, "https://bia-doces.forminha.test");
    assert.deepEqual(dominiosDo("doce-da-bia"), ["bia-doces.forminha.test"]);
    assert.deepEqual(dominiosDo("doce-da-bia-painel"), ["bia-doces-painel.forminha.test"]);
  });

  it("nome já usado por outro site: avisa no campo e nada muda", async () => {
    sim.estado.sites.set("prj_outro", { id: "prj_outro", nome: "outro-site", variaveis: {}, dominios: new Map([["ocupado.forminha.test", { name: "ocupado.forminha.test", verified: true }]]) });
    const r = await api("POST", `lojas/${bia.ref}/subdominio`, { subdominio: "ocupado" });
    assert.equal(r.status, 409);
    assert.ok(r.dados.campos.subdominio);
    assert.deepEqual(dominiosDo("doce-da-bia"), ["bia-doces.forminha.test"]);
    assert.deepEqual(dominiosDo("doce-da-bia-painel"), ["bia-doces-painel.forminha.test"]);
  });

  it("loja nova: já nasce com o endereço na Forminha", async () => {
    const ana = await lojaPronta("Ana Doces", "ana@doceria.test");
    assert.deepEqual([ana.publicada.loja, ana.publicada.painel], ["https://ana-doces.forminha.test", "https://ana-doces-painel.forminha.test"]);
    assert.equal(sim.estado.projetos.get(ana.ref).auth.site_url, "https://ana-doces.forminha.test");
  });

  it("domínio próprio ativo vale mais que o da Forminha", async () => {
    sim.configurarDns("docedabia.com.br", "www.docedabia.com.br", "painel.docedabia.com.br");
    const r = await api("POST", `lojas/${bia.ref}/dominio`, { dominio: "docedabia.com.br" });
    assert.equal(r.dados.endereco_loja, "https://docedabia.com.br");
    await api("DELETE", `lojas/${bia.ref}/dominio`, {});
    assert.equal((await api("GET", `lojas/${bia.ref}/subdominio`)).dados.endereco_loja, "https://bia-doces.forminha.test", "sem ele, volta para o da Forminha");
  });

  it("tirar: a loja volta para o endereço da Vercel", async () => {
    const r = await api("DELETE", `lojas/${bia.ref}/subdominio`, {});
    assert.equal(r.status, 200, JSON.stringify(r.dados));
    assert.deepEqual([r.dados.subdominio, r.dados.endereco_loja], [null, "https://doce-da-bia.vercel.app"]);
    assert.deepEqual(dominiosDo("doce-da-bia"), []);
    assert.equal(sim.estado.projetos.get(bia.ref).auth.site_url, "https://doce-da-bia.vercel.app");
  });
});

describe("tirar o domínio da Forminha", () => {
  it("a Central volta para o endereço da Vercel", async () => {
    const r = await api("DELETE", "dominio", {});
    assert.equal(r.status, 200, JSON.stringify(r.dados));
    assert.deepEqual(daCentral(), []);
    assert.match(await linkDePagamento("Loja Tres"), /^https:\/\/forminha\.vercel\.app\/#\/pagar\//);
  });
});
