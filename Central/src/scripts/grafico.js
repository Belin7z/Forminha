/* ==========================================================
   GRÁFICO DE VENDAS — barras de uma cor só, eixo com 3 linhas
   discretas, o valor escrito só na maior barra e o resto ao passar
   o mouse (ou tocar / Tab). Se adapta ao agrupamento: por hora,
   dia, mês ou ano. Os rótulos de baixo se espaçam sozinhos para
   nunca encavalar.
   ========================================================== */
import { html } from "/src/scripts/base/html.js";
import { reais } from "./nucleo.js";

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MESES_LONGOS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/** Rótulo curto (eixo) e longo (dica) de cada balde. */
export function rotulosDe(chave, agrupamento) {
  if (agrupamento === "hora") {
    const [dia, h] = chave.split(" ");
    const [, m, d] = dia.split("-");
    return { curto: `${Number(h)}h`, longo: `${d}/${m} · ${Number(h)}h às ${Number(h) + 1}h` };
  }
  if (agrupamento === "dia") {
    const [a, m, d] = chave.split("-").map(Number);
    const semana = SEMANA[new Date(Date.UTC(a, m - 1, d)).getUTCDay()];
    return { curto: `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`, longo: `${semana}, ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${a}` };
  }
  if (agrupamento === "mes") {
    const [a, m] = chave.split("-").map(Number);
    return { curto: `${MESES[m - 1]}/${String(a).slice(2)}`, longo: `${MESES_LONGOS[m - 1]} de ${a}` };
  }
  return { curto: chave, longo: chave };
}

/** Valor do eixo, curto: R$ 950 · R$ 1,2 mil · R$ 3,4 mi. */
export function reaisCurto(centavos) {
  const r = centavos / 100;
  const n = (v, s) => `R$ ${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}${s}`;
  if (r >= 1e6) return n(r / 1e6, " mi");
  if (r >= 1e3) return n(r / 1e3, " mil");
  return n(r, "");
}

/** Um topo "redondo" para o eixo (ex.: 4.370 -> 5.000), para as linhas caírem em valores fáceis de ler. */
function topoRedondo(maior) {
  if (maior <= 0) return 10000; // R$ 100 (só para desenhar o eixo vazio)
  const ordem = 10 ** Math.floor(Math.log10(maior));
  for (const passo of [1, 2, 2.5, 5, 10]) if (passo * ordem >= maior) return passo * ordem;
  return 10 * ordem;
}

/** `maxRotulos`: quantos rótulos cabem embaixo (menos no celular). */
export function graficoDeVendas({ serie, agrupamento, titulo = "Vendas", maxRotulos = window.innerWidth < 560 ? 5 : 8 }) {
  const maior = Math.max(0, ...serie.map((s) => s.total));
  const topo = topoRedondo(maior);
  const indiceMaior = maior > 0 ? serie.findIndex((s) => s.total === maior) : -1;
  const passo = Math.max(1, Math.ceil(serie.length / maxRotulos));
  const ultimo = serie.length - 1;
  // o último rótulo só aparece se não encostar no anterior
  const mostrar = (i) => i % passo === 0 || (i === ultimo && ultimo % passo >= Math.ceil(passo * 0.75));
  const vazio = maior === 0;
  return html`
    <figure class="grafico" aria-label="${titulo}">
      <div class="grafico__eixo" aria-hidden="true">
        ${[1, 0.5, 0].map((f) => html`<span style="--pos:${f * 100}%">${reaisCurto(topo * f)}</span>`)}
      </div>
      <div class="grafico__area">
        ${[1, 0.5].map((f) => html`<i class="grafico__linha" style="--pos:${f * 100}%" aria-hidden="true"></i>`)}
        <div class="grafico__barras" style="--n:${serie.length}" role="list">
          ${serie.map((s, i) => {
            const r = rotulosDe(s.chave, agrupamento);
            const dica = `${r.longo}: ${reais(s.total)} · ${s.vendas} ${s.vendas === 1 ? "venda" : "vendas"}`;
            const mostrarRotulo = mostrar(i);
            return html`
              <div class="grafico__item ${i === indiceMaior && "grafico__item--maior"}" role="listitem" tabindex="0" aria-label="${dica}" data-dica="${dica}"
                style="--altura:${(s.total / topo) * 100}%">
                ${i === indiceMaior && html`<span class="grafico__valor">${reaisCurto(s.total)}</span>`}
                <span class="grafico__barra"></span>
                <span class="grafico__rotulo ${!mostrarRotulo && "grafico__rotulo--oculto"}">${r.curto}</span>
              </div>`;
          })}
        </div>
        ${vazio && html`<p class="grafico__vazio">Nenhuma venda neste período.</p>`}
      </div>
    </figure>`;
}
