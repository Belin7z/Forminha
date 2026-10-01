/* Link próprio do produto: o endereço (/p/12-nome) e o endereço da loja visto do painel. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { caminhoDoProduto, produtoDoCaminho } from "../../src/scripts/base/dominio.js";
import { linkDoProduto, urlDaLoja } from "../../src/scripts/nucleo/enderecos.js";

describe("endereço do produto", () => {
  it("número + nome sem acento nem símbolo", () => {
    assert.equal(caminhoDoProduto({ id: 12, nome: "Bolo de Ninho c/ Morango (1,5 kg)" }), "/p/12-bolo-de-ninho-c-morango-1-5-kg");
    assert.equal(caminhoDoProduto({ id: 3, nome: "Pão de Mel Açucarado" }), "/p/3-pao-de-mel-acucarado");
    assert.equal(caminhoDoProduto({ id: 4, nome: "!!!" }), "/p/4", "sem letras: só o número");
    assert.ok(caminhoDoProduto({ id: 5, nome: "a".repeat(200) }).length <= 70, "nome comprido é cortado");
  });

  it("só o número vale: o nome pode mudar e o link antigo abre igual", () => {
    assert.equal(produtoDoCaminho("/p/12-bolo-de-ninho"), 12);
    assert.equal(produtoDoCaminho("/p/12-nome-antigo"), 12);
    assert.equal(produtoDoCaminho("/p/12"), 12);
    assert.equal(produtoDoCaminho("/p/12/"), 12);
    for (const outro of ["/", "/p/", "/p/abc", "/x/12", "/p/12-Maiusculo", "/p/12/../admin", "/p/1234567890"]) assert.equal(produtoDoCaminho(outro), null, outro);
  });
});

describe("endereço da loja visto do painel", () => {
  const local = (host) => ({ host, protocol: "https:" });

  it("o da publicação vale primeiro", () => {
    assert.equal(urlDaLoja({ urlLoja: "https://docedabia.com.br/" }, local("painel.docedabia.com.br")), "https://docedabia.com.br");
  });

  it("no site único das lojas, é o endereço do painel sem o “painel”", () => {
    assert.equal(urlDaLoja({ multiloja: true }, local("bia-painel.vercel.app")), "https://bia.vercel.app");
    assert.equal(urlDaLoja({ multiloja: true }, local("bia-painel.forminha.com.br")), "https://bia.forminha.com.br");
    assert.equal(urlDaLoja({ multiloja: true }, local("painel.docedabia.com.br")), "https://docedabia.com.br");
    assert.equal(urlDaLoja({ multiloja: true }, local("localhost:3001")), "", "endereço desconhecido: sem link (o botão some)");
    assert.equal(urlDaLoja({}, local("bia-painel.vercel.app")), "", "site próprio sem endereço publicado");
  });

  it("link pronto para colar", () => {
    assert.equal(linkDoProduto({ id: 7, nome: "Brigadeiro" }, "https://bia.vercel.app"), "https://bia.vercel.app/p/7-brigadeiro");
    assert.equal(linkDoProduto({ id: 7, nome: "Brigadeiro" }, ""), "");
  });
});
