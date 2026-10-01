/* COMPONENTE — cartão de produto (vitrine, favoritos, destaques) */
import { html } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { brl } from "/src/scripts/base/formatacao.js";
import { estado } from "../nucleo/estado.js";
import { precoInicial } from "../nucleo/catalogo.js";

/** Foto do produto ou, se não houver, o ícone da categoria sobre um fundo suave. */
export function visualProduto(p) {
  if (p.imagem) return html`<img src="${p.imagem}" alt="${p.nome}" loading="lazy">`;
  const categoria = estado.categorias.find((c) => c.id === p.categoria_id);
  return html`<div class="produto__ph" aria-hidden="true">${icone(categoria?.icone || "sacola", { tamanho: 46 })}</div>`;
}

export function cartaoProduto(p, indice = 0) {
  const { preco, aPartirDe } = precoInicial(p);
  const favorito = estado.favoritos.has(p.id);
  const detalhe = p.min_qtd > 1 ? `pedido mín. ${p.min_qtd} un.` : p.unidade;

  return html`
    <article class="produto" style="animation-delay:${Math.min(indice * 35, 350)}ms" data-acao="abrir" data-id="${p.id}" tabindex="0" role="button" aria-label="Ver ${p.nome}">
      <div class="produto__img">
        ${p.tag && html`<span class="produto__tag">${p.tag}</span>`}
        <button type="button" class="favorito ${favorito && "favorito--on"}" data-acao="favorito" data-id="${p.id}"
                aria-pressed="${String(favorito)}" aria-label="${favorito ? "Remover dos" : "Adicionar aos"} favoritos">
          ${icone("coracao", { tamanho: 19, preenchido: favorito })}
        </button>
        ${visualProduto(p)}
      </div>
      <div class="produto__corpo">
        <h3 class="produto__nome">${p.nome}</h3>
        <p class="produto__desc">${p.descricao}</p>
        <div class="produto__rodape">
          <div class="produto__preco">
            ${aPartirDe && html`<small>a partir de</small>`}
            <strong>${brl(preco)}</strong>
            <span>${detalhe}</span>
          </div>
          <button type="button" class="btn-add" data-acao="adicionar" data-id="${p.id}" aria-label="Adicionar ${p.nome} ao carrinho">${icone("mais", { tamanho: 22 })}</button>
        </div>
      </div>
    </article>`;
}
