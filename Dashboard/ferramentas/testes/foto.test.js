/* Assistente de foto: as contas de enquadrar, girar e clarear (a parte de tela usa estas mesmas funções). */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ajustarBrilho, areaDoRecorte, brilhoSugerido, centralizar, escalaBase, limitarPosicao, medidaGirada } from "../../src/scripts/base/imagem.js";

describe("enquadramento da foto", () => {
  const foto = { w: 4000, h: 3000, VW: 400, VH: 400 }; // foto de celular num quadro quadrado

  it("com recorte, a foto cobre o quadro; sem recorte (logo), cabe inteira", () => {
    assert.equal(escalaBase({ ...foto, recorta: true }), 400 / 3000);
    assert.equal(escalaBase({ ...foto, recorta: false }), 400 / 4000);
  });

  it("começa centralizada e nunca deixa borda vazia ao arrastar", () => {
    const escala = escalaBase({ ...foto, recorta: true });
    const centro = centralizar({ ...foto, escala });
    assert.equal(centro.oy, 0);
    assert.ok(Math.abs(centro.ox - (400 - 4000 * escala) / 2) < 1e-9);
    assert.deepEqual(limitarPosicao({ ...foto, escala, ox: 50, oy: 30 }), { ox: 0, oy: 0 }, "arrastou demais para a direita");
    assert.equal(limitarPosicao({ ...foto, escala, ox: -9999, oy: 0 }).ox, 400 - 4000 * escala, "arrastou demais para a esquerda");
  });

  it("o recorte salvo é o que aparece no quadro, com o lado maior limitado", () => {
    const escala = escalaBase({ ...foto, recorta: true });
    const { ox, oy } = centralizar({ ...foto, escala });
    const a = areaDoRecorte({ ...foto, escala, ox, oy, recorta: true, lado: 1400 });
    assert.equal(Math.round(a.sw), 3000);
    assert.equal(Math.round(a.sh), 3000);
    assert.equal(Math.round(a.sx), 500, "o meio da foto");
    assert.deepEqual([a.largura, a.altura], [1400, 1400]);
  });

  it("foto pequena não é aumentada", () => {
    const pequena = { w: 600, h: 600, VW: 400, VH: 400 };
    const escala = escalaBase({ ...pequena, recorta: true });
    const a = areaDoRecorte({ ...pequena, escala, ox: 0, oy: 0, recorta: true, lado: 1400 });
    assert.deepEqual([a.largura, a.altura], [600, 600]);
  });

  it("girar 90° troca largura e altura; 180° não", () => {
    assert.deepEqual(medidaGirada(4000, 3000, 90), { w: 3000, h: 4000 });
    assert.deepEqual(medidaGirada(4000, 3000, 180), { w: 4000, h: 3000 });
    assert.deepEqual(medidaGirada(4000, 3000, 270), { w: 3000, h: 4000 });
  });
});

describe("luz da foto", () => {
  it("clareia sem passar do branco e sem mexer na transparência", () => {
    const pixels = new Uint8ClampedArray([100, 200, 50, 128, 250, 10, 0, 255]);
    ajustarBrilho(pixels, 1.5);
    assert.deepEqual([...pixels], [150, 255, 75, 128, 255, 15, 0, 255]);
  });

  it("brilho 1 não muda nada", () => {
    const pixels = new Uint8ClampedArray([1, 2, 3, 4]);
    assert.deepEqual([...ajustarBrilho(pixels, 1)], [1, 2, 3, 4]);
  });

  it("sugere clarear só foto escura, com limite", () => {
    assert.equal(brilhoSugerido(120), 1);
    assert.equal(brilhoSugerido(65), 1.6, "precisaria dobrar: fica no limite");
    assert.equal(brilhoSugerido(90), 1.45);
    assert.ok(brilhoSugerido(90) > 1 && brilhoSugerido(90) < 1.6);
  });
});
