/* PÁGINA — estoque: previsão de compras, ingredientes, receitas, custos, lucro e histórico (só administrador) */
import { html, montar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { cabecalhoPagina } from "../componentes/pagina.js";
import { previsaoEstoque } from "../componentes/estoque-previsao.js";
import { ingredientesEstoque } from "../componentes/estoque-ingredientes.js";
import { receitasEstoque } from "../componentes/estoque-receitas.js";
import { preparosEstoque } from "../componentes/estoque-preparos.js";
import { historicoEstoque } from "../componentes/estoque-historico.js";
import { custosEstoque } from "../componentes/estoque-custos.js";
import { lucroEstoque } from "../componentes/estoque-lucro.js";
import { contagemEstoque } from "../componentes/estoque-contagem.js";
import { simuladorEstoque } from "../componentes/estoque-simulador.js";

// id da rota -> [texto do menu, ícone, componente, ids irmãos que também acendem esta aba]
const PAGINAS = {
  previsao: ["Previsão e compras", "carrinho", previsaoEstoque],
  ingredientes: ["Ingredientes", "estoque", ingredientesEstoque],
  receitas: ["Receitas", "livro", receitasEstoque, ["receitas-base"]],
  "receitas-base": ["Receitas-base", "livro", preparosEstoque],
  custos: ["Custos e preços", "dinheiro", custosEstoque],
  lucro: ["Lucro", "grafico", lucroEstoque],
  historico: ["Histórico", "relogio", historicoEstoque],
  contagem: ["Contagem guiada", "check", contagemEstoque],
  simulador: ["Simulador", "calculadora", simuladorEstoque],
};
// só estas aparecem no menu de abas; as demais (receitas-base, contagem, simulador) são alcançadas por link
const MENU = ["previsao", "ingredientes", "receitas", "custos", "lucro", "historico"];

export async function estoque(ctx) {
  const id = PAGINAS[ctx.params.aba] ? ctx.params.aba : "previsao";
  const [, , componente] = PAGINAS[id];
  const acesa = (m) => m === id || (PAGINAS[m][3] ?? []).includes(id);

  montar(ctx.raiz, html`
    ${cabecalhoPagina({ titulo: "Estoque", descricao: "Ingredientes, receitas, custos e previsão do que vai faltar para os pedidos agendados." })}
    <nav class="abas-status est__sem-impressao" aria-label="Seções do estoque">${MENU.map((m) => html`
      <a href="#/estoque/${m}" class="aba-status ${acesa(m) && "aba-status--ativa"}">${icone(PAGINAS[m][1], { tamanho: 16 })} ${PAGINAS[m][0]}</a>`)}</nav>
    <div id="estoque-conteudo"></div>`);
  await componente({ ...ctx, raiz: ctx.raiz.querySelector("#estoque-conteudo") });
}
