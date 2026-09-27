/* ESTADO — dados globais do painel */
export { emitir, ouvir } from "/src/scripts/base/eventos.js";

export const estado = {
  usuario: null,   // administrador logado
  loja: {},        // nome, slogan e logo da loja (para a marca no menu e no login)
  contagem: {},    // pedidos por status (para os selos do menu)
  estoque: { risco: 0 }, // ingredientes que precisam de atenção (selo do menu Estoque)
};
