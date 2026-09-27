/* ==========================================================
   NÚCLEO — números e textos do estoque.
   Toda quantidade fica na unidade do ingrediente (g, ml ou un);
   só a exibição converte para kg e L quando passa de mil.
   ========================================================== */

import { brl } from "/src/scripts/base/formatacao.js";

export const UNIDADES = [
  { valor: "g", texto: "g — gramas (farinha, açúcar, chocolate…)" },
  { valor: "ml", texto: "ml — mililitros (leite, creme de leite…)" },
  { valor: "un", texto: "un — unidades (ovos, caixas, embalagens…)" },
];

/** Para buscar sem se importar com acento ou maiúscula. */
export const semAcento = (t) => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const formato = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });
export const numero = (n) => formato.format(Number(n) || 0);

/** 1500 g -> "1,5 kg"; 250 ml -> "250 ml"; 6 un -> "6 un". */
export function qtdTexto(valor, unidade) {
  const n = Number(valor) || 0;
  if (unidade === "g" && Math.abs(n) >= 1000) return `${numero(n / 1000)} kg`;
  if (unidade === "ml" && Math.abs(n) >= 1000) return `${numero(n / 1000)} L`;
  return `${numero(n)} ${unidade}`;
}

/** Com sinal, para o histórico: "+790 g" / "−1,2 kg". */
export const qtdComSinal = (valor, unidade) => `${Number(valor) < 0 ? "−" : "+"}${qtdTexto(Math.abs(Number(valor)), unidade)}`;

/** Texto digitado (vírgula decimal; ponto como milhar: "1.500" = 1500) -> número, ou NaN se não for número. */
export const lerNumero = (texto) => {
  let t = String(texto ?? "").trim().replace(/\s/g, "");
  if (t === "") return NaN;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, "");
  return Number(t.replace(",", "."));
};

/** Número -> texto para preencher um campo (sem milhar, com vírgula): 1500.5 -> "1500,5". */
export const paraCampo = (n) => String(Number(n) || 0).replace(".", ",");

/** Campo -> valor para enviar: número quando dá; o texto original quando não (o servidor explica o erro). */
export const paraEnvio = (texto) => { const n = lerNumero(texto); return Number.isFinite(n) ? n : texto; };

/** Situação de um ingrediente pela previsão (que já considera os pedidos agendados). */
export const SITUACAO_PREVISAO = {
  faltando: ["badge--perigo", "Vai faltar"],
  baixo: ["badge--aviso", "Abaixo do mínimo"],
  ok: ["badge--sucesso", "Em dia"],
};

/** Situação só pela quantidade guardada (sem olhar pedidos). */
export function situacaoAtual(i) {
  if (Number(i.estoque) <= 0) return ["badge--perigo", "Sem estoque"];
  if (Number(i.minimo) > 0 && Number(i.estoque) < Number(i.minimo)) return ["badge--aviso", "Abaixo do mínimo"];
  return ["badge--sucesso", "Em dia"];
}

/** Preço de referência: "R$ 5,00 / kg", "R$ 1,00 cada" ou "sem preço". */
export function custoTexto(i) {
  const c = Number(i.custo_unit) || 0;
  if (!c) return "sem preço";
  return i.unidade === "un" ? `${brl(Math.round(c))} cada` : `${brl(Math.round(c * 1000))} / ${i.unidade === "g" ? "kg" : "L"}`;
}

/** "lata de 395 g" (sem plural, para não errar a palavra que a pessoa escolheu). */
export const embalagemTexto = (i) => `${i.embalagem_nome || "embalagem"} de ${qtdTexto(i.embalagem_qtd, i.unidade)}`;

/** Tem fardo cadastrado (compra no atacado, em caixa/fardo com várias embalagens)? */
export const temFardo = (i) => Number(i?.fardo_qtd) > 0;

/** "caixa com 10 pacotes" (a quantidade de embalagens, não a quantidade na medida-base). */
export const fardoTexto = (i) => `${i.fardo_nome || "fardo"} com ${numero(i.fardo_qtd)} ${i.embalagem_nome || "embalagem"}${Number(i.fardo_qtd) === 1 ? "" : "s"}`;

/** "economize 16%" comprando no fardo em vez de embalagem avulsa (só quando realmente compensa). */
export const fardoEconomiaTexto = (i) => (Number(i?.fardo_economia_pct) > 0 ? `economize ${numero(i.fardo_economia_pct)}%` : null);

/** 0–100: quanto do caminho até o mínimo o estoque já percorreu (para a barra visual da lista). Sem mínimo, olha só se está zerado. */
export function nivelEstoque(i) {
  const estoque = Number(i.estoque) || 0, minimo = Number(i.minimo) || 0;
  if (estoque <= 0) return 0;
  if (minimo <= 0) return 100;
  return Math.max(4, Math.min(100, Math.round((estoque / (minimo * 2)) * 100)));
}

/** Dias até vencer (negativo = já venceu) em texto. */
export function validadeTexto(dias) {
  const n = Number(dias);
  if (n < 0) return `venceu há ${-n} ${-n === 1 ? "dia" : "dias"}`;
  if (n === 0) return "vence hoje";
  if (n === 1) return "vence amanhã";
  return `vence em ${n} dias`;
}

/** Dias entre hoje e uma data AAAA-MM-DD (para a validade mostrada na lista). */
export function diasAte(iso) {
  const [a, m, d] = String(iso).split("-").map(Number);
  const hoje = new Date();
  return Math.round((Date.UTC(a, m - 1, d) - Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate())) / 86_400_000);
}

export const SITUACAO_LOTE = {
  vencido: ["badge--perigo", "Vencido"],
  vencendo: ["badge--aviso", "Vence logo"],
  ok: ["badge--sucesso", "No prazo"],
};

export const TIPOS_MOVIMENTO = {
  inicial: ["badge--neutro", "Estoque inicial"],
  compra: ["badge--sucesso", "Compra"],
  uso: ["badge--info", "Usado em pedido"],
  devolucao: ["badge--neutro", "Devolução"],
  ajuste: ["badge--aviso", "Contagem"],
  perda: ["badge--perigo", "Perda"],
};
