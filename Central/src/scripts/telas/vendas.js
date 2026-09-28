/* ==========================================================
   TELA — Vendas (quem vê dinheiro): o que foi vendido num período.
   Hoje · 7 dias · 30 dias · Este mês · 12 meses · Por ano ·
   Personalizado (de um dia até outro). Faturamento, quantidade e
   ticket médio comparados com o período anterior, o gráfico
   (por hora, dia, mês ou ano) e cada venda — dá para baixar a planilha.
   ========================================================== */
import { html, montar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { api, aviso, baixarPlanilha, quandoCurto, reais, valorPlanilha } from "../nucleo.js";
import { graficoDeVendas } from "../grafico.js";
import { PERIODOS, dataBR, periodo } from "../periodo.js";
import { abrirFicha } from "./clientes.js";

const TITULO = { hora: "Por hora", dia: "Por dia", mes: "Por mês", ano: "Por ano" };

/** "▲ 12% vs. período anterior" (sobe em verde, desce em vermelho). */
export function comparacao(atual, anterior, { dinheiro = false } = {}) {
  if (!anterior) return atual ? "Período anterior sem vendas" : "Sem vendas";
  const p = Math.round(((atual - anterior) / anterior) * 100);
  const valor = dinheiro ? reais(anterior) : anterior;
  return html`<span class="variacao variacao--${p >= 0 ? "sobe" : "desce"}">${icone(p >= 0 ? "cima" : "baixo", { tamanho: 12 })} ${Math.abs(p)}%</span>
    <span>vs. ${valor} antes</span>`;
}

const numero = (rotulo, valor, nota) => html`
  <div class="numero"><p class="numero__rotulo">${rotulo}</p><p class="numero__valor">${valor}</p>${nota && html`<p class="numero__nota">${nota}</p>`}</div>`;

export async function telaVendas(conteiner, eu) {
  document.title = "Vendas — Forminha";
  let atual = "mes";
  let livre = periodo("30d");
  let ultimo = null;

  montar(conteiner, html`
    <div class="central__titulo">
      <div><h1>Vendas</h1><p class="texto-suave" data-intervalo></p></div>
      <button type="button" class="btn btn--suave" data-acao="exportar" disabled>${icone("baixar", { tamanho: 16 })} Baixar planilha</button>
    </div>
    <div class="barra-periodo">
      <div class="segmentos" role="group" aria-label="Período">${PERIODOS.map(([id, texto]) => html`
        <button type="button" class="segmento ${id === atual && "segmento--ativo"}" data-periodo="${id}" aria-pressed="${String(id === atual)}">${texto}</button>`)}</div>
      <form class="periodo-livre" data-livre hidden novalidate>
        <label>De <input type="date" class="entrada entrada--compacta" name="de" required></label>
        <label>Até <input type="date" class="entrada entrada--compacta" name="ate" required></label>
        <button type="submit" class="btn btn--primario btn--pequeno">Ver</button>
      </form>
    </div>
    <section class="numeros numeros--3" data-numeros></section>
    <section class="cartao" data-grafico><div class="carregando-pagina"><div class="spinner"></div></div></section>
    <section class="vendas__lista" data-lista></section>`);

  const $ = (s) => conteiner.querySelector(s);
  const formLivre = $("[data-livre]");
  formLivre.de.value = livre.de;
  formLivre.ate.value = livre.ate;

  async function carregar() {
    const p = atual === "outro" ? { de: livre.de, ate: livre.ate } : periodo(atual);
    $("[data-intervalo]").textContent = p.de === p.ate ? dataBR(p.de) : `${dataBR(p.de)} a ${dataBR(p.ate)}`;
    let r;
    try { r = await api("GET", `vendas?de=${p.de}&ate=${p.ate}${p.agrupar ? `&agrupar=${p.agrupar}` : ""}`); }
    catch (erro) { montar($("[data-grafico]"), aviso("aviso", erro.message)); return; }
    ultimo = r;
    $('[data-acao="exportar"]').disabled = !r.itens.length;
    const a = r.resumo.anterior;
    montar($("[data-numeros]"), html`
      ${numero("Faturamento", reais(r.resumo.total), comparacao(r.resumo.total, a.total, { dinheiro: true }))}
      ${numero("Vendas", r.resumo.vendas, comparacao(r.resumo.vendas, a.vendas))}
      ${numero("Ticket médio", reais(r.resumo.ticket), r.resumo.vendas ? "por loja vendida" : "")}`);
    montar($("[data-grafico]"), html`
      <div class="cartao__cab"><h2>${TITULO[r.agrupamento]}</h2></div>
      ${graficoDeVendas({ serie: r.serie, agrupamento: r.agrupamento, titulo: `Faturamento ${TITULO[r.agrupamento].toLowerCase()}`, maxRotulos: window.innerWidth < 560 ? 5 : 12 })}`);
    montar($("[data-lista]"), r.itens.length ? html`
      <div class="tabela tabela--vendas" role="table" aria-label="Vendas do período">
        <div class="tabela__linha tabela__cab" role="row"><span>Data</span><span>Loja</span><span>Cliente</span><span>Valor</span><span>Confirmado por</span></div>
        ${r.itens.map((v) => html`
          <button type="button" class="tabela__linha tabela__linha--clicavel" role="row" data-cliente="${v.cliente_id}">
            <span class="tabela__suave">${quandoCurto(v.confirmado_em)}</span>
            <span class="tabela__principal"><strong>${v.nome_loja}</strong><small class="so-celular">${v.cliente} · ${quandoCurto(v.confirmado_em)}</small></span>
            <span>${v.cliente}</span>
            <span class="tabela__numero">${reais(v.valor_centavos)}</span>
            <span class="tabela__suave">${v.confirmado_por ?? "—"}</span>
          </button>`)}
      </div>` : "");
  }

  conteiner.addEventListener("click", (ev) => {
    const botao = ev.target.closest("[data-periodo]");
    if (botao) {
      atual = botao.dataset.periodo;
      conteiner.querySelectorAll("[data-periodo]").forEach((b) => { const ativo = b === botao; b.classList.toggle("segmento--ativo", ativo); b.setAttribute("aria-pressed", String(ativo)); });
      formLivre.hidden = atual !== "outro";
      if (atual === "outro") return formLivre.de.focus();
      return carregar();
    }
    if (ev.target.closest('[data-acao="exportar"]') && ultimo) {
      baixarPlanilha(`vendas-${ultimo.de}-a-${ultimo.ate}.csv`, [
        ["Data", "Loja", "Cliente", "Valor (R$)", "Confirmado por"],
        ...ultimo.itens.map((v) => [quandoCurto(v.confirmado_em), v.nome_loja, v.cliente, valorPlanilha(v.valor_centavos), v.confirmado_por ?? ""]),
      ]);
      return;
    }
    const linha = ev.target.closest("[data-cliente]");
    if (linha) abrirFicha(linha.dataset.cliente, carregar, eu);
  });
  formLivre.addEventListener("submit", (ev) => {
    ev.preventDefault();
    if (!formLivre.de.value || !formLivre.ate.value) return;
    livre = { de: formLivre.de.value, ate: formLivre.ate.value };
    carregar();
  });
  await carregar();
}
