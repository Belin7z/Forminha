/* TELA — Pagamentos: todas as cobranças, com o total recebido e o pendente (quem vê dinheiro) */
import { html, montar } from "/src/scripts/base/html.js";
import { api, aviso, quandoCurto, reais } from "../nucleo.js";
import { abrirFicha } from "./clientes.js";

const FILTROS = [["", "Todos"], ["pendente", "Pendentes"], ["aprovado", "Pagos"], ["cancelado", "Cancelados"]];
const SITUACAO = { pendente: ["Pendente", "aviso"], aprovado: ["Pago", "sucesso"], cancelado: ["Cancelado", "neutro"] };

export async function telaPagamentos(conteiner, eu) {
  document.title = "Pagamentos — Forminha";
  let filtro = "";
  montar(conteiner, html`
    <div class="central__titulo"><div><h1>Pagamentos</h1></div></div>
    <section class="numeros numeros--2" data-totais></section>
    <div class="segmentos" role="group" aria-label="Filtrar">${FILTROS.map(([id, texto]) => html`
      <button type="button" class="segmento ${!id && "segmento--ativo"}" data-filtro="${id}" aria-pressed="${String(!id)}">${texto}</button>`)}</div>
    <section data-lista><div class="carregando-pagina"><div class="spinner"></div></div></section>`);

  const $ = (s) => conteiner.querySelector(s);

  async function carregar() {
    let r;
    try { r = await api("GET", `pagamentos${filtro ? `?situacao=${filtro}` : ""}`); }
    catch (erro) { montar($("[data-lista]"), aviso("aviso", erro.message)); return; }
    montar($("[data-totais]"), html`
      <div class="numero"><p class="numero__rotulo">Recebido</p><p class="numero__valor">${reais(r.totais.recebido)}</p></div>
      <div class="numero"><p class="numero__rotulo">Pendente</p><p class="numero__valor">${reais(r.totais.pendente)}</p></div>`);
    montar($("[data-lista]"), r.pagamentos.length ? html`
      <div class="tabela tabela--pagamentos" role="table" aria-label="Pagamentos">
        <div class="tabela__linha tabela__cab" role="row"><span>Data</span><span>Loja</span><span>Cliente</span><span>Valor</span><span>Situação</span><span>Confirmado por</span></div>
        ${r.pagamentos.map((p) => { const [t, tom] = SITUACAO[p.situacao]; return html`
          <button type="button" class="tabela__linha tabela__linha--clicavel" role="row" data-cliente="${p.cliente_id}">
            <span class="tabela__suave">${quandoCurto(p.confirmado_em ?? p.criado_em)}</span>
            <span class="tabela__principal"><strong>${p.nome_loja}</strong><small class="so-celular">${p.cliente} · ${t}</small></span>
            <span>${p.cliente}</span>
            <span class="tabela__numero">${reais(p.valor_centavos)}</span>
            <span><span class="ponto ponto--${tom}">${t}</span></span>
            <span class="tabela__suave">${p.confirmado_por ?? "—"}</span>
          </button>`; })}
      </div>` : html`<p class="texto-suave">Nenhum pagamento aqui.</p>`);
  }

  conteiner.addEventListener("click", (ev) => {
    const botao = ev.target.closest("[data-filtro]");
    if (botao) {
      filtro = botao.dataset.filtro;
      conteiner.querySelectorAll("[data-filtro]").forEach((b) => { const ativo = b === botao; b.classList.toggle("segmento--ativo", ativo); b.setAttribute("aria-pressed", String(ativo)); });
      return carregar();
    }
    const linha = ev.target.closest("[data-cliente]");
    if (linha) abrirFicha(linha.dataset.cliente, carregar, eu);
  });
  await carregar();
}
