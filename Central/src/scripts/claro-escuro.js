/* CLARO / ESCURO — o botão sol/lua e a escolha guardada no aparelho (o tema inicial vem de tema-central.js) */
import { bruto, html } from "/src/scripts/base/html.js";

const CHAVE_TEMA = "forminha:central-tema";
const SVG = {
  claro: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  escuro: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>',
};
const temaAtual = () => (document.documentElement.dataset.tema === "escuro" ? "escuro" : "claro");

/** Botão sol/lua: mostra o ícone do tema para onde vai trocar. */
export const botaoTema = (classe = "") => {
  const vai = temaAtual() === "escuro" ? "claro" : "escuro";
  return html`<button type="button" class="tema-botao ${classe}" data-acao="tema" aria-label="Usar tema ${vai}" title="Tema ${vai}">${bruto(SVG[temaAtual()])}</button>`;
};

function trocarTema(tema) {
  document.documentElement.dataset.tema = tema;
  const vai = tema === "escuro" ? "claro" : "escuro";
  for (const b of document.querySelectorAll('[data-acao="tema"]')) {
    b.innerHTML = SVG[tema];
    b.setAttribute("aria-label", `Usar tema ${vai}`);
    b.title = `Tema ${vai}`;
  }
}

document.addEventListener("click", (ev) => {
  if (!ev.target.closest('[data-acao="tema"]')) return;
  const novo = temaAtual() === "escuro" ? "claro" : "escuro";
  try { localStorage.setItem(CHAVE_TEMA, novo); } catch { /* modo privado */ }
  trocarTema(novo);
});
// sem escolha guardada, acompanha o computador/celular quando ele muda de tema
window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", (ev) => {
  let escolhido = null;
  try { escolhido = localStorage.getItem(CHAVE_TEMA); } catch { /* modo privado */ }
  if (!escolhido) trocarTema(ev.matches ? "escuro" : "claro");
});
