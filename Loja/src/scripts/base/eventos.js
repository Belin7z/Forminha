/* EVENTOS — mini sistema de avisos entre partes da tela ("o carrinho mudou", "chegou pedido novo"…) */
const ouvintes = new Map();

/** Escuta um tópico. Devolve a função que cancela a escuta. */
export function ouvir(topico, fn) {
  if (!ouvintes.has(topico)) ouvintes.set(topico, new Set());
  ouvintes.get(topico).add(fn);
  return () => ouvintes.get(topico).delete(fn);
}

export function emitir(topico, dados) {
  ouvintes.get(topico)?.forEach((fn) => fn(dados));
}
