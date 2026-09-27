/* ==========================================================
   ESTOQUE — janelas de detalhe de um ingrediente: lotes com
   validade e histórico de preço.
   ========================================================== */
import { html, bruto, montar, delegar } from "/src/scripts/base/html.js";
import { abrirModal, confirmar, toast } from "/src/scripts/base/ui.js";
import { brl, dataBR, dataHora } from "/src/scripts/base/formatacao.js";
import { api } from "../nucleo/api.js";
import { SITUACAO_LOTE, custoTexto, numero, qtdTexto, validadeTexto } from "../nucleo/estoque.js";
import { vazio } from "./pagina.js";

/** Lotes (compras com validade) de um ingrediente; o vencido pode ser descartado (vira perda). */
export async function abrirLotes(ing, { aoMudar } = {}) {
  const m = abrirModal({ titulo: `Validades — ${ing.nome}`, largura: 620, corpo: html`<div id="lotes-corpo"><div class="carregando-pagina" role="status"><div class="spinner"></div></div></div>`,
    rodape: html`<button type="button" class="btn btn--suave" data-fechar>Fechar</button>` });
  const corpo = m.el.querySelector("#lotes-corpo");
  let lotes;

  async function carregar() {
    try { lotes = (await api.get(`/estoque/lotes?ingrediente_id=${ing.id}`)).lotes; }
    catch (erro) { corpo.textContent = erro.message; return; }
    montar(corpo, lotes.length ? html`
      <p class="texto-suave">Cada compra com validade vira um lote. O que vence primeiro sai primeiro quando a receita usa o ingrediente.</p>
      <div class="tabela-rolagem"><table class="tabela">
        <thead><tr><th>Quantidade</th><th>Validade</th><th>Situação</th><th></th></tr></thead>
        <tbody>${lotes.map((l) => { const [classe, texto] = SITUACAO_LOTE[l.situacao]; return html`<tr>
          <td><strong>${qtdTexto(l.quantidade, l.unidade)}</strong></td>
          <td>${dataBR(l.validade)}<br><small class="texto-suave">${validadeTexto(l.dias)}</small></td>
          <td><span class="badge ${classe}">${texto}</span></td>
          <td class="texto-direita"><button type="button" class="btn btn--suave btn--pequeno" data-acao="descartar" data-id="${l.id}">Descartar</button></td></tr>`; })}</tbody></table></div>`
      : vazio("relogio", "Nenhum lote com validade", "Ao lançar uma compra, informe a validade e ela passa a ser acompanhada aqui."));
  }

  delegar(m.el, {
    descartar: async (el) => {
      const l = lotes.find((x) => x.id === Number(el.dataset.id));
      if (!(await confirmar({ titulo: "Descartar lote", mensagem: `Descartar ${qtdTexto(l.quantidade, l.unidade)} de ${ing.nome} (${validadeTexto(l.dias)})? Sai do estoque como perda.`, rotulo: "Descartar", perigo: true }))) return;
      try { await api.delete(`/estoque/lotes/${l.id}`); toast("Lote descartado."); await carregar(); aoMudar?.(); }
      catch (erro) { toast(erro.message, "erro"); }
    },
  });
  await carregar();
}

/** Linha do tempo do preço em SVG simples (sem biblioteca): do mais antigo ao mais novo. */
function tracado(valores) {
  if (valores.length < 2) return "";
  const l = 420, a = 70, mx = Math.max(...valores), mn = Math.min(...valores), faixa = mx - mn || 1;
  const pontos = valores.map((v, i) => `${(6 + (i / (valores.length - 1)) * (l - 12)).toFixed(1)},${(a - 8 - ((v - mn) / faixa) * (a - 16)).toFixed(1)}`);
  const [ux, uy] = pontos.at(-1).split(",");
  return bruto(`<svg class="est-traco" viewBox="0 0 ${l} ${a}" role="img" aria-label="Evolução do preço" preserveAspectRatio="none">
    <polyline points="${pontos.join(" ")}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    <circle cx="${ux}" cy="${uy}" r="4" fill="currentColor"/></svg>`);
}

/** Todos os preços que o ingrediente já teve, com a variação de cada mudança. */
export async function abrirPrecos(ing) {
  const m = abrirModal({ titulo: `Preço — ${ing.nome}`, largura: 620, corpo: html`<div id="precos-corpo"><div class="carregando-pagina" role="status"><div class="spinner"></div></div></div>`,
    rodape: html`<button type="button" class="btn btn--suave" data-fechar>Fechar</button>` });
  const corpo = m.el.querySelector("#precos-corpo");
  let r;
  try { r = await api.get(`/estoque/precos/${ing.id}`); } catch (erro) { corpo.textContent = erro.message; return; }
  const un = r.ingrediente.unidade;
  montar(corpo, r.precos.length ? html`
    <p class="texto-suave">Cada vez que o preço da embalagem muda (na edição ou numa compra com valor), o sistema guarda aqui. É com ele que avisa quando um ingrediente fica mais caro.</p>
    ${r.precos.length > 1 && html`<div class="est-traco-caixa">${tracado(r.precos.map((p) => Number(p.custo_unit)).reverse())}</div>`}
    <div class="tabela-rolagem"><table class="tabela">
      <thead><tr><th>Quando</th><th class="texto-direita">Embalagem</th><th class="texto-direita">Preço de referência</th><th class="texto-direita">Variação</th></tr></thead>
      <tbody>${r.precos.map((p) => html`<tr>
        <td class="nowrap"><small>${dataHora(p.quando)}</small></td>
        <td class="texto-direita">${brl(p.embalagem_preco)}<br><small class="texto-suave">${r.ingrediente.embalagem_nome} de ${qtdTexto(p.embalagem_qtd, un)}</small></td>
        <td class="texto-direita">${custoTexto({ custo_unit: p.custo_unit, unidade: un })}</td>
        <td class="texto-direita">${p.variacao_pct == null ? html`<span class="texto-suave">—</span>`
          : html`<span class="badge ${Number(p.variacao_pct) > 0 ? "badge--perigo" : Number(p.variacao_pct) < 0 ? "badge--sucesso" : "badge--neutro"}">${Number(p.variacao_pct) > 0 ? "+" : ""}${numero(p.variacao_pct)}%</span>`}</td>
      </tr>`)}</tbody></table></div>`
    : vazio("dinheiro", "Sem preço registrado", "Informe o preço da embalagem no cadastro do ingrediente para acompanhar as mudanças."));
}
