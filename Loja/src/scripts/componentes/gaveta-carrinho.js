/* COMPONENTE — carrinho lateral (gaveta) */
import { html, montar, delegar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { brl, horasTexto } from "/src/scripts/base/formatacao.js";
import { nomeComQuantidade } from "/src/scripts/base/opcoes.js";
import { estado, ouvir } from "../nucleo/estado.js";
import { alterarQtd, antecedenciaHoras, linhas, remover, subtotal } from "../nucleo/carrinho.js";
import { visualProduto } from "./cartao-produto.js";

let gaveta, fundo, roteador, aberta = false, focoAnterior = null;

function itemHtml(l) {
  const minimo = l.produto.min_qtd;
  return html`
    <li class="item-carrinho">
      <div class="item-carrinho__img">${visualProduto(l.produto)}</div>
      <div class="item-carrinho__info">
        <strong>${l.produto.nome}</strong>
        ${l.escolhas.map((e) => html`<small>${e.grupo}: ${e.itens.map(nomeComQuantidade).join(", ")}</small>`)}
        ${l.obs && html`<small class="item-carrinho__obs">“${l.obs}”</small>`}
        <div class="item-carrinho__linha">
          <div class="qtd">
            <button type="button" data-acao="menos" data-chave="${l.chave}" aria-label="Diminuir">${icone("menos", { tamanho: 16 })}</button>
            <output>${l.qtd}</output>
            <button type="button" data-acao="mais" data-chave="${l.chave}" aria-label="Aumentar">${icone("mais", { tamanho: 16 })}</button>
          </div>
          <strong class="item-carrinho__total">${brl(l.total)}</strong>
        </div>
        ${l.qtd - 1 < minimo && minimo > 1 && html`<small class="texto-suave">Mínimo de ${minimo} un.: ao diminuir, o item sai.</small>`}
      </div>
      <button type="button" class="btn-icone btn-icone--pequeno" data-acao="remover" data-chave="${l.chave}" aria-label="Remover ${l.produto.nome}">${icone("lixeira", { tamanho: 17 })}</button>
    </li>`;
}

function desenhar() {
  const itens = linhas();
  const total = subtotal();
  const minimo = estado.config.pedidos.pedido_minimo;
  const falta = Math.max(0, minimo - total);
  const antecedencia = antecedenciaHoras();

  montar(gaveta, html`
    <header class="gaveta__cab">
      <h2>Seu carrinho</h2>
      <button type="button" class="btn-icone" data-acao="fechar" aria-label="Fechar carrinho">${icone("x")}</button>
    </header>
    <div class="gaveta__corpo">
      ${itens.length
        ? html`<ul>${itens.map(itemHtml)}</ul>`
        : html`<div class="vazio"><span class="vazio__ico">${icone("sacola", { tamanho: 38 })}</span><h3>Seu carrinho está vazio</h3>
            <p>Escolha seus doces favoritos e monte seu pedido.</p>
            <a href="#/cardapio" class="btn btn--primario" data-acao="fechar">Ver cardápio</a></div>`}
    </div>
    ${itens.length > 0 && html`
      <footer class="gaveta__rodape">
        ${antecedencia > 0 && html`<p class="aviso aviso--marca">${icone("relogio", { tamanho: 16 })}<span>Este pedido exige <strong>${horasTexto(antecedencia)}</strong> de antecedência.</span></p>`}
        ${falta > 0 && html`<p class="aviso aviso--aviso">${icone("alerta", { tamanho: 16 })}<span>Faltam <strong>${brl(falta)}</strong> para o pedido mínimo de ${brl(minimo)}.</span></p>`}
        <div class="gaveta__total"><span>Subtotal</span><strong>${brl(total)}</strong></div>
        <small class="texto-suave">Entrega, cupom e horário você escolhe na próxima etapa.</small>
        <button type="button" class="btn btn--primario btn--grande btn--bloco" data-acao="finalizar" ${falta > 0 && "disabled"}>Finalizar pedido</button>
      </footer>`}`);
}

export function abrirGaveta() {
  focoAnterior = document.activeElement;
  aberta = true;
  desenhar();
  gaveta.inert = false;
  gaveta.classList.add("gaveta--aberta");
  gaveta.setAttribute("aria-hidden", "false");
  fundo.hidden = false;
  document.body.style.overflow = "hidden";
  gaveta.querySelector("[data-acao='fechar']")?.focus();
}

export function fecharGaveta() {
  if (!aberta) return;
  aberta = false;
  gaveta.classList.remove("gaveta--aberta");
  gaveta.setAttribute("aria-hidden", "true");
  gaveta.inert = true;
  fundo.hidden = true;
  document.body.style.overflow = "";
  focoAnterior?.focus?.();
}

export function iniciarGaveta(roteadorApp) {
  roteador = roteadorApp;
  gaveta = document.getElementById("gaveta");
  fundo = document.getElementById("gaveta-fundo");
  gaveta.inert = true;

  fundo.addEventListener("click", fecharGaveta);
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") fecharGaveta(); });

  delegar(gaveta, {
    fechar: () => fecharGaveta(),
    mais: (el) => alterarQtd(el.dataset.chave, +1),
    menos: (el) => alterarQtd(el.dataset.chave, -1),
    remover: (el) => remover(el.dataset.chave),
    finalizar: () => { fecharGaveta(); roteador.ir("/finalizar"); },
  });

  ouvir("carrinho", () => { if (aberta) desenhar(); });
}
