/* ==========================================================
   BORDA — personalização na hora (um site para várias lojas):
     - só com MULTILOJA=1 (senão a página já veio personalizada);
     - a loja do ENDEREÇO: título, descrição e foto do link, cores no
       config.js, aplicativo instalável, ícone, robots e sitemap;
     - o painel ganha o nome da loja no título e no app;
     - banco fora do ar: a página padrão (nada quebra);
     - uma pergunta ao banco por minuto por loja.
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
const ENV = { MULTILOJA: "1", SUPABASE_URL: "https://banco.supabase.co", SUPABASE_ANON_KEY: "anon" };

/** O banco (loja_config pelo x-loja) e o site (os arquivos originais) de mentira. */
function mundo({ html = HTML_LOJA, bancoFora = false } = {}) {
  const chamadas = [];
  const fetchFn = async (url, init = {}) => {
    const u = new URL(url);
    const cab = new Headers(init.headers);
    if (u.host === "banco.supabase.co") {
      chamadas.push(cab.get("x-loja"));
      if (bancoFora) return new Response("{}", { status: 503 });
      const chave = cab.get("x-loja").startsWith("bia") ? "bia" : cab.get("x-loja").startsWith("ana") ? "ana" : null;
      return chave ? Response.json(DADOS[chave]) : Response.json({ message: "Loja não encontrada." }, { status: 404 });
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
  return { fetchFn, chamadas };
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
    assert.match(await (await p(pedido("https://bia.forminha.test/sitemap.xml"))).text(), /<loc>https:\/\/bia\.forminha\.test\/<\/loc>/);
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
