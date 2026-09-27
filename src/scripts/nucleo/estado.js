/* ==========================================================
   ESTADO — dados compartilhados da loja (configuração, cliente
   logado, catálogo, favoritos). Quando algo muda, as partes da
   tela são avisadas por eventos ("usuario", "carrinho",
   "favoritos", "catalogo").
   ========================================================== */
export { emitir, ouvir } from "/src/scripts/base/eventos.js";

export const estado = {
  config: null,          // configurações públicas (loja, horários, entrega, pagamento…)
  usuario: null,         // cliente logado, ou null
  categorias: [],
  produtos: [],
  favoritos: new Set(),  // ids dos produtos favoritados
};
