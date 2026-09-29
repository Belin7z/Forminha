/* ==========================================================
   COMPONENTE — aviso da mensalidade da Forminha (só para o
   administrador), entre o topo e a página: vencendo, vencida ou
   loja suspensa (sem pedidos pelo site), com o botão "Pagar agora".
   Em dia: nada aparece.
   ========================================================== */
import { html, montar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { brl, dataBR } from "/src/scripts/base/formatacao.js";
import { api } from "../nucleo/api.js";
import { estado } from "../nucleo/estado.js";

export async function mostrarAvisoAssinatura() {
  const alvo = document.getElementById("aviso-assinatura");
  if (!alvo || estado.usuario?.papel !== "admin") return;
  let a;
  try { a = await api.get("/assinatura"); } catch { return; } // loja antiga (sem a função): sem aviso
  const vence = a.vencimento ? dataBR(a.vencimento) : "";
  const textos = {
    aberta: [html`Sua mensalidade da Forminha (<strong>${brl(a.valor_centavos)}</strong>) vence em <strong>${vence}</strong>.`, "info", "relogio"],
    atrasada: [html`A mensalidade da Forminha venceu em <strong>${vence}</strong>. Pague para a loja continuar recebendo pedidos pelo site.`, "aviso", "alerta"],
    suspensa: [html`<strong>A loja não está recebendo pedidos pelo site</strong> por causa da mensalidade atrasada. Pague e ela volta na hora.`, "perigo", "alerta"],
  };
  if (!textos[a.situacao]) { montar(alvo, ""); return; }
  const [texto, tom, ic] = textos[a.situacao];
  montar(alvo, html`
    <div class="aviso aviso--${tom} aviso-assinatura" role="status">
      ${icone(ic, { tamanho: 18 })}<span>${texto}</span>
      ${a.link && html`<a class="btn btn--primario btn--pequeno" href="${a.link}" target="_blank" rel="noopener">${icone("dinheiro", { tamanho: 15 })} Pagar agora</a>`}
    </div>`);
}
