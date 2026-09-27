/* COMPONENTE — botão flutuante do WhatsApp (só aparece se a loja cadastrou o número) */
import { html, montar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { linkWhats } from "./rodape.js";

export function iniciarWhatsFlutuante() {
  const link = linkWhats();
  if (!link || document.getElementById("whats-flutuante")) return;
  const el = document.createElement("div");
  el.id = "whats-flutuante";
  document.body.append(el);
  montar(el, html`<a class="whats-flutuante" href="${link}" target="_blank" rel="noopener" aria-label="Falar pelo WhatsApp">${icone("whatsapp", { tamanho: 22 })}<span>Fale com a gente</span></a>`);
}
