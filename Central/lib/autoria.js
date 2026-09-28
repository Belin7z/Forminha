/* ==========================================================
   AUTORIA — quem está fazendo a ação desta requisição (dono ou
   funcionário), para o histórico da cliente dizer "por FMV-0427".
   Guardado por requisição (AsyncLocalStorage): duas pessoas usando
   a Central ao mesmo tempo nunca se misturam.
   ========================================================== */
import { AsyncLocalStorage } from "node:async_hooks";

const armazem = new AsyncLocalStorage();

/** Roda `fn` com o autor definido (ex.: "FMV-0427 · Ana" ou "Dono"). */
export const comAutor = (autor, fn) => armazem.run({ autor }, fn);

/** O autor da requisição atual, ou null (tarefas automáticas: agendador, Mercado Pago). */
export const autorAtual = () => armazem.getStore()?.autor ?? null;
