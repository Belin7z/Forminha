/* NÚCLEO — catálogo: carregamento e cálculo de preços com opções */
import { api } from "./api.js";
import { emitir, estado } from "./estado.js";

export { descricaoDaSelecao, extrasDaSelecao } from "/src/scripts/base/opcoes.js";

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

/** Menor preço possível (para o "a partir de"). Na caixa, o sabor mais barato vezes o total. */
export function precoInicial(produto) {
  let minimo = produto.preco;
  let variavel = false;
  for (const g of produto.opcoes) {
    if (!g.obrigatorio) continue;
    const menor = Math.min(...g.itens.map((i) => i.preco));
    const maior = Math.max(...g.itens.map((i) => i.preco));
    minimo += menor * (g.tipo === "quantidade" ? g.total : 1);
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
