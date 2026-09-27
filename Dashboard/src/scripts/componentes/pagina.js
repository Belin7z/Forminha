/* COMPONENTE — peças comuns das páginas do painel */
import { html } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";

/** Título da página com descrição e botões de ação à direita. */
export function cabecalhoPagina({ titulo, descricao = "", acoes = "" }) {
  return html`<div class="pagina-cab">
    <div><h1>${titulo}</h1>${descricao && html`<p class="texto-suave">${descricao}</p>`}</div>
    ${acoes && html`<div class="pagina-cab__acoes">${acoes}</div>`}
  </div>`;
}

/** Botões de troca de visão dentro de uma aba (são links, então o endereço muda e o "voltar" funciona). itens: [[id, texto, href]] */
export const subAbas = (itens, atual) => html`<div class="segmentos segmentos--solto est__sem-impressao" role="navigation">${itens.map(([id, texto, href]) =>
  html`<a href="${href}" class="segmento ${id === atual && "segmento--ativo"}">${texto}</a>`)}</div>`;

export const carregandoPagina = html`<div class="carregando-pagina" role="status" aria-label="Carregando"><div class="spinner"></div></div>`;

export const vazio = (nome, titulo, texto = "", acao = "") =>
  html`<div class="vazio"><span class="vazio__ico">${icone(nome, { tamanho: 38 })}</span><h3>${titulo}</h3>${texto && html`<p>${texto}</p>`}${acao}</div>`;

export const erroPagina = (mensagem) =>
  html`<div class="aviso aviso--perigo">${mensagem}</div>`;

/** Card de indicador (KPI): rótulo, número grande e nota. */
export function indicador({ rotulo, valor, nota = "", destaque = false, icone: ic = "" }) {
  return html`<article class="kpi ${destaque && "kpi--destaque"}">
    <span class="kpi__rotulo">${ic}${rotulo}</span>
    <strong class="kpi__valor">${valor}</strong>
    ${nota && html`<small class="kpi__nota">${nota}</small>`}
  </article>`;
}
