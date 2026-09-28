/* COFRE — a criptografia dos dados das clientes */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ErroCofre, criarCofre, mascararEmail, novaChave } from "../../lib/cofre.js";

const cofre = criarCofre(novaChave());

describe("cofre", () => {
  it("cifra e decifra textos e objetos", () => {
    const pessoa = { nome: "Ana Souza", email: "ana@doceria.com", documento: "52998224725" };
    const cifrado = cofre.cifrar(pessoa, "cliente:1");
    assert.match(cifrado, /^v1\.[A-Za-z0-9_-]+$/);
    assert.ok(!cifrado.includes("Ana") && !cifrado.includes("doceria"), "nada legível no texto cifrado");
    assert.deepEqual(cofre.decifrar(cifrado, "cliente:1", { json: true }), pessoa);
    assert.equal(cofre.decifrar(cofre.cifrar("olá", "x"), "x"), "olá");
  });

  it("o mesmo dado cifrado duas vezes sai diferente (número aleatório a cada vez)", () => {
    assert.notEqual(cofre.cifrar("igual", "c"), cofre.cifrar("igual", "c"));
  });

  it("dado adulterado no banco é recusado (não mostra lixo)", () => {
    const c = cofre.cifrar("segredo", "c");
    const bytes = Buffer.from(c.slice(3), "base64url");
    bytes[14] ^= 1;
    assert.throws(() => cofre.decifrar(`v1.${bytes.toString("base64url")}`, "c"), ErroCofre);
  });

  it("dado copiado para outro registro não abre (contexto amarrado)", () => {
    const daAna = cofre.cifrar({ nome: "Ana" }, "cliente:ana");
    assert.throws(() => cofre.decifrar(daAna, "cliente:bia"), ErroCofre);
  });

  it("outra chave não abre nada", () => {
    const outro = criarCofre(novaChave());
    assert.throws(() => outro.decifrar(cofre.cifrar("x", "c"), "c"), ErroCofre);
  });

  it("índice cego: mesmo e-mail (com maiúsculas/espaços) dá o mesmo código, sem revelar o e-mail", () => {
    const a = cofre.indice("Ana@Doceria.com "), b = cofre.indice("ana@doceria.com");
    assert.equal(a, b);
    assert.match(a, /^[0-9a-f]{64}$/);
    assert.notEqual(a, cofre.indice("bia@doceria.com"));
    assert.notEqual(a, criarCofre(novaChave()).indice("ana@doceria.com"), "depende da chave");
  });

  it("recusa chave ausente ou curta", () => {
    assert.throws(() => criarCofre(""), ErroCofre);
    assert.throws(() => criarCofre(Buffer.alloc(16).toString("base64")), ErroCofre);
  });

  it("e-mail mascarado para telas públicas", () => {
    assert.equal(mascararEmail("ana.souza@gmail.com"), "an•••@gmail.com");
    assert.equal(mascararEmail("sem-arroba"), "");
  });
});
