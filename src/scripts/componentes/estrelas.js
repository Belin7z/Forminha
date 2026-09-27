/* COMPONENTE — estrelas de avaliação (exibição e escolha de nota) */
import { html } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";

/** Estrelas somente para leitura. */
export function estrelas(nota, { tamanho = 16 } = {}) {
  return html`<span class="estrelas" role="img" aria-label="${nota} de 5 estrelas">${[1, 2, 3, 4, 5].map(
    (n) => html`<span class="${n <= Math.round(nota) ? "estrelas__on" : "estrelas__off"}">${icone("estrela", { tamanho, preenchido: true })}</span>`
  )}</span>`;
}

/** Escolha de nota de 1 a 5 (campo `nome`, acessível por teclado). */
export function escolherNota(nome, valor = 0) {
  return html`<fieldset class="nota-escolha"><legend class="sr-only">Nota</legend>${[1, 2, 3, 4, 5].map(
    (n) => html`<input type="radio" id="${nome}-${n}" name="${nome}" value="${n}" ${n === valor && "checked"}>
      <label for="${nome}-${n}" title="${n} estrela${n > 1 ? "s" : ""}">${icone("estrela", { tamanho: 30, preenchido: true })}</label>`
  )}</fieldset>`;
}
