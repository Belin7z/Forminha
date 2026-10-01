/* COMPONENTE — janela do produto: opções, quantidade, observação e favorito */
import { html } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { abrirModal, toast } from "/src/scripts/base/ui.js";
import { brl, dataCurta, horasTexto } from "/src/scripts/base/formatacao.js";
import { ALERGENOS, caminhoDoProduto } from "/src/scripts/base/dominio.js";
import { estado, ouvir } from "../nucleo/estado.js";
import { extrasDaSelecao, produtoPorId } from "../nucleo/catalogo.js";
import { adicionar } from "../nucleo/carrinho.js";
import { alternarFavorito } from "../nucleo/sessao.js";
import { visualProduto } from "./cartao-produto.js";

function grupoHtml(g) {
  const multipla = g.tipo === "multipla";
  return html`
    <fieldset class="grupo-opcoes" data-grupo="${g.id}">
      <legend>
        <strong>${g.nome}</strong>
        <span class="badge ${g.obrigatorio ? "badge--aviso" : "badge--neutro"}">${g.obrigatorio ? "Obrigatório" : "Opcional"}</span>
        ${multipla && g.max && html`<small class="texto-suave">escolha até ${g.max}</small>`}
      </legend>
      <div class="opcoes">
        ${g.itens.map((i, n) => html`
          <label class="opcao ${multipla && "opcao--caixa"}">
            <input type="${multipla ? "checkbox" : "radio"}" name="${g.id}" value="${i.id}" ${!multipla && g.obrigatorio && n === 0 && "checked"}>
            <span class="opcao__marca"></span>
            <span class="opcao__texto"><strong>${i.nome}</strong></span>
            ${i.preco > 0 && html`<span class="opcao__extra">+ ${brl(i.preco)}</span>`}
          </label>`)}
      </div>
    </fieldset>`;
}

const nomeAlergeno = (id) => ALERGENOS.find(([codigo]) => codigo === id)?.[1] ?? id;
const periodoTexto = (p) => (p.disponivel_de && p.disponivel_ate ? `vendido para datas de ${dataCurta(p.disponivel_de)} a ${dataCurta(p.disponivel_ate)}`
  : p.disponivel_de ? `vendido para datas a partir de ${dataCurta(p.disponivel_de)}` : `vendido para datas até ${dataCurta(p.disponivel_ate)}`);

/** Compartilha o link próprio do produto: a janela de compartilhar do celular ou, no computador, copia o link. */
async function compartilhar(p) {
  const url = location.origin + caminhoDoProduto(p);
  if (navigator.share && matchMedia("(pointer: coarse)").matches) {
    try { await navigator.share({ title: p.nome, text: `${p.nome} — ${estado.config.loja.nome}`, url }); return; }
    catch (e) { if (e?.name === "AbortError") return; } // a pessoa desistiu
  }
  try { await navigator.clipboard.writeText(url); toast("Link do produto copiado. É só colar no WhatsApp ou no Instagram."); }
  catch { toast(`Link do produto: ${url}`, "info"); }
}

/**
 * Abre a janela do produto. `ctx` é o contexto da rota (usado para o login do favorito).
 * `aoFechar`: chamado quando a janela fecha (o link próprio do produto volta para o cardápio).
 */
export function abrirProduto(id, ctx, { aoFechar } = {}) {
  const p = produtoPorId(id);
  if (!p) return;
  const minimo = p.min_qtd;
  const fotos = [p.imagem, ...(p.galeria ?? [])].filter(Boolean);
  let qtd = minimo;
  let desligar = () => {};

  const m = abrirModal({
    titulo: p.nome, largura: 580, classe: "modal-produto",
    corpo: html`
      <div class="produto-detalhe">
        <div class="produto-detalhe__img">
          ${visualProduto(p)}
          <button type="button" class="favorito" data-fav aria-label="Favoritar"></button>
        </div>
        ${fotos.length > 1 && html`<div class="produto-detalhe__fotos" role="group" aria-label="Fotos do produto">${fotos.map((f, n) => html`
          <button type="button" class="produto-detalhe__mini ${n === 0 && "produto-detalhe__mini--ativa"}" data-foto="${n}" aria-label="Ver foto ${n + 1}"><img src="${f}" alt="" loading="lazy"></button>`)}</div>`}
        <div class="produto-detalhe__linha">
          ${p.tag && html`<span class="badge">${p.tag}</span>`}
          <button type="button" class="btn btn--suave btn--pequeno produto-detalhe__compartilhar" data-compartilhar>${icone("compartilhar", { tamanho: 15 })} Compartilhar</button>
        </div>
        <p class="produto-detalhe__desc">${p.descricao}</p>
        ${p.ingredientes && html`<details class="produto-detalhe__ingredientes"><summary>Ingredientes</summary><p>${p.ingredientes}</p></details>`}
        ${(p.alergenos ?? []).length > 0 && html`<p class="produto-detalhe__alergenos">${icone("info", { tamanho: 16 })} <span><strong>Contém:</strong> ${(p.alergenos ?? []).map((a) => nomeAlergeno(a)).join(", ")}.</span></p>`}
        <p class="produto-detalhe__meta">
          <span>${icone("pacote", { tamanho: 16 })} ${p.unidade}</span>
          ${minimo > 1 && html`<span>${icone("mais", { tamanho: 16 })} pedido mínimo: ${minimo} un.</span>`}
          ${p.antecedencia_horas != null && html`<span>${icone("relogio", { tamanho: 16 })} encomendar com ${horasTexto(p.antecedencia_horas)} de antecedência</span>`}
          ${(p.disponivel_de || p.disponivel_ate) && html`<span>${icone("calendario", { tamanho: 16 })} ${periodoTexto(p)}</span>`}
          ${p.limite_diario && html`<span>${icone("pacote", { tamanho: 16 })} vendemos até ${p.limite_diario} por dia</span>`}
          ${p.conservacao && html`<span>${icone("info", { tamanho: 16 })} ${p.conservacao}</span>`}
          ${p.validade_dias && html`<span>${icone("calendario", { tamanho: 16 })} validade: ${p.validade_dias === 1 ? "1 dia" : `${p.validade_dias} dias`}</span>`}
        </p>
        <form id="form-produto" novalidate>
          ${p.opcoes.map(grupoHtml)}
          <div class="campo">
            <label for="obs-produto">Alguma observação? <span class="texto-suave">(opcional)</span></label>
            <textarea id="obs-produto" name="obs" rows="2" maxlength="200" placeholder="Ex.: escrever “Parabéns, Ana!” no bolo, sem nozes…"></textarea>
          </div>
        </form>
      </div>`,
    rodape: html`
      <div class="qtd">
        <button type="button" data-menos aria-label="Diminuir">${icone("menos", { tamanho: 16 })}</button>
        <output data-qtd>${qtd}</output>
        <button type="button" data-mais aria-label="Aumentar">${icone("mais", { tamanho: 16 })}</button>
      </div>
      <button type="button" class="btn btn--primario btn--grande espaco" data-add></button>`,
    aoFechar: () => { desligar(); aoFechar?.(); },
  });

  const form = m.el.querySelector("form");
  const botaoAdd = m.rodape.querySelector("[data-add]");
  const saidaQtd = m.rodape.querySelector("[data-qtd]");
  const botaoMenos = m.rodape.querySelector("[data-menos]");
  const botaoFav = m.el.querySelector("[data-fav]");

  const selecao = () => {
    const s = {};
    for (const g of p.opcoes) s[g.id] = [...form.querySelectorAll(`[name="${g.id}"]:checked`)].map((x) => x.value);
    return s;
  };

  function faltando(s) {
    return p.opcoes.find((g) => g.obrigatorio && !(s[g.id]?.length));
  }

  function atualizar() {
    const s = selecao();
    // limite de escolhas em grupos de múltipla escolha
    for (const g of p.opcoes.filter((x) => x.tipo === "multipla" && x.max)) {
      const cheio = s[g.id].length >= g.max;
      form.querySelectorAll(`[name="${g.id}"]:not(:checked)`).forEach((el) => { el.disabled = cheio; });
    }
    const falta = faltando(s);
    const total = (p.preco + extrasDaSelecao(p, s)) * qtd;
    saidaQtd.textContent = qtd;
    botaoMenos.disabled = qtd <= minimo;
    botaoAdd.disabled = !!falta;
    botaoAdd.textContent = falta ? `Escolha: ${falta.nome}` : `Adicionar · ${brl(total)}`;
  }

  function desenharFavorito() {
    const on = estado.favoritos.has(p.id);
    botaoFav.classList.toggle("favorito--on", on);
    botaoFav.setAttribute("aria-pressed", String(on));
    botaoFav.innerHTML = String(icone("coracao", { tamanho: 20, preenchido: on }));
  }

  m.rodape.querySelector("[data-mais]").addEventListener("click", () => { qtd = Math.min(qtd + 1, 999); atualizar(); });
  botaoMenos.addEventListener("click", () => { qtd = Math.max(minimo, qtd - 1); atualizar(); });
  form.addEventListener("change", atualizar);
  // miniaturas: trocam a foto grande (a primeira devolve a foto principal)
  m.el.querySelectorAll("[data-foto]").forEach((botao) => botao.addEventListener("click", () => {
    const n = Number(botao.dataset.foto);
    const area = m.el.querySelector(".produto-detalhe__img");
    area.querySelector(".produto-detalhe__zoom")?.remove();
    if (n > 0 || !p.imagem) {
      const img = document.createElement("img");
      img.className = "produto-detalhe__zoom";
      img.alt = p.nome;
      img.src = fotos[n];
      area.prepend(img);
    }
    m.el.querySelectorAll(".produto-detalhe__mini").forEach((x) => x.classList.toggle("produto-detalhe__mini--ativa", x === botao));
  }));
  form.addEventListener("submit", (ev) => ev.preventDefault());
  m.el.querySelector("[data-compartilhar]").addEventListener("click", () => compartilhar(p));
  botaoFav.addEventListener("click", () => { m.fechar(); alternarFavorito(p.id, ctx); });

  botaoAdd.addEventListener("click", () => {
    const s = selecao();
    if (faltando(s)) return;
    adicionar({ produto_id: p.id, qtd, opcoes: s, obs: form.elements.obs.value });
    toast(`${p.nome} adicionado ao carrinho.`);
    m.fechar();
  });

  desligar = ouvir("favoritos", desenharFavorito);
  desenharFavorito();
  atualizar();
  return m;
}
