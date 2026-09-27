/* ==========================================================
   GRÁFICOS — barras verticais (série no tempo) e ranking
   horizontal. Uma só cor (rosa), linhas de grade discretas,
   valor máximo rotulado, dica ao passar o mouse/teclar e
   alternativa em tabela para leitura sem depender da cor.
   ========================================================== */
import { html, delegar } from "/src/scripts/base/html.js";

/** Arredonda o teto do eixo para 1, 2, 2.5, 5 ou 10 × potência de 10. */
function tetoDoEixo(max) {
  if (max <= 0) return 1;
  const potencia = 10 ** Math.floor(Math.log10(max));
  for (const passo of [1, 2, 2.5, 5, 10]) if (passo * potencia >= max) return passo * potencia;
  return max;
}

/**
 * dados: [{ rotulo, valor, dica }]  · formato: (valor) => texto (eixo e tabela)
 * Devolve HTML; depois chame `ativarGraficos(raiz)` para ligar a dica e a tabela.
 */
export function graficoBarras({ titulo, dados, formato, formatoEixo = formato, colunaValor = "Valor" }) {
  const max = Math.max(...dados.map((d) => d.valor), 0);
  const teto = tetoDoEixo(max);
  const indiceMax = max > 0 ? dados.findIndex((d) => d.valor === max) : -1;
  const passoRotulo = Math.ceil(dados.length / 8);
  const resumo = `${titulo}: ${dados.map((d) => `${d.rotulo} ${formato(d.valor)}`).join("; ")}`;

  return html`
    <figure class="grafico" data-grafico>
      <figcaption>
        <strong>${titulo}</strong>
        <button type="button" class="link" data-acao="tabela" aria-pressed="false">Ver como tabela</button>
      </figcaption>
      <div class="grafico__visual" role="img" aria-label="${resumo}">
        <div class="grafico__eixo-y" aria-hidden="true"><span>${formatoEixo(teto)}</span><span>${formatoEixo(teto / 2)}</span><span>${formatoEixo(0)}</span></div>
        <div class="grafico__area">
          <div class="grafico__grade" aria-hidden="true"><i></i><i></i><i></i></div>
          <div class="grafico__barras">
            ${dados.map((d, i) => html`
              <div class="coluna">
                <button type="button" class="barra ${i === indiceMax && "barra--max"}" style="--altura:${(d.valor / teto) * 100}%" data-dica="${d.dica ?? `${d.rotulo}: ${formato(d.valor)}`}" aria-label="${d.dica ?? `${d.rotulo}: ${formato(d.valor)}`}">
                  ${i === indiceMax && html`<span class="barra__valor">${formato(d.valor)}</span>`}
                </button>
                <span class="coluna__rotulo" aria-hidden="true">${i % passoRotulo === 0 ? d.rotulo : ""}</span>
              </div>`)}
          </div>
        </div>
      </div>
      <div class="grafico__dica" role="tooltip" hidden></div>
      <table class="tabela tabela--compacta grafico__tabela" hidden>
        <thead><tr><th>Período</th><th class="texto-direita">${colunaValor}</th></tr></thead>
        <tbody>${dados.map((d) => html`<tr><td>${d.rotulo}</td><td class="texto-direita">${formato(d.valor)}</td></tr>`)}</tbody>
      </table>
    </figure>`;
}

/** Barras horizontais com o valor escrito ao lado (poucas linhas; não precisa de dica). */
export function ranking({ dados, formato, vazio = "Ainda não há dados." }) {
  if (!dados.length) return html`<p class="texto-suave">${vazio}</p>`;
  const max = Math.max(...dados.map((d) => d.valor), 1);
  return html`<ul class="ranking">${dados.map((d) => html`
    <li>
      <span class="ranking__rotulo" title="${d.rotulo}">${d.rotulo}</span>
      <span class="ranking__trilho" aria-hidden="true"><span class="ranking__barra" style="width:${Math.max(2, (d.valor / max) * 100)}%"></span></span>
      <strong class="ranking__valor">${formato(d.valor)}</strong>
    </li>`)}</ul>`;
}

/** Liga a dica (mouse/foco) e o botão "ver como tabela" dos gráficos dentro de `raiz`. */
export function ativarGraficos(raiz) {
  const mostrar = (barra) => {
    const figura = barra.closest("[data-grafico]");
    const dica = figura.querySelector(".grafico__dica");
    dica.textContent = barra.dataset.dica;
    dica.hidden = false;
    const f = figura.getBoundingClientRect();
    const b = barra.getBoundingClientRect();
    const largura = dica.offsetWidth;
    dica.style.left = `${Math.min(Math.max(b.left - f.left + b.width / 2 - largura / 2, 0), f.width - largura)}px`;
    dica.style.top = `${b.top - f.top - dica.offsetHeight - 8}px`;
  };
  const esconder = (barra) => { barra.closest("[data-grafico]").querySelector(".grafico__dica").hidden = true; };

  raiz.addEventListener("mouseover", (ev) => { const b = ev.target.closest(".barra"); if (b) mostrar(b); });
  raiz.addEventListener("mouseout", (ev) => { const b = ev.target.closest(".barra"); if (b) esconder(b); });
  raiz.addEventListener("focusin", (ev) => { const b = ev.target.closest(".barra"); if (b) mostrar(b); });
  raiz.addEventListener("focusout", (ev) => { const b = ev.target.closest(".barra"); if (b) esconder(b); });

  delegar(raiz, {
    tabela: (botao) => {
      const figura = botao.closest("[data-grafico]");
      const emTabela = botao.getAttribute("aria-pressed") !== "true";
      botao.setAttribute("aria-pressed", String(emTabela));
      botao.textContent = emTabela ? "Ver como gráfico" : "Ver como tabela";
      figura.querySelector(".grafico__visual").hidden = emTabela;
      figura.querySelector(".grafico__tabela").hidden = !emTabela;
    },
  });
}
