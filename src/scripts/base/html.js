/* ==========================================================
   HTML — template string que escapa tudo por padrão.
   Qualquer texto vindo do usuário (nome, endereço, comentário…)
   é convertido em texto puro, então não dá para injetar código.

     html`<p>Olá, ${nome}!</p>`            // nome é escapado
     html`<ul>${itens.map(i => html`<li>${i}</li>`)}</ul>`   // aninhar é seguro
     html`<div>${cond && html`<b>ok</b>`}</div>`             // false/null somem
   ========================================================== */

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** HTML já confiável (resultado de `html` ou de `bruto`). */
class Seguro {
  constructor(texto) { this.texto = texto; }
  toString() { return this.texto; }
}

export const escapar = (valor) => String(valor ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** Marca um trecho como confiável. Use SÓ com texto escrito por você, nunca com dados do usuário. */
export const bruto = (texto) => new Seguro(String(texto));

function converter(valor) {
  if (valor instanceof Seguro) return valor.texto;
  if (Array.isArray(valor)) return valor.map(converter).join("");
  if (valor === false || valor == null) return ""; // true vira o texto "true" (use String() em atributos ARIA)
  return escapar(valor);
}

export function html(partes, ...valores) {
  let saida = partes[0];
  valores.forEach((v, i) => { saida += converter(v) + partes[i + 1]; });
  return new Seguro(saida);
}

/** Coloca o conteúdo dentro de um elemento. */
export function montar(elemento, conteudo) {
  elemento.innerHTML = String(conteudo);
  return elemento;
}

/** Cria um elemento a partir de um trecho de HTML. */
export function criarElemento(conteudo) {
  const modelo = document.createElement("template");
  modelo.innerHTML = String(conteudo).trim();
  return modelo.content.firstElementChild;
}

/**
 * Liga eventos por delegação: um único ouvinte na raiz reconhece
 * elementos com data-acao="nome" e chama a função correspondente.
 *   delegar(raiz, { salvar: (el, ev) => … })
 */
export function delegar(raiz, acoes, tipo = "click") {
  const ouvinte = (ev) => {
    const alvo = ev.target.closest("[data-acao]");
    if (!alvo || !raiz.contains(alvo)) return;
    const fn = acoes[alvo.dataset.acao];
    if (fn) fn(alvo, ev);
  };
  raiz.addEventListener(tipo, ouvinte);
  return () => raiz.removeEventListener(tipo, ouvinte);
}
