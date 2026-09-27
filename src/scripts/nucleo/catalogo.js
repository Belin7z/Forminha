/* NÚCLEO — catálogo: carregamento e cálculo de preços com opções */
import { api } from "./api.js";
import { emitir, estado } from "./estado.js";

export async function carregarCatalogo() {
  const dados = await api.get("/catalogo");
  estado.categorias = dados.categorias;
  estado.produtos = dados.produtos;
  estado.favoritos = new Set(dados.favoritos);
  emitir("catalogo");
  emitir("favoritos");
}

export const produtoPorId = (id) => estado.produtos.find((p) => p.id === Number(id));
export const categoriaPorId = (id) => estado.categorias.find((c) => c.id === Number(id));

/** Valor extra das opções escolhidas. `selecao` = { grupoId: [itemId, …] } */
export function extrasDaSelecao(produto, selecao = {}) {
  let extras = 0;
  for (const grupo of produto.opcoes) {
    for (const id of selecao[grupo.id] ?? []) extras += grupo.itens.find((i) => i.id === id)?.preco ?? 0;
  }
  return extras;
}

/** Opções escolhidas em formato legível: [{ grupo, itens: [{ nome, preco }] }] */
export function descricaoDaSelecao(produto, selecao = {}) {
  return produto.opcoes
    .map((g) => ({
      grupo: g.nome,
      itens: (selecao[g.id] ?? []).map((id) => g.itens.find((i) => i.id === id)).filter(Boolean),
    }))
    .filter((g) => g.itens.length);
}

/** Menor preço possível (para o "a partir de"). */
export function precoInicial(produto) {
  let minimo = produto.preco;
  let variavel = false;
  for (const g of produto.opcoes) {
    if (!g.obrigatorio) continue;
    const menor = Math.min(...g.itens.map((i) => i.preco));
    const maior = Math.max(...g.itens.map((i) => i.preco));
    minimo += menor;
    if (maior !== menor) variavel = true;
  }
  return { preco: minimo, aPartirDe: variavel };
}

/** Produtos mais pedidos primeiro; destaques do painel entram antes de quem nunca foi vendido. */
export function maisPedidos(limite = 8) {
  return [...estado.produtos]
    .sort((a, b) => (b.vendidos - a.vendidos) || (Number(b.destaque) - Number(a.destaque)) || (a.ordem - b.ordem))
    .slice(0, limite);
}
