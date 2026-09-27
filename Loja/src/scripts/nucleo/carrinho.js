/* ==========================================================
   CARRINHO — itens escolhidos, guardados no aparelho.
   O preço mostrado aqui é só uma prévia: o servidor recalcula
   tudo (preço, entrega, cupom) quando o pedido é finalizado.
   ========================================================== */
import { armazenamento } from "/src/scripts/base/armazenamento.js";
import { descricaoDaSelecao, extrasDaSelecao, produtoPorId } from "./catalogo.js";
import { emitir, estado } from "./estado.js";

const CHAVE = "zq.carrinho.v2";
let itens = armazenamento.ler(CHAVE, []);

/** Identifica "o mesmo item": mesmo produto, mesmas opções e mesma observação. */
function chaveDe({ produto_id, opcoes = {}, obs = "" }) {
  const partes = Object.keys(opcoes).sort().map((g) => `${g}:${[...opcoes[g]].sort().join(",")}`).join("|");
  return `${produto_id}#${partes}#${obs.trim()}`;
}

function salvar() {
  armazenamento.gravar(CHAVE, itens);
  emitir("carrinho");
}

/** Remove do carrinho o que saiu do cardápio (chamado depois de carregar o catálogo). */
export function limparIndisponiveis() {
  const antes = itens.length;
  itens = itens.filter((i) => produtoPorId(i.produto_id));
  if (itens.length !== antes) salvar();
  return antes - itens.length;
}

export function adicionar({ produto_id, qtd, opcoes = {}, obs = "" }) {
  const novo = { produto_id: Number(produto_id), qtd, opcoes, obs: obs.trim() };
  novo.chave = chaveDe(novo);
  const existente = itens.find((i) => i.chave === novo.chave);
  if (existente) existente.qtd += qtd;
  else itens.push(novo);
  salvar();
}

export function alterarQtd(chave, delta) {
  const item = itens.find((i) => i.chave === chave);
  if (!item) return;
  const minimo = produtoPorId(item.produto_id)?.min_qtd ?? 1;
  item.qtd += delta;
  if (item.qtd < minimo) itens = itens.filter((i) => i.chave !== chave); // abaixo do mínimo, sai
  salvar();
}

export function remover(chave) {
  itens = itens.filter((i) => i.chave !== chave);
  salvar();
}

export function limpar() {
  itens = [];
  salvar();
}

/** Itens com os dados do produto e o total já calculado. */
export function linhas() {
  return itens
    .map((i) => {
      const produto = produtoPorId(i.produto_id);
      if (!produto) return null;
      const unitario = produto.preco + extrasDaSelecao(produto, i.opcoes);
      return {
        chave: i.chave, produto, qtd: i.qtd, obs: i.obs, opcoes: i.opcoes,
        escolhas: descricaoDaSelecao(produto, i.opcoes), unitario, total: unitario * i.qtd,
      };
    })
    .filter(Boolean);
}

export const subtotal = () => linhas().reduce((soma, l) => soma + l.total, 0);
export const quantidade = () => itens.reduce((soma, i) => soma + i.qtd, 0);

/** Antecedência exigida pelo carrinho: a maior entre a da loja e a dos produtos. */
export function antecedenciaHoras() {
  return linhas().reduce((maior, l) => Math.max(maior, l.produto.antecedencia_horas ?? 0), estado.config.pedidos.antecedencia_horas);
}

/** Formato enviado à API. */
export const paraApi = () => itens.map(({ produto_id, qtd, opcoes, obs }) => ({ produto_id, qtd, opcoes, obs }));
