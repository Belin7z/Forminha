/* Etiquetas: o que sai em cada uma (validade, alérgicos, identificação da loja) e como viram páginas. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TAMANHOS, dadosDaEtiqueta, dataBR, faltandoNaEtiqueta, identificacaoDaLoja, opcoesEmTexto, paginar, textoAlergicos, validadeDe } from "../../src/scripts/base/etiquetas.js";

const BOLO = { nome: "Bolo de Ninho", ingredientes: "Farinha de trigo, leite, ovos e açúcar.", alergenos: ["gluten", "leite", "ovos"], validade_dias: 3, conservacao: "Manter refrigerado." };
const LOJA = { nome: "Doce da Bia", endereco: "Rua das Flores, 10", cidade: "Santos", uf: "SP", whatsapp: "13999990000" };

describe("etiquetas", () => {
  it("validade = fabricação + dias (virando mês e ano)", () => {
    assert.equal(validadeDe("2026-10-01", 3), "2026-10-04");
    assert.equal(validadeDe("2026-12-30", 5), "2027-01-04");
    assert.equal(validadeDe("2026-10-01", null), "", "sem validade cadastrada");
    assert.equal(validadeDe("ontem", 3), "");
    assert.equal(dataBR("2026-10-04"), "04/10/2026");
  });

  it("alérgicos em maiúsculas e o aviso do glúten separado", () => {
    assert.equal(textoAlergicos(["leite", "ovos", "gluten"]), "ALÉRGICOS: CONTÉM GLÚTEN, LEITE E OVOS.");
    assert.equal(textoAlergicos(["oleaginosas"]), "ALÉRGICOS: CONTÉM OLEAGINOSAS.");
    assert.equal(textoAlergicos([]), "");
  });

  it("a etiqueta completa de um item de pedido", () => {
    const e = dadosDaEtiqueta({
      item: { nome: "Bolo de Ninho", opcoes: [{ grupo: "Tamanho", itens: [{ nome: "1 kg" }] }], cliente: "Ana" },
      produto: BOLO, loja: LOJA, fabricacao: "2026-10-01", lote: "LA-1042", extra: "CNPJ 00.000.000/0001-00", mostrarCliente: true,
    });
    assert.deepEqual(e, {
      nome: "Bolo de Ninho", detalhe: "Tamanho: 1 kg", cliente: "Para: Ana",
      ingredientes: "Farinha de trigo, leite, ovos e açúcar.", alergicos: "ALÉRGICOS: CONTÉM GLÚTEN, LEITE E OVOS.", gluten: "CONTÉM GLÚTEN.",
      conservacao: "Manter refrigerado.", fabricacao: "01/10/2026", validade: "04/10/2026", lote: "LA-1042",
      loja: "Doce da Bia · Rua das Flores, 10 — Santos/SP · (13) 99999-0000", extra: "CNPJ 00.000.000/0001-00",
    });
    assert.equal(dadosDaEtiqueta({ item: { nome: "X", cliente: "Ana" }, produto: BOLO, loja: LOJA, fabricacao: "2026-10-01" }).cliente, "", "o nome do cliente só quando pedido");
  });

  it("produto sem cadastro completo: avisa o que falta e a etiqueta sai sem esses dados", () => {
    assert.deepEqual(faltandoNaEtiqueta({ ingredientes: "", validade_dias: null }), ["ingredientes", "validade"]);
    assert.deepEqual(faltandoNaEtiqueta(BOLO), []);
    assert.deepEqual(faltandoNaEtiqueta(null), ["produto não encontrado no cardápio"]);
    const e = dadosDaEtiqueta({ item: { nome: "Brigadeiro" }, produto: null, loja: { nome: "Doce da Bia" }, fabricacao: "2026-10-01" });
    assert.deepEqual([e.ingredientes, e.alergicos, e.validade, e.loja], ["", "", "", "Doce da Bia"]);
  });

  it("opções com quantidade (caixa montada) e identificação da loja sem endereço", () => {
    assert.equal(opcoesEmTexto([{ grupo: "Sabores", itens: [{ nome: "Ninho", qtd: 10 }, { nome: "Beijinho", qtd: 1 }] }]), "Sabores: 10× Ninho, Beijinho");
    assert.equal(identificacaoDaLoja({ nome: "Doce da Bia" }), "Doce da Bia");
  });

  it("páginas: uma por etiqueta térmica; 21 por folha A4", () => {
    const etiquetas = Array.from({ length: 25 }, (_, i) => ({ nome: String(i) }));
    assert.equal(paginar(etiquetas, "60x40").length, 25);
    const folhas = paginar(etiquetas, "a4-21");
    assert.deepEqual(folhas.map((f) => f.length), [21, 4]);
    assert.equal(TAMANHOS["a4-21"].folha.colunas * TAMANHOS["a4-21"].folha.linhas, 21);
    assert.equal(paginar(etiquetas, "nao-existe").length, 25, "tamanho desconhecido: o padrão");
  });
});
