/* NÚCLEO DA CENTRAL — conversa com a API e peças usadas por todas as telas */
import { html } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";

export const raiz = document.getElementById("raiz");
export const dorme = (ms) => new Promise((ok) => setTimeout(ok, ms));

let aoExpirar = () => {};
/** O que fazer quando a sessão acaba no meio do uso (a tela de entrar). */
export const quandoExpirar = (fn) => { aoExpirar = fn; };

export async function api(metodo, caminho, corpo) {
  let r;
  try {
    r = await fetch(`/api/${caminho}`, {
      method: metodo, credentials: "same-origin",
      headers: corpo === undefined ? {} : { "Content-Type": "application/json" },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
  } catch { throw Object.assign(new Error("Sem conexão com a Central. Confira a internet."), { status: 0 }); }
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401 && caminho !== "entrar" && !caminho.startsWith("publico/")) aoExpirar();
    throw Object.assign(new Error(dados.erro ?? "Algo deu errado."), { status: r.status, campos: dados.campos });
  }
  return dados;
}

export const marca = html`<span class="marca-central"><span class="marca-central__selo">${icone("cupcake", { tamanho: 22 })}</span>
  <span><strong>Forminha</strong><small>Central</small></span></span>`;

export const aviso = (tipo, conteudo) => html`<div class="aviso aviso--${tipo}">${icone(tipo === "sucesso" ? "checkCirculo" : tipo === "info" ? "info" : "alerta", { tamanho: 16 })}<span>${conteudo}</span></div>`;

export const reais = (centavos) => (Number(centavos || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const quando = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
export const dia = (iso) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" }) : "");
export const telefoneBonito = (t) => {
  const d = String(t ?? "").replace(/\D/g, "");
  return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : d.length === 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` : d;
};
export const documentoBonito = (d) => {
  const s = String(d ?? "");
  if (s.length === 11) return `${s.slice(0, 3)}.${s.slice(3, 6)}.${s.slice(6, 9)}-${s.slice(9)}`;
  if (s.length === 14) return `${s.slice(0, 2)}.${s.slice(2, 5)}.${s.slice(5, 8)}/${s.slice(8, 12)}-${s.slice(12)}`;
  return s;
};
/** Link do WhatsApp com a mensagem pronta (para a cliente, se tiver o número). */
export const linkWhats = (mensagem, telefone = "") => `https://wa.me/${telefone ? `55${String(telefone).replace(/\D/g, "")}` : ""}?text=${encodeURIComponent(mensagem)}`;

/** A pessoa logada pode fazer isto? (o dono pode tudo; o servidor confere de novo) */
export const pode = (eu, permissao) => Boolean(eu?.permissoes?.includes(permissao));
