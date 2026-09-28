/* PERÍODOS — atalhos do relatório de vendas (datas no dia de hoje de quem está usando) */
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const somarDias = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

export const PERIODOS = [
  ["hoje", "Hoje"], ["7d", "7 dias"], ["30d", "30 dias"], ["mes", "Este mês"], ["12m", "12 meses"], ["anos", "Por ano"], ["outro", "Personalizado"],
];

/** { de, ate, agrupar } de um atalho. */
export function periodo(id, hoje = new Date()) {
  const h = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  switch (id) {
    case "hoje": return { de: iso(h), ate: iso(h), agrupar: "hora" };
    case "7d": return { de: iso(somarDias(h, -6)), ate: iso(h), agrupar: "dia" };
    case "30d": return { de: iso(somarDias(h, -29)), ate: iso(h), agrupar: "dia" };
    case "12m": return { de: iso(new Date(h.getFullYear(), h.getMonth() - 11, 1)), ate: iso(h), agrupar: "mes" };
    case "anos": return { de: `${h.getFullYear() - 4}-01-01`, ate: iso(h), agrupar: "ano" };
    default: return { de: iso(new Date(h.getFullYear(), h.getMonth(), 1)), ate: iso(h), agrupar: "dia" }; // este mês
  }
}

export const dataBR = (iso) => (iso ? iso.split("-").reverse().join("/") : "");
