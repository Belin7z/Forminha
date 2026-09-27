/* ==========================================================
   ESTOQUE — aba Lucro: receita, custo e lucro de verdade por
   período, produto e pedido (não só o que foi vendido, o que
   sobrou depois de pagar os ingredientes).
   ========================================================== */
import { html, montar, delegar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { brl, brlInteiro, dataBR, dataCurta, plural } from "/src/scripts/base/formatacao.js";
import { dataISO } from "/src/scripts/base/agendamento.js";
import { api } from "../nucleo/api.js";
import { carregandoPagina, erroPagina, indicador, vazio } from "./pagina.js";
import { ativarGraficos, graficoBarras, ranking } from "./grafico.js";
import { abrirPedido } from "./detalhe-pedido.js";

const PERIODOS = [{ dias: 7, texto: "7 dias" }, { dias: 30, texto: "30 dias" }, { dias: 90, texto: "90 dias" }, { dias: 365, texto: "12 meses" }];
const somarDias = (iso, n) => { const [a, m, d] = iso.split("-").map(Number); return dataISO(new Date(a, m - 1, d + n)); };

export async function lucroEstoque(ctx) {
  montar(ctx.raiz, carregandoPagina);
  let dias = 30, soEntregues = false, r;

  async function carregar() {
    const ate = dataISO(new Date()), de = somarDias(ate, -(dias - 1));
    try { r = await api.get(`/estoque/lucro?de=${de}&ate=${ate}&so_entregues=${soEntregues}`); }
    catch (erro) { if (ctx.ativo()) montar(ctx.raiz, erroPagina(erro.message)); return false; }
    return ctx.ativo();
  }

  function desenhar() {
    const t = r.totais;
    montar(ctx.raiz, html`
      <div class="prod__controles cartao cartao--sem-margem">
        <div class="segmentos" role="group" aria-label="Período">${PERIODOS.map((p) => html`<button type="button" class="segmento ${p.dias === dias && "segmento--ativo"}" data-acao="periodo" data-dias="${p.dias}" aria-pressed="${String(p.dias === dias)}">${p.texto}</button>`)}</div>
        <label class="prod__opcao"><input type="checkbox" data-acao-mudar="entregues" ${soEntregues && "checked"}> Só pedidos já entregues</label>
        <span class="texto-suave">${dataBR(r.de)} a ${dataBR(r.ate)}</span></div>

      ${t.pedidos === 0 ? vazio("grafico", "Nada no período", "Quando houver pedidos com receita cadastrada, o lucro aparece aqui.") : html`
      <section class="kpis" aria-label="Resumo">
        ${indicador({ rotulo: "Receita", valor: brl(t.receita), nota: plural(t.pedidos, "pedido"), icone: icone("dinheiro", { tamanho: 16 }) })}
        ${indicador({ rotulo: "Custo dos ingredientes", valor: brl(t.custo), nota: "pelos preços de hoje", icone: icone("carrinho", { tamanho: 16 }) })}
        ${indicador({ rotulo: "Lucro", valor: brl(t.lucro), nota: t.margem_pct != null ? `margem de ${t.margem_pct}%` : "", destaque: true, icone: icone("grafico", { tamanho: 16 }) })}
        ${indicador({ rotulo: "Sem receita cadastrada", valor: brl(t.receita_sem_custo), nota: "fica fora da conta de lucro", icone: icone("info", { tamanho: 16 }) })}
      </section>

      <section class="cartao">
        <div class="cartao__cab"><h2>Lucro por dia</h2></div>
        ${graficoBarras({ titulo: "Lucro diário", dados: r.serie.map((d) => ({ rotulo: dataCurta(d.dia), valor: d.lucro, dica: `${dataBR(d.dia)} · lucro ${brl(d.lucro)} (receita ${brl(d.receita)}, custo ${brl(d.custo)})` })), formato: brl, formatoEixo: brlInteiro, colunaValor: "Lucro" })}
      </section>

      <div class="painel-grade painel-grade--2-1">
        <section class="cartao cartao--sem-margem">
          <div class="cartao__cab"><h2>Lucro por produto</h2></div>
          ${r.produtos.length ? html`<div class="tabela-rolagem"><table class="tabela">
            <thead><tr><th>Produto</th><th class="texto-direita">Qtd</th><th class="texto-direita">Receita</th><th class="texto-direita">Custo</th><th class="texto-direita">Lucro</th><th class="texto-direita">Margem</th></tr></thead>
            <tbody>${r.produtos.map((p) => html`<tr>
              <td><strong>${p.nome}</strong>${p.produto_id == null && html` <span class="badge badge--neutro" title="Sem receita cadastrada">avulso</span>`}</td>
              <td class="texto-direita">${p.qtd}</td>
              <td class="texto-direita">${brl(p.receita)}</td>
              <td class="texto-direita">${p.produto_id != null ? brl(p.custo) : "—"}</td>
              <td class="texto-direita"><strong class="${p.lucro < 0 && "est__qtd--zero"}">${p.produto_id != null ? brl(p.lucro) : "—"}</strong></td>
              <td class="texto-direita">${p.margem_pct != null ? `${p.margem_pct}%` : "—"}</td>
            </tr>`)}</tbody></table></div>` : ""}
        </section>
        <section class="cartao">
          <div class="cartao__cab"><h2>Mais lucrativos</h2></div>
          ${ranking({ dados: r.produtos.filter((p) => p.produto_id != null).map((p) => ({ rotulo: p.nome, valor: p.lucro })), formato: brl, vazio: "Sem produtos com receita no período." })}
        </section>
      </div>

      <section class="cartao">
        <div class="cartao__cab"><h2>Pedidos do período</h2><small class="texto-suave">os 200 mais recentes</small></div>
        <div class="tabela-rolagem"><table class="tabela">
          <thead><tr><th>Pedido</th><th>Cliente</th><th>Data</th><th class="texto-direita">Receita</th><th class="texto-direita">Custo</th><th class="texto-direita">Lucro</th><th></th></tr></thead>
          <tbody>${r.pedidos.map((p) => html`<tr>
            <td><strong>${p.codigo}</strong>${p.parcial && html` <span class="badge badge--neutro" title="Tem item sem receita: o lucro é parcial">parcial</span>`}</td>
            <td>${p.cliente}</td><td>${dataBR(p.dia)}</td>
            <td class="texto-direita">${brl(p.receita)}</td><td class="texto-direita">${brl(p.custo)}</td>
            <td class="texto-direita"><strong class="${p.lucro < 0 && "est__qtd--zero"}">${brl(p.lucro)}</strong></td>
            <td class="texto-direita"><button type="button" class="btn btn--suave btn--pequeno" data-acao="abrir" data-id="${p.id}">Abrir</button></td>
          </tr>`)}</tbody></table></div>
      </section>`}`);
  }

  delegar(ctx.raiz, {
    periodo: async (el) => { dias = Number(el.dataset.dias); if (await carregar()) desenhar(); },
    abrir: (el) => abrirPedido(el.dataset.id, () => carregar().then((ok) => ok && desenhar())),
  });
  ctx.raiz.addEventListener("change", async (ev) => {
    if (ev.target.dataset?.acaoMudar !== "entregues") return;
    soEntregues = ev.target.checked;
    if (await carregar()) desenhar();
  });
  ativarGraficos(ctx.raiz);

  if (await carregar()) desenhar();
}
