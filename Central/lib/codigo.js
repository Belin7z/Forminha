/* ==========================================================
   CÓDIGO DA LOJA — identificação única de cada loja (ex.: 7XT-Tna-dRe).
   Sem letras que se confundem (0/O, 1/l/I): dá para ditar por telefone.
   O projeto no Supabase leva o nome "<código> · <nome da loja>".
   ========================================================== */
import { randomInt } from "node:crypto";

const ALFABETO = "23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
const GRUPO = "[23456789a-km-zA-HJ-NP-Z]{3}";
export const PADRAO_CODIGO = new RegExp(`^${GRUPO}-${GRUPO}-${GRUPO}$`);

export function gerarCodigo() {
  const grupo = () => Array.from({ length: 3 }, () => ALFABETO[randomInt(ALFABETO.length)]).join("");
  return `${grupo()}-${grupo()}-${grupo()}`;
}

export const nomeDoProjeto = (codigo, nome) => `${codigo} · ${nome}`;

/** "7XT-Tna-dRe · Doce da Ana" -> { codigo, nome }; projetos fora do padrão -> null (a Central ignora). */
export function lerNomeDoProjeto(texto) {
  const m = /^(\S{11}) · (.+)$/.exec(String(texto ?? ""));
  return m && PADRAO_CODIGO.test(m[1]) ? { codigo: m[1], nome: m[2] } : null;
}

/** Nome de site na Vercel a partir do nome da loja: "Doce da Ana" -> "doce-da-ana". */
export function slug(texto) {
  const s = String(texto ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
  return s || "loja";
}

/** Senha forte e aleatória para o banco de cada loja (ninguém precisa decorar: a Central usa a API). */
export function senhaAleatoria(tamanho = 32) {
  const letras = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: tamanho }, () => letras[randomInt(letras.length)]).join("");
}
