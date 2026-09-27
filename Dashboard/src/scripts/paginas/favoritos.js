/* PÁGINA — favoritos: quais produtos os clientes mais guardam */
import { html, montar } from "/src/scripts/base/html.js";
import { plural } from "/src/scripts/base/formatacao.js";
import { api } from "../nucleo/api.js";
import { cabecalhoPagina, carregandoPagina, erroPagina, indicador } from "../componentes/pagina.js";
import { ranking } from "../componentes/grafico.js";

export async function favoritos(ctx) {
  montar(ctx.raiz, carregandoPagina);
  let d;
  try { d = await api.get("/favoritos"); }
  catch (erro) { montar(ctx.raiz, erroPagina(erro.message)); return; }
  if (!ctx.ativo()) return;

  const comFavoritos = d.ranking.filter((p) => p.favoritos > 0);
  const semFavoritos = d.ranking.filter((p) => p.favoritos === 0);

  montar(ctx.raiz, html`
    ${cabecalhoPagina({ titulo: "Favoritos", descricao: "Os produtos que os clientes mais guardam — ótimos candidatos a destaque e promoção." })}
    <section class="kpis kpis--3">
      ${indicador({ rotulo: "Favoritos no total", valor: d.total_favoritos })}
      ${indicador({ rotulo: "Clientes com favoritos", valor: d.clientes_com_favoritos })}
      ${indicador({ rotulo: "Produto mais amado", valor: comFavoritos[0] ? comFavoritos[0].nome : "—", nota: comFavoritos[0] ? plural(comFavoritos[0].favoritos, "favorito") : "" })}
    </section>
    <section class="cartao">
      <div class="cartao__cab"><h2>Ranking de favoritos</h2></div>
      ${ranking({ dados: comFavoritos.map((p) => ({ rotulo: `${p.nome}${p.ativo ? "" : " (oculto)"}`, valor: p.favoritos })), formato: (n) => `${n} ${n === 1 ? "favorito" : "favoritos"}`, vazio: "Ninguém favoritou nada ainda. Quando os clientes tocarem no coração, o ranking aparece aqui." })}
    </section>
    ${semFavoritos.length > 0 && html`<section class="cartao"><div class="cartao__cab"><h2>Sem nenhum favorito</h2><small class="texto-suave">${semFavoritos.length} produtos</small></div>
      <p class="chips-simples">${semFavoritos.map((p) => html`<span class="badge badge--neutro">${p.nome}</span>`)}</p></section>`}`);
}
