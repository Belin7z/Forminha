/* ==========================================================
   TELA — Funil de vendas: das clientes que entraram no período,
   quantas receberam a cobrança, pagaram e estão com a loja no ar;
   a conversão de cada passo, quanto tempo levam para pagar e o
   resultado de cada pessoa da equipe (valores só para quem vê
   dinheiro).
   ========================================================== */
import { html, montar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { api, aviso, pode, reais } from "../nucleo.js";
import { dataBR, periodo } from "../periodo.js";

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const PERIODOS = [["mes", "Este mês"], ["mes-passado", "Mês passado"], ["30d", "30 dias"], ["90d", "3 meses"], ["12m", "12 meses"], ["outro", "Personalizado"]];

function datas(id) {
  const h = new Date();
  if (id === "mes-passado") return { de: iso(new Date(h.getFullYear(), h.getMonth() - 1, 1)), ate: iso(new Date(h.getFullYear(), h.getMonth(), 0)) };
  if (id === "90d") return { de: iso(new Date(h.getFullYear(), h.getMonth(), h.getDate() - 89)), ate: iso(h) };
  const p = periodo(id);
  return { de: p.de, ate: p.ate };
}

/** 5 h · 1 dia e 3 h · 12 dias */
export function duracao(horas) {
  if (horas === null || horas === undefined) return "—";
  if (horas < 1) return `${Math.max(1, Math.round(horas * 60))} min`;
  if (horas < 24) return `${Math.round(horas)} h`;
  const dias = Math.floor(horas / 24), resto = Math.round(horas % 24);
  if (dias >= 7 || !resto) return `${dias} ${dias === 1 ? "dia" : "dias"}`;
  return `${dias} ${dias === 1 ? "dia" : "dias"} e ${resto} h`;
}

const numero = (rotulo, valor, nota = "") => html`
  <div class="numero"><p class="numero__rotulo">${rotulo}</p><p class="numero__valor">${valor}</p>${nota && html`<p class="numero__nota">${nota}</p>`}</div>`;

export async function telaFunil(conteiner, eu) {
  document.title = "Funil — Forminha";
  let atual = "mes";
  let livre = datas("30d");
  const dinheiro = pode(eu, "financeiro.ver");

  montar(conteiner, html`
    <div class="central__titulo"><div><h1>Funil de vendas</h1><p class="texto-suave" data-intervalo></p></div></div>
    <div class="barra-periodo">
      <div class="segmentos" role="group" aria-label="Período">${PERIODOS.map(([id, texto]) => html`
        <button type="button" class="segmento ${id === atual && "segmento--ativo"}" data-periodo="${id}" aria-pressed="${String(id === atual)}">${texto}</button>`)}</div>
      <form class="periodo-livre" data-livre hidden novalidate>
        <label>De <input type="date" class="entrada entrada--compacta" name="de" value="${livre.de}" required></label>
        <label>Até <input type="date" class="entrada entrada--compacta" name="ate" value="${livre.ate}" required></label>
        <button type="submit" class="btn btn--primario btn--pequeno">Ver</button>
      </form>
    </div>
    <div data-funil><div class="carregando-pagina"><div class="spinner"></div></div></div>`);

  const alvo = conteiner.querySelector("[data-funil]");
  const formLivre = conteiner.querySelector("[data-livre]");

  async function carregar() {
    const p = atual === "outro" ? livre : datas(atual);
    conteiner.querySelector("[data-intervalo]").textContent = `Clientes que entraram de ${dataBR(p.de)} a ${dataBR(p.ate)}`;
    let r;
    try { r = await api("GET", `funil?de=${p.de}&ate=${p.ate}`); }
    catch (erro) { montar(alvo, aviso("aviso", erro.message)); return; }
    const inicio = r.etapas[0].n;
    montar(alvo, html`
      <section class="cartao">
        <div class="cartao__cab"><h2>Do interesse à loja no ar</h2>${dinheiro && r.valor !== undefined && html`<span class="cartao__total"><strong>${reais(r.valor)}</strong> <span class="texto-suave">vendidos</span></span>`}</div>
        ${inicio ? html`<ol class="funil" aria-label="Funil de vendas">${r.etapas.map((e, i) => html`
          <li class="funil__etapa">
            <div class="funil__barra" style="--largura:${Math.max(e.pct_do_inicio, e.n ? 6 : 0)}%"><span>${e.n}</span></div>
            <div class="funil__texto"><strong>${e.nome}</strong>
              <small>${i === 0 ? "cadastros no período" : html`${e.pct_da_anterior}% da etapa anterior · ${e.pct_do_inicio}% do total`}</small></div>
          </li>`)}</ol>`
        : html`<div class="vazio vazio--baixo"><span class="vazio__ico">${icone("funil", { tamanho: 32 })}</span><h3>Ninguém entrou neste período</h3>
            <p>Dica: registre também quem só pediu informação (Nova cliente → “Só registrar o interesse”). Assim o funil mostra a conversão de verdade.</p></div>`}
      </section>

      <section class="numeros">
        ${numero("Em negociação", r.em_aberto.interessadas + r.em_aberto.aguardando, `${r.em_aberto.interessadas} só interesse · ${r.em_aberto.aguardando} com cobrança`)}
        ${numero("Canceladas", r.canceladas, inicio ? `${Math.round((r.canceladas / inicio) * 100)}% das que entraram` : "")}
        ${numero("Tempo até pagar", duracao(r.horas_ate_pagar), "do cadastro ao pagamento (média)")}
        ${numero("Pagamento → loja no ar", duracao(r.horas_ate_loja), "criação automática (média)")}
      </section>

      <section class="cartao">
        <div class="cartao__cab"><h2>Quem trouxe e quem converteu</h2></div>
        ${r.por_pessoa.length ? html`
          <div class="tabela tabela--funil ${dinheiro && "tabela--funil-valor"}" role="table" aria-label="Resultado por pessoa">
            <div class="tabela__linha tabela__cab" role="row"><span>Quem cadastrou</span><span>Entraram</span><span>Pagaram</span><span>Conversão</span>${dinheiro && html`<span>Vendido</span>`}</div>
            ${r.por_pessoa.map((p) => html`
              <div class="tabela__linha" role="row">
                <span class="tabela__mono">${p.quem}</span>
                <span class="tabela__numero">${p.entraram}</span>
                <span class="tabela__numero">${p.pagaram}</span>
                <span><span class="funil__mini" aria-hidden="true"><i style="width:${p.conversao}%"></i></span> ${p.conversao}%</span>
                ${dinheiro && html`<span class="tabela__numero">${reais(p.valor ?? 0)}</span>`}
              </div>`)}
          </div>` : html`<p class="texto-suave">Sem cadastros no período.</p>`}
      </section>`);
  }

  conteiner.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-periodo]");
    if (!b) return;
    atual = b.dataset.periodo;
    conteiner.querySelectorAll("[data-periodo]").forEach((x) => { const ativo = x === b; x.classList.toggle("segmento--ativo", ativo); x.setAttribute("aria-pressed", String(ativo)); });
    formLivre.hidden = atual !== "outro";
    if (atual === "outro") return formLivre.de.focus();
    carregar();
  });
  formLivre.addEventListener("submit", (ev) => {
    ev.preventDefault();
    if (!formLivre.de.value || !formLivre.ate.value) return;
    livre = { de: formLivre.de.value, ate: formLivre.ate.value };
    carregar();
  });
  await carregar();
}
