/* ==========================================================
   OPÇÕES DO PRODUTO — a escolha do cliente e o que ela custa.
   Três tipos de grupo (o banco confere igual em _resolver_opcoes):
     • "unica": uma opção          -> { g1: ["g1i2"] }
     • "multipla": várias (até max) -> { g2: ["g2i1", "g2i3"] }
     • "quantidade" (monte sua caixa): quantas de cada, somando o
       total do grupo                -> { g3: { g3i1: 10, g3i2: 15 } }
   No pedido, cada escolha vira { grupo, itens: [{ nome, preco, qtd? }] }.
   Código puro, igual na Loja e no Dashboard.
   ========================================================== */

const ehCaixa = (g) => g.tipo === "quantidade";

/** Quantas unidades já foram distribuídas num grupo "quantidade". */
export const somaDaCaixa = (escolha) => Object.values(escolha && typeof escolha === "object" && !Array.isArray(escolha) ? escolha : {})
  .reduce((s, n) => s + (Number(n) || 0), 0);

/** Valor extra das opções escolhidas (por unidade do produto). */
export function extrasDaSelecao(produto, selecao = {}) {
  let extras = 0;
  for (const g of produto.opcoes ?? []) {
    const escolha = selecao[g.id];
    if (ehCaixa(g)) {
      for (const [id, n] of Object.entries(escolha ?? {})) extras += (g.itens.find((i) => i.id === id)?.preco ?? 0) * (Number(n) || 0);
    } else {
      for (const id of Array.isArray(escolha) ? escolha : []) extras += g.itens.find((i) => i.id === id)?.preco ?? 0;
    }
  }
  return extras;
}

/** Opções escolhidas em formato legível (o mesmo do pedido): [{ grupo, itens: [{ nome, preco, qtd? }] }] */
export function descricaoDaSelecao(produto, selecao = {}) {
  return (produto.opcoes ?? [])
    .map((g) => {
      const escolha = selecao[g.id];
      const itens = ehCaixa(g)
        ? g.itens.filter((i) => Number(escolha?.[i.id]) > 0).map((i) => ({ ...i, qtd: Number(escolha[i.id]) }))
        : (Array.isArray(escolha) ? escolha : []).map((id) => g.itens.find((i) => i.id === id)).filter(Boolean);
      return { grupo: g.nome, itens };
    })
    .filter((g) => g.itens.length);
}

/** O grupo que ainda falta (obrigatório sem escolha ou caixa sem o total certo), com a frase do botão; ou null. */
export function faltandoNaSelecao(produto, selecao = {}) {
  for (const g of produto.opcoes ?? []) {
    if (ehCaixa(g)) {
      const soma = somaDaCaixa(selecao[g.id]);
      if (soma < g.total) return { grupo: g, texto: `${g.nome}: faltam ${g.total - soma}` };
      if (soma > g.total) return { grupo: g, texto: `${g.nome}: tire ${soma - g.total}` };
    } else if (g.obrigatorio && !(selecao[g.id]?.length)) {
      return { grupo: g, texto: `Escolha: ${g.nome}` };
    }
  }
  return null;
}

/** Nome de um item escolhido com a quantidade, quando é de caixa ("10× Ninho"). */
export const nomeComQuantidade = (item) => (typeof item === "string" ? item : item.qtd ? `${item.qtd}× ${item.nome}` : item.nome);

/** "Sabores: 10× Ninho, 15× Beijinho · Fita: Rosa" (a partir da descrição do pedido). */
export const opcoesEmTexto = (descricao) => (Array.isArray(descricao) ? descricao : [])
  .map((o) => `${o.grupo}: ${(o.itens ?? []).map(nomeComQuantidade).join(", ")}`)
  .join(" · ");

/** Identifica "a mesma escolha" (para juntar no carrinho): a ordem não importa. */
export function chaveDaSelecao(selecao = {}) {
  return Object.keys(selecao).sort().map((g) => {
    const e = selecao[g];
    const partes = Array.isArray(e) ? [...e].sort() : Object.entries(e ?? {}).filter(([, n]) => Number(n) > 0).map(([id, n]) => `${id}=${n}`).sort();
    return `${g}:${partes.join(",")}`;
  }).join("|");
}

/** Do pedido antigo de volta à escolha (pelo nome do grupo e das opções) — para "pedir de novo". */
export function selecaoDaDescricao(produto, descricao = []) {
  const selecao = {};
  for (const escolha of descricao) {
    const g = (produto.opcoes ?? []).find((x) => x.nome === escolha.grupo);
    if (!g) continue;
    if (ehCaixa(g)) {
      const caixa = {};
      for (const i of escolha.itens) { const item = g.itens.find((x) => x.nome === i.nome); if (item) caixa[item.id] = Number(i.qtd) || 1; }
      if (somaDaCaixa(caixa) === g.total) selecao[g.id] = caixa; // a caixa mudou de tamanho: o cliente escolhe de novo
    } else {
      selecao[g.id] = escolha.itens.map((i) => g.itens.find((x) => x.nome === i.nome)?.id).filter(Boolean);
    }
  }
  return selecao;
}
