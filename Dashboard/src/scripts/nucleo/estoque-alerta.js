/* ==========================================================
   NÚCLEO — alerta de estoque. De tempos em tempos (com o
   Dashboard aberto) confere o que vai faltar: atualiza o selo
   do menu e pede à função whatsapp-avisar que mande o resumo
   para a dona, se ela ligou o aviso. Quem decide se há algo
   novo a avisar é o banco.
   ========================================================== */
import { api } from "./api.js";
import { emitir, estado } from "./estado.js";

const INTERVALO_MS = 10 * 60_000;
let temporizador = null;

async function conferir() {
  try {
    const r = await api.get("/estoque/previsao");
    const { faltando, baixo, vencidos, vencendo } = r.resumo;
    const risco = faltando + baixo + vencidos;
    if (risco !== estado.estoque.risco) { estado.estoque = { risco }; emitir("contagem"); }
    if (faltando + baixo + vencidos + vencendo > 0) await api.post("/avisos/enviar", { tipo: "estoque" }).catch(() => {}); // sem WhatsApp ligado, o banco responde "desligado"
  } catch { /* offline ou sem acesso: tenta no próximo ciclo */ }
}

export function iniciarAlertaEstoque() {
  pararAlertaEstoque();
  setTimeout(conferir, 4000);
  temporizador = setInterval(conferir, INTERVALO_MS);
}

export function pararAlertaEstoque() {
  clearInterval(temporizador);
  temporizador = null;
}
