/* ==========================================================
   NOTIFICAÇÕES — consulta a API de tempos em tempos para avisar
   quando chega pedido novo (aviso na tela + som) e mantém os
   contadores do menu atualizados.
   ========================================================== */
import { armazenamento } from "/src/scripts/base/armazenamento.js";
import { brl } from "/src/scripts/base/formatacao.js";
import { toast } from "/src/scripts/base/ui.js";
import { api } from "./api.js";
import { emitir, estado } from "./estado.js";
import { iniciarAlertaEstoque, pararAlertaEstoque } from "./estoque-alerta.js";

const INTERVALO_MS = 12_000;
let ultimoId = null;
let temporizador = null;
let audio = null;

export const somAtivo = () => armazenamento.ler("zqp.som", true);
export function alternarSom() {
  armazenamento.gravar("zqp.som", !somAtivo());
  if (somAtivo()) tocarAviso();
  return somAtivo();
}

/** Dois toques curtos (gerados no navegador, sem arquivo de áudio). */
export function tocarAviso() {
  if (!somAtivo()) return;
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === "suspended") audio.resume();
    [[880, 0], [1175, 0.16]].forEach(([freq, atraso]) => {
      const osc = audio.createOscillator();
      const ganho = audio.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      ganho.gain.setValueAtTime(0.0001, audio.currentTime + atraso);
      ganho.gain.exponentialRampToValueAtTime(0.25, audio.currentTime + atraso + 0.02);
      ganho.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + atraso + 0.28);
      osc.connect(ganho).connect(audio.destination);
      osc.start(audio.currentTime + atraso);
      osc.stop(audio.currentTime + atraso + 0.3);
    });
  } catch { /* sem áudio disponível */ }
}

/** Atualiza os selos do menu (ex.: quantidade de pedidos novos). */
export async function atualizarContagem() {
  try {
    const nova = await api.get("/pedidos/contagem");
    const mudou = JSON.stringify(nova) !== JSON.stringify(estado.contagem);
    // pedido de orçamento novo: avisa como um pedido (só depois da primeira leitura)
    if (estado.contagem.orcamentos != null && (nova.orcamentos ?? 0) > estado.contagem.orcamentos) {
      tocarAviso();
      toast("Chegou um pedido de orçamento! Veja em Orçamentos.", "info", 7000);
    }
    estado.contagem = nova;
    // só redesenha o menu se algo mudou (evita perder foco e rolagem a cada consulta)
    if (mudou) emitir("contagem");
  } catch { /* tenta no próximo ciclo */ }
}

async function consultar() {
  try {
    const r = await api.get(`/pedidos/novos?desde=${ultimoId ?? 999999999}`);
    if (ultimoId === null) { ultimoId = r.ultimo_id; return; } // primeira leitura: só marca o ponto de partida
    if (r.novos.length) {
      ultimoId = r.ultimo_id;
      tocarAviso();
      for (const p of r.novos.slice(0, 3)) toast(`Novo pedido ${p.codigo} — ${p.cliente} · ${brl(p.total)}`, "info", 7000);
      emitir("pedidos-novos", r.novos);
    }
    await atualizarContagem();
  } catch { /* offline: tenta de novo */ }
}

export function iniciarNotificacoes() {
  pararNotificacoes();
  ultimoId = null;
  consultar();
  atualizarContagem();
  temporizador = setInterval(consultar, INTERVALO_MS);
  // navegadores só liberam áudio depois de um clique do usuário
  document.addEventListener("click", () => { audio ??= new (window.AudioContext || window.webkitAudioContext)(); }, { once: true });
  if (estado.usuario?.papel === "admin") iniciarAlertaEstoque(); // o estoque é só da administradora
}

export function pararNotificacoes() {
  clearInterval(temporizador);
  temporizador = null;
  pararAlertaEstoque();
}
