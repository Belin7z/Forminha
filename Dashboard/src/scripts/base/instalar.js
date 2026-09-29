/* ==========================================================
   BASE — "Instalar o app" (igual na loja e no painel).
   Android e computador (Chrome/Edge): o navegador avisa que dá
   para instalar e o botão abre a instalação de verdade.
   iPhone: não existe esse aviso, então o botão mostra o passo a
   passo do Safari. Já instalado (aberto como app): nada aparece.
   ========================================================== */
import { html } from "/src/scripts/base/html.js";
import { abrirModal, toast } from "/src/scripts/base/ui.js";

let convite = null; // o aviso do navegador, guardado para quando a pessoa tocar no botão
const ouvintes = new Set();
const avisar = () => ouvintes.forEach((fn) => { try { fn(); } catch { /* quem ouve cuida de si */ } });

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (ev) => { ev.preventDefault(); convite = ev; avisar(); });
  window.addEventListener("appinstalled", () => { convite = null; avisar(); toast("Pronto! O app está na tela inicial."); });
}

export const jaInstalado = () => window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
export const ehIPhone = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/** Vale mostrar o botão? */
export const podeInstalar = () => !jaInstalado() && (Boolean(convite) || ehIPhone());

/** Avisa quando muda (o navegador liberou a instalação, ou o app foi instalado). Devolve a função para parar de ouvir. */
export function aoMudarInstalacao(fn) { ouvintes.add(fn); return () => ouvintes.delete(fn); }

/** Registra o serviço que deixa o app instalável e abrindo mesmo com internet ruim (só em https ou no computador). */
export function registrarServico() {
  if (!("serviceWorker" in navigator)) return;
  if (location.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(location.hostname)) return;
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

/** Abre a instalação (ou o passo a passo do iPhone). `nome`: como o app vai aparecer ("a loja", "o painel"). */
export async function instalar(nome = "o app") {
  if (convite) {
    const aviso = convite;
    convite = null;
    await aviso.prompt();
    const escolha = await aviso.userChoice.catch(() => null);
    avisar();
    return escolha?.outcome === "accepted";
  }
  abrirModal({
    titulo: "Instalar no iPhone", largura: 440,
    corpo: html`
      <ol class="instalar-passos">
        <li>Abra este endereço no <strong>Safari</strong>.</li>
        <li>Toque em <strong>Compartilhar</strong> (o quadrado com a seta para cima, na barra de baixo).</li>
        <li>Escolha <strong>Adicionar à Tela de Início</strong> e toque em <strong>Adicionar</strong>.</li>
      </ol>
      <p class="texto-suave">Pronto: ${nome} aparece na tela do celular, com ícone, como um aplicativo.</p>`,
  });
  return false;
}
