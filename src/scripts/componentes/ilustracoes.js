/* COMPONENTE — ilustrações de linha fina (sem emojis) usadas quando não há foto */
import { bruto } from "/src/scripts/base/html.js";

/** Escalope de glacê: `n` arcos de largura igual, da direita para a esquerda, a partir de (x+largura, y). */
function glace(x, y, largura, altura, n) {
  const d = largura / n;
  const r = (d / 2).toFixed(2);
  let caminho = `M${x} ${y}h${largura}v${altura}`;
  for (let i = 0; i < n; i++) caminho += `a${r} ${r} 0 0 1 -${d.toFixed(2)} 0`;
  return `${caminho}z`;
}

const pearls = (x0, x1, y, passo) => {
  let s = "";
  for (let x = x0; x <= x1; x += passo) s += `<circle cx="${x}" cy="${y}" r="2.3" fill="#fff" style="stroke:var(--detalhe)" stroke-width="1"/>`;
  return s;
};

/** Bolo de três andares com glacê, pérolas, flores e velas. */
export function ilustracaoBolo() {
  return bruto(`<svg viewBox="0 0 260 304" fill="none" style="stroke:var(--escura)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <defs><g id="flor"><circle r="3.4" cx="0" cy="-5.2" fill="#fff"/><circle r="3.4" cx="4.9" cy="-1.6" fill="#fff"/><circle r="3.4" cx="3" cy="4.2" fill="#fff"/><circle r="3.4" cx="-3" cy="4.2" fill="#fff"/><circle r="3.4" cx="-4.9" cy="-1.6" fill="#fff"/><circle r="2.1" style="fill:var(--detalhe)" stroke="none"/></g></defs>
    <ellipse cx="130" cy="272" rx="112" ry="12" fill="#fff"/>
    <path d="M118 282h24v10h-24zM96 292h68" />
    <rect x="42" y="192" width="176" height="80" rx="10" style="fill:var(--marca-200)"/>
    <path d="${glace(42, 192, 176, 14, 8)}" fill="#fff"/>
    ${pearls(58, 202, 262, 18)}
    <rect x="68" y="130" width="124" height="62" rx="9" style="fill:var(--marca-100)"/>
    <path d="${glace(68, 130, 124, 12, 6)}" fill="#fff"/>
    <path d="M68 172h124" style="stroke:var(--detalhe)" stroke-width="1" stroke-dasharray="1 5"/>
    <rect x="92" y="78" width="76" height="52" rx="8" style="fill:var(--marca-200)"/>
    <path d="${glace(92, 78, 76, 11, 4)}" fill="#fff"/>
    <rect x="109" y="46" width="4.4" height="30" rx="1" fill="#fff"/><rect x="147" y="46" width="4.4" height="30" rx="1" fill="#fff"/>
    <path d="M111.2 36c3.2 3.4 3.2 6.6 0 8.6-3.2-2-3.2-5.2 0-8.6zM149.2 36c3.2 3.4 3.2 6.6 0 8.6-3.2-2-3.2-5.2 0-8.6z" style="fill:var(--detalhe-claro);stroke:var(--detalhe)" stroke-width="1.2"/>
    <use href="#flor" x="124" y="72" stroke-width="1.3"/><use href="#flor" x="138" y="72" stroke-width="1.3"/>
    <path d="M118 76c-6-1-9 1-10 4M144 76c6-1 9 1 10 4" style="stroke:var(--detalhe)" stroke-width="1.2"/>
    <use href="#flor" x="60" y="222" stroke-width="1.3"/><use href="#flor" x="76" y="232" stroke-width="1.3"/><use href="#flor" x="196" y="226" stroke-width="1.3"/>
    <path d="M52 232c8 2 14 6 18 12M204 236c-6 1-11 4-14 9" style="stroke:var(--detalhe)" stroke-width="1.2"/>
    <path d="M36 38c.5 3.6 1.2 4.3 4.8 4.8-3.6.5-4.3 1.2-4.8 4.8-.5-3.6-1.2-4.3-4.8-4.8 3.6-.5 4.3-1.2 4.8-4.8zM226 92c.5 3.6 1.2 4.3 4.8 4.8-3.6.5-4.3 1.2-4.8 4.8-.5-3.6-1.2-4.3-4.8-4.8 3.6-.5 4.3-1.2 4.8-4.8z" style="stroke:var(--detalhe)" stroke-width="1.2"/>
  </svg>`);
}
