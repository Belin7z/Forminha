/* ==========================================================
   BORDA — personalização na hora (um site para várias lojas):
     - só com MULTILOJA=1 (senão a página já veio personalizada);
     - a loja do ENDEREÇO: título, descrição e foto do link, cores no
       config.js, aplicativo instalável, ícone, robots e sitemap;
     - o painel ganha o nome da loja no título e no app;
     - banco fora do ar: a página padrão (nada quebra);
     - uma pergunta ao banco por minuto por loja;
     - o link próprio do produto (/p/7-…): foto, nome e preço na
       prévia, também na loja de site próprio (sem MULTILOJA).
   ========================================================== */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { criarPersonalizador } from "../../build/borda.mjs";
import { criarPersonalizador as daLoja } from "../../../Loja/build/borda.mjs";
import { readFileSync } from "node:fs";

const HTML_LOJA = readFileSync(new URL("../../../Loja/index.html", import.meta.url), "utf8");
const HTML_PAINEL = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
const DADOS = {
  bia: { loja: { nome: "Doce da Bia", slogan: "Bolos de festa", logo: "https://x.supabase.co/storage/v1/object/public/site/logo.png" },
    textos: { hero_subtitulo: "Encomendas para aniversários" }, aparencia: { tema: "pistache", fonte: "delicado" } },
  ana: { loja: { nome: "Ana Doces" }, textos: {}, aparencia: { tema: "cereja", fonte: "elegante" } },
};
const CATALOGO = {
  bia: { categorias: [], produtos: [
    { id: 7, nome: "Bolo de Ninho", descricao: "Massa branca & recheio <cremoso>", preco: 120000, imagem: "https://x.supabase.co/storage/v1/object/public/produtos/bolo.jpg",
      opcoes: [{ obrigatorio: true, itens: [{ preco: 3450 }, { preco: 5000 }] }, { obrigatorio: false, itens: [{ preco: 100 }] }] },
    { id: 8, nome: "Brigadeiro", descricao: "", preco: 350, imagem: null, opcoes: [] },
  ] },
  ana: { categorias: [], produtos: [] },
};
const ENV = { MULTILOJA: "1", SUPABASE_URL: "https://banco.supabase.co", SUPABASE_ANON_KEY: "anon" };

/** O banco (loja_config pelo x-loja) e o site (os arquivos originais) de mentira. */
function mundo({ html = HTML_LOJA, bancoFora = false } = {}) {
  const chamadas = []; // loja_config, pelo x-loja
  const catalogos = []; // loja_catalogo, pelo x-loja
  const fetchFn = async (url, init = {}) => {
    const u = new URL(url);
    const cab = new Headers(init.headers);
    if (u.host === "banco.supabase.co") {
      const catalogo = u.pathname.endsWith("/loja_catalogo");
      (catalogo ? catalogos : chamadas).push(cab.get("x-loja"));
      if (bancoFora) return new Response("{}", { status: 503 });
      const xLoja = cab.get("x-loja");
      // sem x-loja: o banco de uma loja só (a da Bia)
      const chave = xLoja === null ? "bia" : xLoja.startsWith("bia") ? "bia" : xLoja.startsWith("ana") ? "ana" : null;
      if (!chave) return Response.json({ message: "Loja não encontrada." }, { status: 404 });
      return Response.json(catalogo ? CATALOGO[chave] : DADOS[chave]);
    }
    assert.equal(cab.get("x-forminha-base"), "1", "o arquivo original é pedido com a marca (não entra em volta)");
    const arquivos = {
      "/": [html, "text/html; charset=utf-8"],
      "/config.js": ['window.CONFIG_APP = Object.freeze(Object.assign({"supabaseUrl":"u","urlLoja":"","multiloja":true}, {}));\n', "application/javascript"],
      "/manifest.webmanifest": [JSON.stringify({ name: "Loja", short_name: "Loja", icons: [{ src: "/i.png" }] }), "application/manifest+json"],
      "/src/imagens/favicon.svg": ["<svg/>", "image/svg+xml"],
    };
    const [corpo, tipo] = arquivos[u.pathname];
    return new Response(corpo, { headers: { "content-type": tipo, "content-security-policy": "default-src 'self'", "content-length": "1" } });
  };
  return { fetchFn, chamadas, catalogos };
}
const pedido = (endereco, cabecalhos = {}) => new Request(endereco, { headers: cabecalhos });
const segue = (r) => r.headers.get("x-middleware-next") === "1";

describe("personalização na borda", () => {
  it("sem MULTILOJA não faz nada", async () => {
    const p = criarPersonalizador({ site: "loja", env: { ...ENV, MULTILOJA: "" }, fetchFn: mundo().fetchFn });
    assert.ok(segue(await p(pedido("https://bia.forminha.test/"))));
  });

  it("a loja do endereço: título, descrição, foto do link e cor, com os cabeçalhos de segurança", async () => {
    const m = mundo();
    const p = daLoja({ site: "loja", env: ENV, fetchFn: m.fetchFn });
    const r = await p(pedido("https://bia.forminha.test/"));
    const html = await r.text();
    assert.match(html, /<title>Doce da Bia — Bolos de festa<\/title>/);
    assert.match(html, /<meta property="og:description" content="Encomendas para aniversários">/);
    assert.match(html, /<meta property="og:image" content="https:\/\/x\.supabase\.co\/storage\/v1\/object\/public\/site\/logo\.png">/);
    assert.equal(r.headers.get("content-security-policy"), "default-src 'self'");
    assert.equal(r.headers.get("content-length"), null);
    assert.deepEqual(m.chamadas, ["bia.forminha.test"], "o banco foi perguntado pelo endereço");
    const outra = await (await p(pedido("https://ana.forminha.test/"))).text();
    assert.match(outra, /<title>Ana Doces<\/title>/, "cada endereço, a sua loja");
  });

  it("cores no config.js, app instalável e ícone da loja", async () => {
    const p = daLoja({ site: "loja", env: ENV, fetchFn: mundo().fetchFn });
    const cfg = await (await p(pedido("https://bia.forminha.test/config.js"))).text();
    const window = {};
    new Function("window", "location", cfg)(window, { origin: "https://bia.forminha.test" });
    assert.ok(window.CONFIG_APP.tema.tokens["--escura"], "as cores do tema da loja");
    assert.match(window.CONFIG_APP.tema.fonteUrl, /^https:\/\/fonts\.googleapis\.com/);
    const manifesto = await (await p(pedido("https://bia.forminha.test/manifest.webmanifest"))).json();
    assert.deepEqual([manifesto.name, manifesto.short_name, manifesto.icons.length], ["Doce da Bia", "Doce da Bia", 1]);
    assert.match(await (await p(pedido("https://bia.forminha.test/src/imagens/favicon.svg"))).text(), />DB<\/text>/);
  });

  it("robots e sitemap do próprio endereço", async () => {
    const p = daLoja({ site: "loja", env: ENV, fetchFn: mundo().fetchFn });
    assert.match(await (await p(pedido("https://bia.forminha.test/robots.txt"))).text(), /Sitemap: https:\/\/bia\.forminha\.test\/sitemap\.xml/);
    const mapa = await (await p(pedido("https://bia.forminha.test/sitemap.xml"))).text();
    assert.match(mapa, /<loc>https:\/\/bia\.forminha\.test\/<\/loc>/);
    assert.match(mapa, /<loc>https:\/\/bia\.forminha\.test\/p\/7-bolo-de-ninho<\/loc>/, "e cada produto, pelo link próprio");
    assert.match(mapa, /<loc>https:\/\/bia\.forminha\.test\/p\/8-brigadeiro<\/loc>/);
  });

  it("link próprio do produto: foto, nome e preço na prévia do link", async () => {
    const m = mundo();
    const p = daLoja({ site: "loja", env: ENV, fetchFn: m.fetchFn });
    const r = await p(pedido("https://bia.forminha.test/p/7-bolo-de-ninho"));
    const html = await r.text();
    assert.match(html, /<title>Bolo de Ninho — Doce da Bia<\/title>/);
    assert.match(html, /<meta property="og:title" content="Bolo de Ninho — Doce da Bia">/);
    assert.match(html, /<meta property="og:description" content="R\$ 1\.234,50 · Massa branca &amp; recheio &lt;cremoso&gt;">/, "preço a partir de (com a opção obrigatória mais barata) e texto escapado");
    assert.match(html, /<meta property="og:image" content="https:\/\/x\.supabase\.co\/storage\/v1\/object\/public\/produtos\/bolo\.jpg">/);
    assert.equal((html.match(/property="og:image"/g) ?? []).length, 1, "a foto do produto no lugar da foto da loja (uma só)");
    assert.match(html, /<meta property="og:type" content="product">/);
    assert.match(html, /<meta property="og:url" content="https:\/\/bia\.forminha\.test\/p\/7-bolo-de-ninho">/);
    assert.match(html, /<link rel="canonical" href="https:\/\/bia\.forminha\.test\/p\/7-bolo-de-ninho">/);
    assert.match(html, /<script type="module" src="\/src\/scripts\/main\.js">/, "os arquivos do site com caminho absoluto (a página está em /p/…)");
    assert.equal(r.headers.get("content-security-policy"), "default-src 'self'");
    assert.deepEqual([m.chamadas, m.catalogos], [["bia.forminha.test"], ["bia.forminha.test"]]);

    const semFoto = await (await p(pedido("https://bia.forminha.test/p/8"))).text();
    assert.match(semFoto, /<meta property="og:description" content="R\$ 3,50 · Encomende online na Doce da Bia\.">/);
    assert.match(semFoto, /<meta property="og:image" content="https:\/\/x\.supabase\.co\/storage\/v1\/object\/public\/site\/logo\.png">/, "sem foto: a da loja");

    const sumiu = await (await p(pedido("https://bia.forminha.test/p/99-acabou"))).text();
    assert.match(sumiu, /<title>Doce da Bia — Bolos de festa<\/title>/, "produto que não existe mais: a página da loja");
  });

  it("link do produto também na loja de site próprio (sem MULTILOJA), sem mandar o endereço ao banco", async () => {
    const m = mundo();
    const p = daLoja({ site: "loja", env: { ...ENV, MULTILOJA: "" }, fetchFn: m.fetchFn });
    assert.match(await (await p(pedido("https://www.docedabia.com.br/p/7-bolo-de-ninho"))).text(), /<title>Bolo de Ninho — Doce da Bia<\/title>/);
    assert.deepEqual([m.chamadas, m.catalogos], [[null], [null]], "banco de uma loja só: sem x-loja");
    assert.ok(segue(await p(pedido("https://www.docedabia.com.br/"))), "o resto do site continua como foi publicado");
  });

  it("link do produto com o banco fora do ar, ou no painel: segue normal", async () => {
    const p = daLoja({ site: "loja", env: ENV, fetchFn: mundo({ bancoFora: true }).fetchFn });
    assert.ok(segue(await p(pedido("https://bia.forminha.test/p/7-bolo-de-ninho"))));
    const painel = criarPersonalizador({ site: "dashboard", env: ENV, fetchFn: mundo({ html: HTML_PAINEL }).fetchFn });
    assert.ok(segue(await painel(pedido("https://bia-painel.forminha.test/p/7"))));
  });

  it("o painel: nome da loja no título e no app", async () => {
    const p = criarPersonalizador({ site: "dashboard", env: ENV, fetchFn: mundo({ html: HTML_PAINEL }).fetchFn });
    assert.match(await (await p(pedido("https://bia-painel.forminha.test/"))).text(), /<title>Painel — Doce da Bia<\/title>/);
    assert.equal((await (await p(pedido("https://bia-painel.forminha.test/manifest.webmanifest"))).json()).name, "Painel — Doce da Bia");
    assert.ok(segue(await p(pedido("https://bia-painel.forminha.test/robots.txt"))), "o painel continua fora dos buscadores (arquivo normal)");
  });

  it("banco fora do ar, loja desconhecida ou pedido do arquivo original: página normal", async () => {
    const p = daLoja({ site: "loja", env: ENV, fetchFn: mundo({ bancoFora: true }).fetchFn });
    assert.ok(segue(await p(pedido("https://bia.forminha.test/"))));
    const q = daLoja({ site: "loja", env: ENV, fetchFn: mundo().fetchFn });
    assert.ok(segue(await q(pedido("https://nao-existe.test/"))));
    assert.ok(segue(await q(pedido("https://bia.forminha.test/", { "x-forminha-base": "1" }))));
    assert.ok(segue(await q(pedido("https://bia.forminha.test/src/scripts/main.js"))));
  });

  it("pergunta ao banco no máximo uma vez por minuto por loja", async () => {
    const m = mundo();
    let agora = 0;
    const p = daLoja({ site: "loja", env: ENV, fetchFn: m.fetchFn, agora: () => agora });
    await p(pedido("https://bia.forminha.test/"));
    await p(pedido("https://bia.forminha.test/config.js"));
    assert.equal(m.chamadas.length, 1);
    agora = 61_000;
    await p(pedido("https://bia.forminha.test/"));
    assert.equal(m.chamadas.length, 2);
  });
});
