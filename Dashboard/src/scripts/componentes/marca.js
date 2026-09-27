/* COMPONENTE — a marca da loja no painel (menu lateral e login): logo, se houver; senão, as iniciais do nome */
import { html } from "/src/scripts/base/html.js";
import { iniciais } from "/src/scripts/base/formatacao.js";
import { estado } from "../nucleo/estado.js";

export const nomeDaLoja = () => String(estado.loja?.nome ?? "").trim() || "Minha loja";

/** Selo redondo com o logo (ou as iniciais) — `classe` é o estilo do lugar (lateral__logo, login__logo). */
export const seloDaLoja = (classe) => (estado.loja?.logo
  ? html`<span class="${classe} ${classe}--imagem"><img src="${estado.loja.logo}" alt=""></span>`
  : html`<span class="${classe}">${iniciais(nomeDaLoja())}</span>`);
