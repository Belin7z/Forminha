/* ==========================================================
   NÚCLEO — desconecta quem deixou o painel parado.
   Se ninguém clicar, digitar ou rolar por 2 horas (computador
   compartilhado, aba esquecida aberta), a sessão é encerrada.
   O horário da última atividade fica no navegador, então vale
   para todas as abas abertas do painel.
   ========================================================== */
import { armazenamento } from "/src/scripts/base/armazenamento.js";

const CHAVE = "zqp.atividade";
const LIMITE_MS = 2 * 60 * 60 * 1000;
const EVENTOS = ["click", "keydown", "pointerdown", "touchstart", "scroll"];

const ultimaAtividade = () => armazenamento.ler(CHAVE, Date.now());

/** Zera o relógio (chamado ao entrar: o painel recarrega e não pode achar que a pessoa já estava parada). */
export const marcarAtividade = () => armazenamento.gravar(CHAVE, Date.now());

/** Já passou do limite desde a última atividade registrada? */
export const jaExpirou = () => Date.now() - ultimaAtividade() > LIMITE_MS;

/** Começa a vigiar. `aoExpirar` roda uma vez quando o tempo acaba. Devolve a função que para de vigiar. */
export function iniciarInatividade(aoExpirar) {
  let ultimoRegistro = 0;
  let encerrado = false;
  const registrar = () => {
    const agora = Date.now();
    if (agora - ultimoRegistro < 15000) return; // não grava a cada movimento
    ultimoRegistro = agora;
    armazenamento.gravar(CHAVE, agora);
  };
  const verificar = () => {
    if (encerrado || !jaExpirou()) return;
    encerrado = true;
    aoExpirar();
  };

  EVENTOS.forEach((e) => window.addEventListener(e, registrar, { passive: true, capture: true }));
  const aoVoltar = () => { if (!document.hidden) verificar(); };
  document.addEventListener("visibilitychange", aoVoltar);
  const temporizador = setInterval(verificar, 60000);
  marcarAtividade();

  return () => {
    clearInterval(temporizador);
    EVENTOS.forEach((e) => window.removeEventListener(e, registrar, { capture: true }));
    document.removeEventListener("visibilitychange", aoVoltar);
  };
}
