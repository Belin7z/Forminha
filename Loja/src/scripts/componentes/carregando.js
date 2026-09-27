/* COMPONENTE — indicador de carregamento de página */
import { html } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";

export const carregando = html`<div class="carregando-pagina" role="status" aria-label="Carregando"><div class="spinner"></div></div>`;

export const erroDePagina = (mensagem) =>
  html`<section class="container pagina-simples"><div class="vazio"><span class="vazio__ico">${icone("alerta", { tamanho: 38 })}</span><h3>Ops!</h3><p>${mensagem}</p>
    <a class="btn btn--primario" href="./">Tentar de novo</a></div></section>`;
