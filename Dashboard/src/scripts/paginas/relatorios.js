/* ==========================================================
   PÁGINA — Relatórios de vendas (só o administrador).
   Hoje · 7 dias · 30 dias · Este mês · Mês passado · 12 meses ·
   Por ano · Personalizado, pela data do pedido ou da entrega.
   Números comparados com o período anterior, gráfico por hora,
   dia, mês ou ano, o que mais vende, como pagam, quando compram,
   melhores clientes, cupons, lucro estimado, lista de pedidos,
   planilha e impressão.
   ========================================================== */
import { html, montar, delegar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { brl, brlInteiro, dataBR, dataHora, plural } from "/src/scripts/base/formatacao.js";
import { FORMAS_PAGAMENTO, STATUS_TEXTO } from "/src/scripts/base/dominio.js";
import { PERIODOS, SEMANA, SEMANA_LONGA, periodo, rotulosDe, variacao } from "/src/scripts/base/periodo.js";
import { armazenamento } from "/src/scripts/base/armazenamento.js";
import { api } from "../nucleo/api.js";
import { cabecalhoPagina, carregandoPagina, erroPagina, indicador } from "../componentes/pagina.js";
import { ativarGraficos, graficoBarras, ranking } from "../componentes/grafico.js";
import { abrirPedido } from "../componentes/detalhe-pedido.js";
import { baixarCsv } from "../componentes/planilha.js";

const TITULO = { hora: "por hora", dia: "por dia", mes: "por mês", ano: "por ano" };
const TIPOS = { entrega: "Entrega", retirada: "Retirada" };
const NA_TELA = 50; // pedidos mostrados na lista (a planilha leva todos)
const emReaisPlanilha = (c) => (Number(c || 0) / 100).toFixed(2).replace(".", ",");
const intervalo = (de, ate) => (de === ate ? dataBR(de) : `${dataBR(de)} a ${dataBR(ate)}`);

/** "▲ 12% vs. R$ 900 antes" (sobe em verde, desce em vermelho). */
function comparacao(atual, anterior, formato = (v) => v) {
  const v = variacao(atual, anterior);
  if (!v) return atual ? "sem vendas no período anterior" : "";
  return html`<span class="variacao variacao--${v.sobe ? "sobe" : "desce"}">${icone(v.sobe ? "cima" : "baixo", { tamanho: 12 })} ${v.pct}%</span> vs. ${formato(anterior)} antes`;
}

/** Tabela simples: colunas [{ titulo, valor(linha), direita, extra }] — "extra" some no celular. */
const tabela = (colunas, linhas, { rotulo = "", clicavel = null } = {}) => html`
  <div class="tabela-rolagem"><table class="tabela tabela--compacta ${clicavel && "tabela--clicavel"}" aria-label="${rotulo}">
    <thead><tr>${colunas.map((c) => html`<th class="${c.direita && "texto-direita"} ${c.extra && "relatorio__extra"}">${c.titulo}</th>`)}</tr></thead>
    <tbody>${linhas.map((l) => html`<tr ${clicavel ? html`data-acao="abrir" data-id="${clicavel(l)}" tabindex="0"` : ""}>
      ${colunas.map((c) => html`<td class="${c.direita && "texto-direita"} ${c.extra && "relatorio__extra"}">${c.valor(l)}</td>`)}</tr>`)}</tbody>
  </table></div>`;

export async function relatorios(ctx) {
  montar(ctx.raiz, carregandoPagina);
  let atual = armazenamento.ler("zqp.relatorio-periodo", "mes");
  if (!PERIODOS.some(([id]) => id === atual) || atual === "outro") atual = "mes";
  let base = armazenamento.ler("zqp.relatorio-base", "pedido") === "entrega" ? "entrega" : "pedido";
  let livre = periodo("30d");
  let r = null;
  let todosProdutos = false;

  function barraDeControles() {
    return html`
      <div class="relatorio__controles est__sem-impressao">
        <div class="segmentos" role="group" aria-label="Período">${PERIODOS.map(([id, texto]) => html`
          <button type="button" class="segmento ${id === atual && "segmento--ativo"}" data-acao="periodo" data-periodo="${id}" aria-pressed="${String(id === atual)}">${texto}</button>`)}</div>
        <form class="relatorio__livre" data-livre ${atual !== "outro" && "hidden"} novalidate>
          <label>De <input type="date" class="entrada entrada--curta" name="de" value="${livre.de}" required></label>
          <label>Até <input type="date" class="entrada entrada--curta" name="ate" value="${livre.ate}" required></label>
          <button type="submit" class="btn btn--primario btn--pequeno">Ver</button>
        </form>
        <div class="segmentos segmentos--pequeno" role="group" aria-label="Contar pela data">
          <button type="button" class="segmento ${base === "pedido" && "segmento--ativo"}" data-acao="base" data-base="pedido" aria-pressed="${String(base === "pedido")}">Data do pedido</button>
          <button type="button" class="segmento ${base === "entrega" && "segmento--ativo"}" data-acao="base" data-base="entrega" aria-pressed="${String(base === "entrega")}">Data da entrega</button>
        </div>
      </div>`;
  }

  function desenhar() {
    const t = r.totais, a = r.anterior;
    const aReceber = Math.max(0, t.faturamento - t.recebido);
    const serie = r.serie.map((s) => {
      const rot = rotulosDe(s.chave, r.agrupar);
      return { rotulo: rot.curto, valor: s.total, dica: `${rot.longo} · ${brl(s.total)} · ${plural(s.pedidos, "pedido")}` };
    });
    const comVenda = r.horarios.filter((h) => h.pedidos > 0).map((h) => h.hora);
    const horaIni = Math.min(8, ...comVenda), horaFim = Math.max(20, ...comVenda);
    const horarios = r.horarios.filter((h) => h.hora >= horaIni && h.hora <= horaFim);
    const produtos = todosProdutos ? r.produtos : r.produtos.slice(0, 10);
    const maiorProduto = Math.max(1, ...r.produtos.map((p) => p.receita));
    const somaProdutos = r.produtos.reduce((s, p) => s + p.receita, 0) || 1;

    montar(ctx.raiz, html`
      ${cabecalhoPagina({
        titulo: "Relatórios",
        descricao: html`Vendas de <strong>${intervalo(r.de, r.ate)}</strong>, pela data ${r.base === "entrega" ? "da entrega" : "do pedido"} · comparado com ${intervalo(a.de, a.ate)}`,
        acoes: html`<div class="linha-flex est__sem-impressao">
          <button type="button" class="btn btn--suave btn--pequeno" data-acao="imprimir">${icone("impressora", { tamanho: 15 })} Imprimir</button>
          <button type="button" class="btn btn--suave btn--pequeno" data-acao="planilha" ${!r.lista.length && "disabled"}>${icone("baixar", { tamanho: 15 })} Baixar planilha</button></div>`,
      })}
      ${barraDeControles()}

      <section class="kpis kpis--relatorio" aria-label="Números do período">
        ${indicador({ rotulo: "Faturamento", valor: brl(t.faturamento), nota: comparacao(t.faturamento, a.faturamento, brl), icone: icone("dinheiro", { tamanho: 16 }) })}
        ${indicador({ rotulo: "Pedidos", valor: t.pedidos, nota: comparacao(t.pedidos, a.pedidos), icone: icone("pacote", { tamanho: 16 }) })}
        ${indicador({ rotulo: "Ticket médio", valor: brl(t.ticket), nota: comparacao(t.ticket, a.ticket, brl), icone: icone("etiqueta", { tamanho: 16 }) })}
        ${indicador({ rotulo: "Recebido", valor: brl(t.recebido), nota: aReceber ? `${brl(aReceber)} a receber` : "tudo recebido", destaque: aReceber > 0, icone: icone("check", { tamanho: 16 }) })}
        ${indicador({
          rotulo: "Lucro estimado", valor: t.receita_com_custo ? brl(t.lucro) : "—",
          nota: t.receita_com_custo ? `margem de ${String(t.margem_pct ?? 0).replace(".", ",")}% nos produtos com receita` : html`cadastre as receitas em <a class="link" href="#/estoque">Estoque</a>`,
          icone: icone("grafico", { tamanho: 16 }),
        })}
        ${indicador({ rotulo: "Clientes", valor: t.clientes, nota: t.clientes_novos ? plural(t.clientes_novos, "comprou pela primeira vez", "compraram pela primeira vez") : "nenhum cliente novo", icone: icone("usuarios", { tamanho: 16 }) })}
      </section>

      <section class="cartao">
        <div class="cartao__cab"><div><h2>Faturamento ${TITULO[r.agrupar]}</h2>
          <small class="texto-suave">${plural(t.itens, "item vendido", "itens vendidos")} · ${brl(t.frete)} de entrega · ${brl(t.descontos)} em descontos${t.cancelados ? ` · ${plural(t.cancelados, "cancelado")} (${brl(t.cancelados_total)}) fora da conta` : ""}</small></div></div>
        ${graficoBarras({ titulo: `Faturamento ${TITULO[r.agrupar]}`, dados: serie, formato: brl, formatoEixo: brlInteiro, colunaValor: "Faturamento" })}
      </section>

      <div class="painel-grade painel-grade--2-1">
        <section class="cartao">
          <div class="cartao__cab"><div><h2>Produtos que mais venderam</h2><small class="texto-suave">em valor, já com os descontos</small></div></div>
          ${r.produtos.length ? html`
            ${tabela([
              { titulo: "Produto", valor: (p) => html`<span class="relatorio__produto"><span>${p.nome}</span><span class="relatorio__trilho" aria-hidden="true"><i style="width:${Math.max(2, (p.receita / maiorProduto) * 100)}%"></i></span></span>` },
              { titulo: "Qtd.", valor: (p) => p.qtd, direita: true },
              { titulo: "Pedidos", valor: (p) => p.pedidos, direita: true, extra: true },
              { titulo: "Vendido", valor: (p) => html`<strong>${brl(p.receita)}</strong>`, direita: true },
              { titulo: "% do total", valor: (p) => `${Math.round((p.receita / somaProdutos) * 100)}%`, direita: true, extra: true },
            ], produtos, { rotulo: "Produtos que mais venderam" })}
            ${r.produtos.length > 10 && html`<button type="button" class="link relatorio__mais est__sem-impressao" data-acao="todos-produtos">${todosProdutos ? "Mostrar só os 10 primeiros" : `Ver todos os ${r.produtos.length}`}</button>`}`
          : html`<p class="texto-suave">Nenhum produto vendido no período.</p>`}
        </section>
        <div class="relatorio__coluna">
          <section class="cartao">
            <div class="cartao__cab"><h2>Categorias</h2></div>
            ${ranking({ dados: r.categorias.map((c) => ({ rotulo: c.nome, valor: c.receita })), formato: brl, vazio: "Sem vendas no período." })}
          </section>
          <section class="cartao">
            <div class="cartao__cab"><h2>Entrega ou retirada</h2></div>
            ${ranking({ dados: r.tipos.map((x) => ({ rotulo: `${TIPOS[x.tipo] ?? x.tipo} · ${plural(x.pedidos, "pedido")}`, valor: x.total })), formato: brl, vazio: "Sem vendas no período." })}
          </section>
        </div>
      </div>

      <div class="painel-grade painel-grade--3">
        <section class="cartao">
          <div class="cartao__cab"><div><h2>Como escolheram pagar</h2><small class="texto-suave">na hora do pedido</small></div></div>
          ${ranking({ dados: r.pagamentos.map((x) => ({ rotulo: `${FORMAS_PAGAMENTO[x.pagamento] ?? x.pagamento} · ${x.pedidos}`, valor: x.total })), formato: brl, vazio: "Sem vendas no período." })}
        </section>
        <section class="cartao">
          <div class="cartao__cab"><div><h2>O que já entrou</h2><small class="texto-suave">pagamentos registrados</small></div></div>
          ${ranking({ dados: r.recebimentos.map((x) => ({ rotulo: x.texto, valor: x.valor })), formato: brl, vazio: "Nenhum pagamento registrado ainda." })}
        </section>
        <section class="cartao">
          <div class="cartao__cab"><div><h2>Situação dos pedidos</h2><small class="texto-suave">inclui os cancelados</small></div></div>
          ${ranking({ dados: r.status.map((x) => ({ rotulo: STATUS_TEXTO[x.status] ?? x.status, valor: x.n })), formato: (n) => n, vazio: "Nenhum pedido no período." })}
        </section>
      </div>

      <div class="painel-grade painel-grade--2">
        <section class="cartao">
          <div class="cartao__cab"><div><h2>Dias da semana</h2><small class="texto-suave">qual dia vende mais</small></div></div>
          ${graficoBarras({
            titulo: "Faturamento por dia da semana",
            dados: r.semana.map((d) => ({ rotulo: SEMANA[d.dia], valor: d.total, dica: `${SEMANA_LONGA[d.dia]} · ${brl(d.total)} · ${plural(d.pedidos, "pedido")}` })),
            formato: brl, formatoEixo: brlInteiro, colunaValor: "Faturamento",
          })}
        </section>
        <section class="cartao">
          <div class="cartao__cab"><div><h2>${r.base === "entrega" ? "Horário das entregas" : "Horário dos pedidos"}</h2>
            <small class="texto-suave">${r.base === "entrega" ? "para quando os pedidos foram marcados" : "a que horas os clientes compram"}</small></div></div>
          ${graficoBarras({
            titulo: r.base === "entrega" ? "Pedidos por horário de entrega" : "Pedidos por horário",
            dados: horarios.map((h) => ({ rotulo: `${h.hora}h`, valor: h.pedidos, dica: `${h.hora}h às ${h.hora + 1}h · ${plural(h.pedidos, "pedido")} · ${brl(h.total)}` })),
            formato: (n) => plural(n, "pedido"), formatoEixo: (n) => String(Math.round(n)), colunaValor: "Pedidos",
          })}
        </section>
      </div>

      <div class="painel-grade painel-grade--2">
        <section class="cartao">
          <div class="cartao__cab"><h2>Melhores clientes</h2></div>
          ${r.clientes.length ? tabela([
            { titulo: "Cliente", valor: (c) => c.nome },
            { titulo: "Pedidos", valor: (c) => c.pedidos, direita: true },
            { titulo: "Total", valor: (c) => html`<strong>${brl(c.total)}</strong>`, direita: true },
          ], r.clientes, { rotulo: "Melhores clientes" }) : html`<p class="texto-suave">Nenhum cliente comprou no período.</p>`}
        </section>
        <section class="cartao">
          <div class="cartao__cab"><div><h2>Cupons usados</h2><small class="texto-suave">${brl(t.descontos)} de desconto no total</small></div></div>
          ${r.cupons.length ? tabela([
            { titulo: "Cupom", valor: (c) => html`<span class="codigo-cupom">${c.cupom}</span>` },
            { titulo: "Usos", valor: (c) => c.usos, direita: true },
            { titulo: "Desconto", valor: (c) => brl(c.desconto), direita: true },
            { titulo: "Vendido", valor: (c) => brl(c.total), direita: true, extra: true },
          ], r.cupons, { rotulo: "Cupons usados" }) : html`<p class="texto-suave">Nenhum cupom usado no período. <a class="link est__sem-impressao" href="#/cupons">Criar um cupom</a></p>`}
        </section>
      </div>

      <section class="cartao">
        <div class="cartao__cab"><div><h2>Pedidos do período</h2>
          <small class="texto-suave">${plural(r.lista.length, "pedido")}${r.lista.length > NA_TELA ? ` · mostrando os ${NA_TELA} mais recentes (a planilha leva todos)` : ""}${r.lista_cortada ? " · a planilha vai até 3.000 pedidos: escolha um período menor para ver o resto" : ""}</small></div></div>
        ${r.lista.length ? tabela([
          { titulo: "Pedido", valor: (p) => html`<strong>${p.codigo}</strong>` },
          { titulo: r.base === "entrega" ? "Entrega" : "Data", valor: (p) => dataBR(p.dia), extra: true },
          { titulo: "Cliente", valor: (p) => p.cliente },
          { titulo: "Situação", valor: (p) => html`<span class="status status--${p.status}">${STATUS_TEXTO[p.status] ?? p.status}</span>` },
          { titulo: "Pagamento", valor: (p) => FORMAS_PAGAMENTO[p.pagamento] ?? p.pagamento, extra: true },
          { titulo: "Total", valor: (p) => html`<strong>${brl(p.total)}</strong>`, direita: true },
        ], r.lista.slice(0, NA_TELA), { rotulo: "Pedidos do período", clicavel: (p) => p.id }) : html`<p class="texto-suave">Nenhum pedido no período.</p>`}
      </section>`);
  }

  async function carregar() {
    const p = atual === "outro" ? { de: livre.de, ate: livre.ate } : periodo(atual);
    try { r = await api.get(`/relatorios/vendas?de=${p.de}&ate=${p.ate}&base=${base}${p.agrupar ? `&agrupar=${p.agrupar}` : ""}`); }
    catch (erro) { if (ctx.ativo()) montar(ctx.raiz, erroPagina(erro.message)); return; }
    if (ctx.ativo()) desenhar();
  }

  function planilha() {
    const pagoDe = (p) => Math.min(p.pago, p.total);
    baixarCsv(`vendas-${r.de}-a-${r.ate}.csv`, [
      { titulo: "Pedido", valor: (p) => p.codigo },
      { titulo: "Feito em", valor: (p) => dataHora(p.criado_em) },
      { titulo: "Entrega/retirada", valor: (p) => `${dataBR(p.data_agendada)} ${p.hora_agendada ?? ""}`.trim() },
      { titulo: "Cliente", valor: (p) => p.cliente },
      { titulo: "Situação", valor: (p) => STATUS_TEXTO[p.status] ?? p.status },
      { titulo: "Tipo", valor: (p) => TIPOS[p.tipo] ?? p.tipo },
      { titulo: "Pagamento", valor: (p) => FORMAS_PAGAMENTO[p.pagamento] ?? p.pagamento },
      { titulo: "Cupom", valor: (p) => p.cupom ?? "" },
      { titulo: "Produtos (R$)", valor: (p) => emReaisPlanilha(p.produtos) },
      { titulo: "Entrega (R$)", valor: (p) => emReaisPlanilha(p.frete) },
      { titulo: "Desconto (R$)", valor: (p) => emReaisPlanilha(p.desconto) },
      { titulo: "Total (R$)", valor: (p) => emReaisPlanilha(p.total) },
      { titulo: "Pago (R$)", valor: (p) => emReaisPlanilha(pagoDe(p)) },
    ], r.lista);
  }

  delegar(ctx.raiz, {
    periodo: (el) => {
      atual = el.dataset.periodo;
      if (atual === "outro") {
        ctx.raiz.querySelectorAll('[data-acao="periodo"]').forEach((b) => { const ativo = b === el; b.classList.toggle("segmento--ativo", ativo); b.setAttribute("aria-pressed", String(ativo)); });
        const form = ctx.raiz.querySelector("[data-livre]");
        form.hidden = false;
        form.de.focus();
        return;
      }
      armazenamento.gravar("zqp.relatorio-periodo", atual);
      carregar();
    },
    base: (el) => { base = el.dataset.base; armazenamento.gravar("zqp.relatorio-base", base); carregar(); },
    "todos-produtos": () => { todosProdutos = !todosProdutos; desenhar(); },
    planilha: () => planilha(),
    imprimir: () => {
      document.body.classList.add("imprimindo-pagina");
      window.addEventListener("afterprint", () => document.body.classList.remove("imprimindo-pagina"), { once: true });
      window.print();
    },
    abrir: (el) => abrirPedido(el.dataset.id, carregar),
  });
  ctx.raiz.addEventListener("submit", (ev) => {
    const form = ev.target.closest("[data-livre]");
    if (!form) return;
    ev.preventDefault();
    if (!form.de.value || !form.ate.value) return;
    livre = { de: form.de.value, ate: form.ate.value };
    carregar();
  });
  ctx.raiz.addEventListener("keydown", (ev) => {
    const linha = ev.target.closest?.('tr[data-acao="abrir"]');
    if (linha && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); abrirPedido(linha.dataset.id, carregar); }
  });
  ativarGraficos(ctx.raiz);
  await carregar();
}
