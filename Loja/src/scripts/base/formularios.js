/* ==========================================================
   FORMULÁRIOS — geradores de campos, leitura de dados,
   exibição de erros por campo e máscaras.
   ========================================================== */
import { html, bruto, escapar } from "./html.js";
import { icone } from "./icones.js";
import { cep as mascaraCep, emReais, paraCentavos, telefone as mascaraTelefone } from "./formatacao.js";

/**
 * Gera um campo completo (rótulo + controle + ajuda).
 * tipo: text | email | password | tel | number | date | time | textarea | select
 * `atributos` é texto confiável escrito pelo programador (ex.: 'min="1" autocomplete="name"').
 */
export function campo({
  nome, rotulo, tipo = "text", valor = "", placeholder = "", obrigatorio = false,
  ajuda = "", opcoes = null, linhas = 3, atributos = "", mascara = "", classe = "",
}) {
  const id = `c-${nome}-${Math.random().toString(36).slice(2, 7)}`;
  const comuns = `id="${id}" name="${escapar(nome)}" ${obrigatorio ? "required" : ""} ${mascara ? `data-mascara="${mascara}"` : ""} ${atributos}`;
  let controle;
  if (tipo === "select") {
    controle = html`<select ${bruto(comuns)}>${opcoes.map((o) =>
      html`<option value="${o.valor}" ${String(o.valor) === String(valor) && bruto("selected")}>${o.texto}</option>`)}</select>`;
  } else if (tipo === "textarea") {
    controle = html`<textarea ${bruto(comuns)} rows="${linhas}" placeholder="${placeholder}">${valor}</textarea>`;
  } else if (tipo === "password") {
    controle = html`<div class="campo__senha"><input ${bruto(comuns)} type="password" value="${valor}" placeholder="${placeholder}">
      <button type="button" class="btn-icone btn-icone--pequeno" data-alternar-senha aria-label="Mostrar senha" tabindex="-1">${icone("olho", { tamanho: 18 })}</button></div>`;
  } else {
    controle = html`<input ${bruto(comuns)} type="${tipo}" value="${valor}" placeholder="${placeholder}">`;
  }
  return html`<div class="campo ${classe}"><label for="${id}">${rotulo}${obrigatorio && html`<span class="campo__obrig" aria-hidden="true"> *</span>`}</label>${controle}${ajuda && html`<small class="campo__ajuda">${ajuda}</small>`}</div>`;
}

/** Interruptor liga/desliga (é um checkbox por baixo). */
export function interruptor({ nome, rotulo, marcado = false, ajuda = "" }) {
  return html`<label class="interruptor"><input type="checkbox" name="${nome}" ${marcado && bruto("checked")}><span class="interruptor__trilho"></span>
    <span class="interruptor__texto"><strong>${rotulo}</strong>${ajuda && html`<small>${ajuda}</small>`}</span></label>`;
}

/** Lê os campos de um <form>: checkbox vira booleano, o resto vira texto. */
export function dadosDe(form) {
  const dados = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === "checkbox") dados[el.name] = el.checked;
    else if (el.type === "radio") { if (el.checked) dados[el.name] = el.value; }
    else if (el.type !== "file" && el.type !== "submit" && el.type !== "button") dados[el.name] = el.value;
  }
  return dados;
}

/** Preenche um formulário a partir de um objeto. */
export function preencher(form, dados) {
  for (const [nome, valor] of Object.entries(dados)) {
    const el = form.elements[nome];
    if (!el) continue;
    if (el.type === "checkbox") el.checked = !!valor;
    else el.value = valor ?? "";
  }
}

export function limparErros(raiz) {
  raiz.querySelectorAll(".campo--erro").forEach((c) => c.classList.remove("campo--erro"));
  raiz.querySelectorAll(".campo__erro").forEach((e) => e.remove());
  const geral = raiz.querySelector("[data-erro-geral]");
  if (geral) { geral.hidden = true; geral.textContent = ""; }
}

/**
 * Mostra o erro da API: por campo quando possível, senão numa caixa
 * `[data-erro-geral]` do formulário. Devolve true se algum campo foi marcado.
 */
export function mostrarErros(raiz, erro, aoNaoAchar) {
  limparErros(raiz);
  let primeiro = null;
  for (const [nome, mensagem] of Object.entries(erro.campos ?? {})) {
    const el = raiz.querySelector(`[name="${CSS.escape(nome)}"]`);
    const bloco = el?.closest(".campo");
    if (!bloco) continue;
    bloco.classList.add("campo--erro");
    bloco.insertAdjacentHTML("beforeend", `<small class="campo__erro">${escapar(mensagem)}</small>`);
    primeiro ??= el;
  }
  if (primeiro) { primeiro.focus(); return true; }
  const geral = raiz.querySelector("[data-erro-geral]");
  if (geral) { geral.hidden = false; geral.textContent = erro.message; }
  else aoNaoAchar?.(erro.message);
  return false;
}

/* ---------- Máscaras ---------- */
const MASCARAS = {
  telefone: (v) => mascaraTelefone(v),
  cep: (v) => mascaraCep(v),
};

/** Liga máscaras (data-mascara="telefone|cep|moeda"), mostrar/ocultar senha e limpeza de erro ao digitar. */
export function ativarCampos(raiz) {
  raiz.querySelectorAll("[data-mascara]").forEach((el) => {
    const tipo = el.dataset.mascara;
    if (tipo === "moeda") {
      el.inputMode = "decimal";
      // ao entrar no campo, o valor fica selecionado: quem digita substitui o "0,00" (o mouseup não desfaz a seleção)
      let recemFocado = false;
      el.addEventListener("focus", () => { recemFocado = true; el.select(); });
      el.addEventListener("mouseup", (ev) => { if (recemFocado) ev.preventDefault(); recemFocado = false; });
      el.addEventListener("blur", () => { recemFocado = false; if (el.value.trim()) el.value = emReais(paraCentavos(el.value)); });
    } else if (MASCARAS[tipo]) {
      el.inputMode = "numeric";
      el.addEventListener("input", () => { el.value = MASCARAS[tipo](el.value); });
      el.value = MASCARAS[tipo](el.value);
    }
  });
  raiz.querySelectorAll("[data-alternar-senha]").forEach((botao) => {
    botao.addEventListener("click", () => {
      const entrada = botao.parentElement.querySelector("input");
      const mostrar = entrada.type === "password";
      entrada.type = mostrar ? "text" : "password";
      botao.innerHTML = String(icone(mostrar ? "olhoFechado" : "olho", { tamanho: 18 }));
      botao.setAttribute("aria-label", mostrar ? "Ocultar senha" : "Mostrar senha");
    });
  });
  raiz.addEventListener("input", (ev) => {
    const bloco = ev.target.closest?.(".campo--erro");
    if (!bloco) return;
    bloco.classList.remove("campo--erro");
    bloco.querySelector(".campo__erro")?.remove();
  });
}
