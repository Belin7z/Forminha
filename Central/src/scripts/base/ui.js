/* UI — avisos (toast), janelas (modal), confirmação e botão "ocupado" */
import { html, criarElemento } from "./html.js";
import { icone } from "./icones.js";

/* ==================== Toast ==================== */
let areaToasts;

/** Aviso rápido. tipo: "sucesso" | "erro" | "info" */
export function toast(mensagem, tipo = "sucesso", duracao = 3600) {
  if (!areaToasts) {
    areaToasts = document.createElement("div");
    areaToasts.className = "toasts";
    areaToasts.setAttribute("role", "status");
    areaToasts.setAttribute("aria-live", "polite");
    document.body.append(areaToasts);
  }
  const icones = { sucesso: "checkCirculo", erro: "alerta", info: "info" };
  const el = criarElemento(html`<div class="toast toast--${tipo}">${icone(icones[tipo] ?? "info", { tamanho: 18 })}<span>${mensagem}</span></div>`);
  areaToasts.append(el);
  const remover = () => { el.classList.add("toast--saindo"); setTimeout(() => el.remove(), 250); };
  setTimeout(remover, duracao);
  el.addEventListener("click", remover);
}

/* ==================== Modal ==================== */
const FOCAVEIS = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const abertos = [];

function travarRolagem(travar) {
  document.body.style.overflow = travar ? "hidden" : "";
}

/**
 * Abre uma janela. `corpo` e `rodape` aceitam HTML (resultado de `html`).
 * Devolve { el, corpo, fechar }.
 */
export function abrirModal({ titulo, corpo = "", rodape = "", largura = 520, aoFechar, classe = "" }) {
  const focoAnterior = document.activeElement;
  const el = criarElemento(html`
    <div class="modal">
      <div class="modal__fundo" data-fechar></div>
      <div class="modal__caixa ${classe}" role="dialog" aria-modal="true" aria-label="${titulo}" style="max-width:${largura}px">
        <header class="modal__cab">
          <h2>${titulo}</h2>
          <button type="button" class="btn-icone" data-fechar aria-label="Fechar">${icone("x")}</button>
        </header>
        <div class="modal__corpo">${corpo}</div>
        ${rodape && html`<footer class="modal__rodape">${rodape}</footer>`}
      </div>
    </div>`);
  document.body.append(el);
  travarRolagem(true);

  const controle = { el, corpo: el.querySelector(".modal__corpo"), rodape: el.querySelector(".modal__rodape"), fechado: false };

  function fechar(resultado) {
    if (controle.fechado) return;
    controle.fechado = true;
    abertos.splice(abertos.indexOf(controle), 1);
    el.classList.add("modal--saindo");
    setTimeout(() => el.remove(), 180);
    if (!abertos.length) travarRolagem(false);
    focoAnterior?.focus?.();
    aoFechar?.(resultado);
  }
  controle.fechar = fechar;

  el.addEventListener("click", (ev) => { if (ev.target.closest("[data-fechar]")) fechar(); });
  el.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") { ev.stopPropagation(); fechar(); return; }
    if (ev.key !== "Tab") return;
    const itens = [...el.querySelectorAll(FOCAVEIS)].filter((x) => x.offsetParent !== null);
    if (!itens.length) return;
    const primeiro = itens[0], ultimo = itens[itens.length - 1];
    if (ev.shiftKey && document.activeElement === primeiro) { ev.preventDefault(); ultimo.focus(); }
    else if (!ev.shiftKey && document.activeElement === ultimo) { ev.preventDefault(); primeiro.focus(); }
  });

  abertos.push(controle);
  requestAnimationFrame(() => (el.querySelector("[autofocus]") ?? el.querySelector(".modal__corpo " + FOCAVEIS) ?? el.querySelector(".modal__caixa"))?.focus?.());
  return controle;
}

/** Fecha todas as janelas abertas (ex.: a sessão acabou e volta a tela de entrar). */
export function fecharJanelas() {
  for (const c of [...abertos]) c.fechar();
}

/** Pergunta "tem certeza?". Devolve uma Promise<boolean>. */
export function confirmar({ titulo = "Confirmar", mensagem = "", rotulo = "Confirmar", perigo = false }) {
  return new Promise((resolver) => {
    let decidido = false;
    const decidir = (valor) => { decidido = true; resolver(valor); m.fechar(); };
    const m = abrirModal({
      titulo, largura: 440,
      corpo: html`<p class="texto-suave">${mensagem}</p>`,
      rodape: html`
        <button type="button" class="btn btn--suave" data-nao>Cancelar</button>
        <button type="button" class="btn ${perigo ? "btn--perigo" : "btn--primario"}" data-sim autofocus>${rotulo}</button>`,
      aoFechar: () => { if (!decidido) resolver(false); },
    });
    m.rodape.querySelector("[data-nao]").addEventListener("click", () => decidir(false));
    m.rodape.querySelector("[data-sim]").addEventListener("click", () => decidir(true));
  });
}

/** Desativa o botão e mostra um spinner enquanto `tarefa` roda. */
export async function ocupado(botao, tarefa) {
  if (!botao) return tarefa();
  botao.disabled = true;
  botao.classList.add("carregando");
  try {
    return await tarefa();
  } finally {
    botao.disabled = false;
    botao.classList.remove("carregando");
  }
}

/** Copia texto para a área de transferência. */
export async function copiar(texto) {
  try {
    await navigator.clipboard.writeText(texto);
  } catch {
    const t = document.createElement("textarea");
    t.value = texto;
    document.body.append(t);
    t.select();
    document.execCommand("copy");
    t.remove();
  }
  toast("Copiado!", "sucesso", 1800);
}
