/* FORMATAÇÃO — dinheiro, telefone, datas e textos (valores em centavos) */

export const brl = (centavos) =>
  ((Number(centavos) || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** R$ 1.234 (sem centavos) — para eixos de gráfico e números grandes. */
export const brlInteiro = (centavos) =>
  ((Number(centavos) || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

/** Centavos -> "12,50" (para preencher campos de formulário). */
export const emReais = (centavos) => ((Number(centavos) || 0) / 100).toFixed(2).replace(".", ",");

/** "1.234,50" ou "12,5" -> centavos (123450 / 1250). */
export function paraCentavos(texto) {
  const numero = parseFloat(String(texto ?? "").trim().replace(/\./g, "").replace(",", "."));
  return Number.isFinite(numero) ? Math.round(numero * 100) : 0;
}

/** "11912345678" -> "(11) 91234-5678" */
export function telefone(valor) {
  const d = String(valor ?? "").replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d ? `(${d}` : "";
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

export const cep = (valor) => {
  const d = String(valor ?? "").replace(/\D/g, "").slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
};

/** Texto de data/hora do servidor ("2026-09-20 14:30:00") -> Date local. */
export const lerData = (texto) => new Date(String(texto).replace(" ", "T"));

const DIAS_CURTOS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const DIAS_LONGOS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];

/** "2026-09-22" -> "22/09/2026" */
export const dataBR = (iso) => (iso ? iso.split("-").reverse().join("/") : "");

/** "2026-09-22" -> "22/09" */
export const dataCurta = (iso) => (iso ? iso.split("-").reverse().slice(0, 2).join("/") : "");

/** "2026-09-22" -> "terça-feira, 22/09" */
export function dataPorExtenso(iso) {
  const [a, m, d] = iso.split("-").map(Number);
  const data = new Date(a, m - 1, d);
  return `${DIAS_LONGOS[data.getDay()]}, ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
}

export function diaCurto(iso) {
  const [a, m, d] = iso.split("-").map(Number);
  return DIAS_CURTOS[new Date(a, m - 1, d).getDay()];
}

export function dataHora(texto) {
  if (!texto) return "";
  const d = lerData(texto);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function tempoRelativo(texto) {
  const minutos = Math.round((Date.now() - lerData(texto).getTime()) / 60000);
  if (minutos < 1) return "agora mesmo";
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `há ${horas} h`;
  const dias = Math.round(horas / 24);
  return dias === 1 ? "ontem" : `há ${dias} dias`;
}

export const iniciais = (nome) =>
  String(nome ?? "").trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");

export const km = (n) => `${Number(n).toFixed(1).replace(".", ",")} km`;

export const plural = (n, singular, pluralTexto = `${singular}s`) => `${n} ${n === 1 ? singular : pluralTexto}`;

export const horasTexto = (h) => (h >= 24 && h % 24 === 0 ? plural(h / 24, "dia") : `${h}h`);

export const enderecoEmLinha = (e) => {
  const rua = [e.rua, e.numero].filter(Boolean).join(", ") + (e.complemento ? ` — ${e.complemento}` : "");
  const local = [e.bairro, [e.cidade, e.uf].filter(Boolean).join("/")].filter(Boolean).join(", ");
  return [rua, local].filter(Boolean).join(" · ");
};
