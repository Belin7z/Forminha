/* ==========================================================
   DOMÍNIO PRÓPRIO DAS LOJAS (ex.: docedabia.com.br):
     - o domínio digitado é arrumado (sem https, sem www) e conferido;
     - ligar põe o domínio, o "www" (atalho) e "painel." nos 2 sites e
       devolve os registros de DNS que a dona precisa criar;
     - só quando o DNS fica certo a loja passa a usar o domínio (login,
       funções, painel e o cadastro da cliente acompanham);
     - domínio que já passou por outra conta pede o registro TXT;
     - trocar e tirar o domínio devolvem tudo ao que era;
     - a dona faz o mesmo pelo painel dela, com o login dela.
   ========================================================== */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { criarCentral } from "../../lib/central.js";
import { resumirSenha } from "../../lib/sessao.js";
import { novaChave } from "../../lib/cofre.js";
import { enderecosDoDominio, normalizarDominio, raizDoDominio, registroDoEndereco } from "../../lib/dominios.js";
import { bancoDeTeste, criarSimulado } from "../simulado.js";

let sim, banco, servidor, base, cookie, loja, clienteId;

async function api(metodo, caminho, corpo, { semCookie = false, cabecalhos = {} } = {}) {
  const r = await fetch(`${base}/api/${caminho}`, {
    method: metodo,
    headers: { ...(corpo !== undefined && { "content-type": "application/json" }), ...(!semCookie && cookie && { cookie }), ...cabecalhos },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const texto = await r.text();
  return { status: r.status, dados: texto ? JSON.parse(texto) : null, cabecalhos: r.headers };
}
const site = (nome) => [...sim.estado.sites.values()].find((s) => s.nome === nome);
const dominiosDo = (nome) => [...(site(nome).dominios?.keys() ?? [])].sort();
const projeto = () => sim.estado.projetos.get(loja.ref);
const publicacoesDoPainel = () => sim.estado.publicacoes.filter((p) => p.projeto === site("doce-da-bia-painel").id).length;

before(async () => {
  sim = criarSimulado();
  banco = await bancoDeTeste();
  const env = {
    ...sim.env, CENTRAL_SENHA_HASH: await resumirSenha("senha-do-dono"), SEGREDO_SESSAO: "s".repeat(48), CRON_SECRET: "cron",
    CHAVE_CRIPTOGRAFIA: novaChave(), URL_CENTRAL: "https://forminha.vercel.app",
  };
  const central = criarCentral(env, { fetchFn: sim.fetchFn, banco, email: null, mercadoPago: null, esperaBancoMs: 1 });
  servidor = createServer((req, res) => central.tratar(req, res));
  await new Promise((ok) => servidor.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${servidor.address().port}`;
  cookie = (await fetch(`${base}/api/entrar`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ senha: "senha-do-dono" }) }))
    .headers.get("set-cookie").split(";")[0];
  // uma loja pronta (banco, tabelas e sites)
  loja = (await api("POST", "lojas", { nome: "Doce da Bia", email: "bia@doceria.com" })).dados;
  let r; do { r = await api("POST", `lojas/${loja.ref}/preparar`, { email: "bia@doceria.com" }); } while (r.dados.etapa === "tabelas");
  await api("POST", `lojas/${loja.ref}/publicar`, {});
  // e a cliente dona dela no cadastro da Central
  await api("PUT", "configuracoes", { valor_padrao_centavos: 19900, pix: { chave: "pix@forminha.com", nome: "Forminha Sistemas", cidade: "Sao Paulo" } });
  clienteId = (await api("POST", "clientes", { nome: "Bia Lima", email: "bia@doceria.com", nome_loja: "Doce da Bia", valor_centavos: 19900 })).dados.cliente.id;
  await banco.consultar("update clientes set loja_ref = $2, loja_url = $3, painel_url = $4 where id = $1",
    [clienteId, loja.ref, "https://doce-da-bia.vercel.app", "https://doce-da-bia-painel.vercel.app"]);
});
after(async () => { servidor?.close(); await sim?.fechar(); await banco?.fechar(); });

describe("regras do domínio", () => {
  it("arruma o que a pessoa digita", () => {
    assert.equal(normalizarDominio("https://www.DoceDaBia.com.br/"), "docedabia.com.br");
    assert.equal(normalizarDominio("  anaconfeitaria.com "), "anaconfeitaria.com");
    assert.equal(normalizarDominio("loja.doce.com.br"), "loja.doce.com.br");
    assert.equal(normalizarDominio("doçura.com.br"), "xn--doura-zra.com.br", "acento vira o formato da internet");
  });

  it("recusa o que não é domínio, o que não é de ninguém e o reservado", () => {
    for (const ruim of ["", "doce", "com.br", "doce..com", "doce_bia.com", "1.2.3.4", "bia@doce.com.br", "minha-loja.vercel.app", "x.supabase.co", "localhost"]) {
      assert.throws(() => normalizarDominio(ruim), (e) => e.status === 422 && Boolean(e.campos?.dominio), `aceitou "${ruim}"`);
    }
    assert.throws(() => normalizarDominio("loja.forminha.com.br", { reservados: ["forminha.com.br"] }), /reservado/);
    assert.equal(normalizarDominio("forminhadabia.com.br", { reservados: ["forminha.com.br"] }), "forminhadabia.com.br");
  });

  it("sabe a raiz e os endereços que o domínio ocupa", () => {
    assert.equal(raizDoDominio("doce.com.br"), "doce.com.br");
    assert.equal(raizDoDominio("loja.doce.com.br"), "doce.com.br");
    assert.equal(raizDoDominio("doce.com"), "doce.com");
    assert.deepEqual(enderecosDoDominio("doce.com").map((e) => e.host), ["doce.com", "www.doce.com", "painel.doce.com"]);
    assert.deepEqual(enderecosDoDominio("loja.doce.com.br", { painel: false }).map((e) => e.host), ["loja.doce.com.br"], "subdomínio não ganha www");
  });

  it("registros de DNS: o que a Vercel recomenda, ou o padrão dela", () => {
    const cfg = { recommendedIPv4: [{ rank: 2, value: ["76.76.21.21"] }, { rank: 1, value: ["216.198.79.1"] }], recommendedCNAME: [{ rank: 1, value: "abc.vercel-dns-017.com." }] };
    assert.deepEqual(registroDoEndereco("doce.com", "doce.com", cfg), { tipo: "A", nome: "@", valor: "216.198.79.1" });
    assert.deepEqual(registroDoEndereco("www.doce.com", "doce.com", cfg), { tipo: "CNAME", nome: "www", valor: "abc.vercel-dns-017.com" });
    assert.deepEqual(registroDoEndereco("loja.doce.com.br", "doce.com.br", null), { tipo: "CNAME", nome: "loja", valor: "cname.vercel-dns.com" });
    assert.deepEqual(registroDoEndereco("doce.com", "doce.com", {}), { tipo: "A", nome: "@", valor: "76.76.21.21" });
  });
});

describe("ligar o domínio pela Central", () => {
  it("sem domínio: mostra só os endereços da Vercel", async () => {
    const r = await api("GET", `lojas/${loja.ref}/dominio`);
    assert.equal(r.status, 200, JSON.stringify(r.dados));
    assert.deepEqual(r.dados, { dominio: null, endereco_loja: "https://doce-da-bia.vercel.app", endereco_painel: "https://doce-da-bia-painel.vercel.app", mudou: false });
  });

  it("domínio errado volta no campo, sem mexer em nada", async () => {
    const r = await api("POST", `lojas/${loja.ref}/dominio`, { dominio: "docedabia" });
    assert.equal(r.status, 422);
    assert.ok(r.dados.campos.dominio);
    assert.deepEqual(dominiosDo("doce-da-bia"), []);
  });

  it("liga domínio, www e painel nos sites e diz quais registros criar", async () => {
    const antes = publicacoesDoPainel();
    const r = await api("POST", `lojas/${loja.ref}/dominio`, { dominio: "https://www.DoceDaBia.com.br/" });
    assert.equal(r.status, 200, JSON.stringify(r.dados));
    assert.equal(r.dados.dominio, "docedabia.com.br");
    assert.equal(r.dados.situacao, "aguardando");
    assert.equal(r.dados.ativo, false);
    assert.deepEqual(r.dados.enderecos.map((e) => [e.host, e.site, e.ok]),
      [["docedabia.com.br", "loja", false], ["www.docedabia.com.br", "loja", false], ["painel.docedabia.com.br", "painel", false]]);
    assert.deepEqual(r.dados.enderecos.map((e) => e.registros[0]), [
      { tipo: "A", nome: "@", valor: "216.198.79.1", ok: false },
      { tipo: "CNAME", nome: "www", valor: "d1d4fc829fe7bc7c.vercel-dns-017.com", ok: false },
      { tipo: "CNAME", nome: "painel", valor: "d1d4fc829fe7bc7c.vercel-dns-017.com", ok: false },
    ]);
    assert.deepEqual(dominiosDo("doce-da-bia"), ["docedabia.com.br", "www.docedabia.com.br"]);
    assert.equal(site("doce-da-bia").dominios.get("www.docedabia.com.br").redirect, "docedabia.com.br", "www leva para o principal");
    assert.deepEqual(dominiosDo("doce-da-bia-painel"), ["painel.docedabia.com.br"]);
    // ainda não funciona: a loja continua no endereço da Vercel, mas o login já aceita voltar para o domínio
    assert.equal(r.dados.endereco_loja, "https://doce-da-bia.vercel.app");
    const p = projeto();
    assert.equal(p.auth.site_url, "https://doce-da-bia.vercel.app");
    assert.match(p.auth.uri_allow_list, /https:\/\/docedabia\.com\.br\/\*\*/);
    assert.match(p.auth.uri_allow_list, /https:\/\/painel\.docedabia\.com\.br\/\*\*/);
    assert.match(p.segredos.ORIGENS_PERMITIDAS, /https:\/\/docedabia\.com\.br/);
    assert.equal(publicacoesDoPainel(), antes, "o painel só é publicado de novo quando o endereço da loja muda");
  });

  it("conferir sem o DNS pronto: continua aguardando", async () => {
    const r = await api("POST", `lojas/${loja.ref}/dominio/conferir`, {});
    assert.equal(r.status, 200);
    assert.equal(r.dados.situacao, "aguardando");
    assert.equal(r.dados.mudou, false);
  });

  it("com o DNS certo, a loja passa a usar o domínio em tudo", async () => {
    sim.configurarDns("docedabia.com.br", "www.docedabia.com.br");
    const antes = publicacoesDoPainel();
    const r = await api("POST", `lojas/${loja.ref}/dominio/conferir`, {});
    assert.equal(r.dados.situacao, "parcial", "falta o painel");
    assert.equal(r.dados.ativo, true);
    assert.equal(r.dados.mudou, true);
    assert.equal(r.dados.endereco_loja, "https://docedabia.com.br");
    assert.equal(r.dados.endereco_painel, "https://doce-da-bia-painel.vercel.app");
    const p = projeto();
    assert.equal(p.auth.site_url, "https://docedabia.com.br", "links dos e-mails de login");
    assert.equal(p.segredos.URL_LOJA, "https://docedabia.com.br", "links do WhatsApp");
    assert.equal(site("doce-da-bia-painel").variaveis.URL_LOJA, "https://docedabia.com.br", "o link \"ver loja\" do painel");
    assert.equal(publicacoesDoPainel(), antes + 1);
    const lista = (await api("GET", "lojas")).dados.lojas.find((l) => l.ref === loja.ref);
    assert.equal(lista.loja, "https://docedabia.com.br");
    assert.equal(lista.dominio, "docedabia.com.br");
    const ficha = (await api("GET", `clientes/${clienteId}`)).dados;
    assert.equal(ficha.cliente.loja_url, "https://docedabia.com.br", "o cadastro da cliente acompanha");
    assert.ok(ficha.historico.some((h) => /Endereço da loja: https:\/\/docedabia\.com\.br/.test(h.texto)));
  });

  it("com o painel também certo: só de abrir a tela o painel passa para o domínio, e o convite já vai por ele", async () => {
    sim.configurarDns("painel.docedabia.com.br");
    const r = await api("GET", `lojas/${loja.ref}/dominio`);
    assert.equal(r.dados.situacao, "ok");
    assert.equal(r.dados.mudou, true);
    assert.equal(r.dados.endereco_painel, "https://painel.docedabia.com.br");
    const convite = await api("POST", `lojas/${loja.ref}/convite`, {});
    assert.match(convite.dados.link, /^https:\/\/painel\.docedabia\.com\.br\/#\/convite\//);
    assert.equal((await api("GET", `clientes/${clienteId}`)).dados.cliente.painel_url, "https://painel.docedabia.com.br");
  });

  it("sem o painel no domínio: tira só o painel.", async () => {
    const r = await api("POST", `lojas/${loja.ref}/dominio`, { dominio: "docedabia.com.br", painel: false });
    assert.equal(r.status, 200, JSON.stringify(r.dados));
    assert.deepEqual(dominiosDo("doce-da-bia-painel"), []);
    assert.deepEqual(dominiosDo("doce-da-bia"), ["docedabia.com.br", "www.docedabia.com.br"]);
    assert.equal(r.dados.situacao, "ok");
    assert.equal(r.dados.endereco_loja, "https://docedabia.com.br", "a loja continua no domínio");
    assert.equal(r.dados.endereco_painel, "https://doce-da-bia-painel.vercel.app");
  });

  it("domínio já usado em outro site da Vercel: recusa", async () => {
    sim.estado.sites.set("prj_outro", { id: "prj_outro", nome: "outro-site", variaveis: {}, dominios: new Map([["ocupado.com.br", { name: "ocupado.com.br", verified: true }]]) });
    const r = await api("POST", `lojas/${loja.ref}/dominio`, { dominio: "ocupado.com.br" });
    assert.equal(r.status, 409);
    assert.match(r.dados.erro, /outro site/);
  });
});

describe("trocar para um domínio que pede verificação (TXT)", () => {
  it("troca: tira o antigo e a loja volta para a Vercel até o novo funcionar", async () => {
    sim.estado.dominiosDeOutraConta.add("biadoces.com");
    const antes = publicacoesDoPainel();
    const r = await api("POST", `lojas/${loja.ref}/dominio`, { dominio: "biadoces.com" });
    assert.equal(r.status, 200, JSON.stringify(r.dados));
    assert.deepEqual(dominiosDo("doce-da-bia"), ["biadoces.com", "www.biadoces.com"]);
    assert.equal(r.dados.endereco_loja, "https://doce-da-bia.vercel.app");
    assert.equal(site("doce-da-bia-painel").variaveis.URL_LOJA, "https://doce-da-bia.vercel.app");
    assert.equal(publicacoesDoPainel(), antes + 1);
    assert.equal(projeto().auth.site_url, "https://doce-da-bia.vercel.app");
    assert.doesNotMatch(projeto().auth.uri_allow_list, /docedabia/);
    const txt = r.dados.enderecos[0].registros.find((x) => x.tipo === "TXT");
    assert.deepEqual(txt, { tipo: "TXT", nome: "_vercel", valor: "vc-domain-verify=biadoces.com,simulado", ok: false });
  });

  it("DNS certo sem o TXT não basta; com o TXT, funciona", async () => {
    sim.configurarDns("biadoces.com", "www.biadoces.com", "painel.biadoces.com");
    let r = await api("POST", `lojas/${loja.ref}/dominio/conferir`, {});
    assert.equal(r.dados.situacao, "aguardando");
    sim.configurarDns("_vercel.biadoces.com");
    r = await api("POST", `lojas/${loja.ref}/dominio/conferir`, {});
    assert.equal(r.dados.situacao, "ok");
    assert.equal(r.dados.endereco_loja, "https://biadoces.com");
  });

  it("tirar o domínio devolve a loja para a Vercel", async () => {
    const r = await api("DELETE", `lojas/${loja.ref}/dominio`, {});
    assert.equal(r.status, 200, JSON.stringify(r.dados));
    assert.equal(r.dados.dominio, null);
    assert.deepEqual(dominiosDo("doce-da-bia"), []);
    assert.deepEqual(dominiosDo("doce-da-bia-painel"), []);
    assert.equal(projeto().auth.site_url, "https://doce-da-bia.vercel.app");
    assert.equal(projeto().auth.uri_allow_list, "https://doce-da-bia.vercel.app/**,https://doce-da-bia-painel.vercel.app/**");
    assert.equal(site("doce-da-bia-painel").variaveis.URL_LOJA, "https://doce-da-bia.vercel.app");
    assert.equal((await api("GET", `clientes/${clienteId}`)).dados.cliente.loja_url, "https://doce-da-bia.vercel.app");
  });
});

describe("a dona liga pelo painel dela", () => {
  const daDona = (metodo, caminho, corpo, papel = "admin") => api(metodo, caminho, corpo, {
    semCookie: true, cabecalhos: { authorization: `Bearer ${sim.tokenDaLoja(loja.ref, papel)}`, origin: "https://doce-da-bia-painel.vercel.app" },
  });

  it("o painel (outro endereço) pode pedir, inclusive para tirar", async () => {
    const pre = await fetch(`${base}/api/loja/dominio`, { method: "OPTIONS", headers: { origin: "https://doce-da-bia-painel.vercel.app" } });
    assert.equal(pre.status, 204);
    assert.match(pre.headers.get("access-control-allow-methods"), /DELETE/);
  });

  it("vê, liga, confere e tira com o login de administradora", async () => {
    let r = await daDona("GET", "loja/dominio");
    assert.equal(r.status, 200, JSON.stringify(r.dados));
    assert.equal(r.dados.dominio, null);
    r = await daDona("POST", "loja/dominio", { dominio: "anaconfeitaria.com" });
    assert.equal(r.status, 200, JSON.stringify(r.dados));
    assert.equal(r.dados.dominio, "anaconfeitaria.com");
    assert.equal(r.cabecalhos.get("access-control-allow-origin"), "*");
    sim.configurarDns("anaconfeitaria.com", "www.anaconfeitaria.com");
    r = await daDona("POST", "loja/dominio/conferir", {});
    assert.equal(r.dados.endereco_loja, "https://anaconfeitaria.com");
    r = await daDona("DELETE", "loja/dominio", {});
    assert.equal(r.status, 200);
    assert.equal(r.dados.dominio, null);
  });

  it("recusa quem não é administradora e quem não está logada", async () => {
    assert.equal((await daDona("POST", "loja/dominio", { dominio: "golpe.com.br" }, "cliente")).status, 403);
    assert.equal((await daDona("GET", "loja/dominio", undefined, "cliente")).status, 403);
    assert.equal((await api("GET", "loja/dominio", undefined, { semCookie: true })).status, 401);
    assert.deepEqual(dominiosDo("doce-da-bia"), []);
  });
});
