/* ==========================================================
   ESTOQUE — aba Custos e preços: margem de cada produto, preço
   sugerido a partir da margem desejada e aviso de ingredientes
   que ficaram mais caros (e o que eles afetam).
   ========================================================== */
import { html, montar, delegar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { confirmar, ocupado, toast } from "/src/scripts/base/ui.js";
import { ativarCampos, campo, dadosDe } from "/src/scripts/base/formularios.js";
import { brl } from "/src/scripts/base/formatacao.js";
import { api } from "../nucleo/api.js";
import { numero } from "../nucleo/estoque.js";
import { carregandoPagina, erroPagina, vazio } from "./pagina.js";

export async function custosEstoque(ctx) {
  montar(ctx.raiz, carregandoPagina);
  let r;

  async function carregar() {
    try { r = await api.get("/estoque/custos"); }
    catch (erro) { montar(ctx.raiz, erroPagina(erro.message)); return false; }
    return ctx.ativo();
  }

  function desenhar() {
    montar(ctx.raiz, html`
      <section class="cartao est-config">
        <div class="cartao__cab"><div><h2>Margem que você quer ganhar</h2><small class="texto-suave">Usada para calcular o preço sugerido de cada produto.</small></div></div>
        <form id="form-margem" novalidate>
          <div class="grade-campos grade-campos--2">
            ${campo({ nome: "margem_alvo", rotulo: "Margem desejada (%)", tipo: "number", valor: r.margem_alvo, atributos: 'min="0" max="95"', ajuda: "Ex.: 60% quer dizer que o custo é até 40% do preço de venda." })}
            ${campo({ nome: "alerta_alta_pct", rotulo: "Avisar quando um ingrediente subir (%)", tipo: "number", valor: r.alerta_alta_pct, atributos: 'min="1" max="100"', ajuda: "Comparado ao preço de cerca de 30 dias atrás." })}
          </div>
          <div class="cartao__rodape"><button type="submit" class="btn btn--primario">Salvar</button></div>
        </form>
      </section>

      ${r.altas.length > 0 && html`<section class="cartao est-secao">
        <h2 class="cartao__titulo">${icone("alerta", { tamanho: 18 })} Ingredientes que ficaram mais caros</h2>
        <div class="tabela-rolagem"><table class="tabela">
          <thead><tr><th>Ingrediente</th><th class="texto-direita">Antes</th><th class="texto-direita">Agora</th><th class="texto-direita">Variação</th><th>Afeta</th></tr></thead>
          <tbody>${r.altas.map((a) => html`<tr>
            <td><strong>${a.nome}</strong><br><small class="texto-suave">desde ${a.desde.split("-").reverse().join("/")}</small></td>
            <td class="texto-direita">${brl(Math.round(a.de * 1000))} / kg</td>
            <td class="texto-direita">${brl(Math.round(a.para * 1000))} / kg</td>
            <td class="texto-direita"><span class="badge badge--perigo">+${numero(a.variacao_pct)}%</span></td>
            <td><small>${a.produtos.map((p) => `${p.nome}${p.margem_pct != null ? ` (${numero(p.margem_pct)}%)` : ""}`).join(", ") || "nenhum produto ainda"}</small></td>
          </tr>`)}</tbody></table></div>
      </section>`}

      <section class="cartao cartao--sem-margem est-secao" id="custos-tabela">
        <h2 class="cartao__titulo">Margem por produto</h2>
        ${r.produtos.length ? html`<div class="tabela-rolagem"><table class="tabela">
          <thead><tr><th>Produto</th><th class="texto-direita">Custo</th><th class="texto-direita">Preço</th><th class="texto-direita">Margem</th><th class="texto-direita">Preço sugerido</th><th></th></tr></thead>
          <tbody>${r.produtos.map((p) => html`<tr>
            <td><strong>${p.nome}</strong>${!p.ativo && html` <span class="badge badge--neutro">Fora do cardápio</span>`}<br><small class="texto-suave">${p.categoria}</small></td>
            <td class="texto-direita">${brl(p.custo_unit)}</td>
            <td class="texto-direita">${brl(p.preco)}</td>
            <td class="texto-direita"><strong class="${p.margem_pct < 0 ? "est__qtd--zero" : p.abaixo ? "est__margem--baixa" : ""}">${brl(p.margem)}</strong><br><small class="texto-suave">${numero(p.margem_pct)}%</small></td>
            <td class="texto-direita">${p.abaixo ? html`<strong>${brl(p.preco_sugerido)}</strong>` : html`<span class="texto-suave">—</span>`}</td>
            <td class="texto-direita nowrap">${p.abaixo && html`<button type="button" class="btn btn--suave btn--pequeno" data-acao="aplicar" data-id="${p.id}" data-preco="${p.preco_sugerido}">Usar sugerido</button>`}</td>
          </tr>`)}</tbody></table></div>`
          : vazio("dinheiro", "Nenhum produto com receita ainda", "Cadastre as receitas em Estoque → Receitas para ver custo e margem aqui.",
            html`<a href="#/estoque/receitas" class="btn btn--primario">Ir para Receitas</a>`)}
      </section>`);
  }

  delegar(ctx.raiz, {
    aplicar: async (el) => {
      const p = r.produtos.find((x) => x.id === Number(el.dataset.id));
      if (!(await confirmar({ titulo: "Ajustar preço", mensagem: `Mudar o preço de "${p.nome}" de ${brl(p.preco)} para ${brl(p.preco_sugerido)}?`, rotulo: "Ajustar" }))) return;
      try { await api.put(`/estoque/preco-produto/${p.id}`, { preco: p.preco_sugerido }); toast("Preço atualizado!"); if (await carregar()) desenhar(); }
      catch (erro) { toast(erro.message, "erro"); }
    },
  });
  ctx.raiz.addEventListener("submit", async (ev) => {
    if (ev.target.id !== "form-margem") return;
    ev.preventDefault();
    ativarCampos(ev.target);
    const d = dadosDe(ev.target);
    await ocupado(ev.target.querySelector("[type=submit]"), async () => {
      try { await api.put("/estoque/custos", { margem_alvo: Number(d.margem_alvo), alerta_alta_pct: Number(d.alerta_alta_pct) }); toast("Configuração salva!"); if (await carregar()) desenhar(); }
      catch (erro) { toast(erro.message, "erro"); }
    });
  });

  if (await carregar()) desenhar();
}
