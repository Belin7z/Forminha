/* PÁGINA — endereço inexistente */
import { html, montar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";

export function naoEncontrada(ctx) {
  montar(ctx.raiz, html`<section class="container pagina-simples"><div class="vazio"><span class="vazio__ico">${icone("bolo", { tamanho: 38 })}</span>
    <h3>Página não encontrada</h3><p>Não achamos o que você procurava, mas o cardápio está cheio de coisas boas.</p>
    <a href="#/cardapio" class="btn btn--primario">Ver cardápio</a></div></section>`);
}
