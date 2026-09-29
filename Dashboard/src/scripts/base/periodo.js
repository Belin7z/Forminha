/* ==========================================================
   BASE — períodos do relatório de vendas e os nomes de cada
   pedaço do gráfico (hora, dia, mês ou ano). As datas usam o dia
   de hoje de quem está usando o painel.
   ========================================================== */
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const somarDias = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

export const PERIODOS = [
  ["hoje", "Hoje"], ["7d", "7 dias"], ["30d", "30 dias"], ["mes", "Este mês"], ["mes-passado", "Mês passado"],
  ["12m", "12 meses"], ["anos", "Por ano"], ["outro", "Personalizado"],
];

/** { de, ate, agrupar } de um atalho (o agrupamento vazio deixa o banco escolher). */
export function periodo(id, hoje = new Date()) {
  const h = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  switch (id) {
    case "hoje": return { de: iso(h), ate: iso(h), agrupar: "hora" };
    case "7d": return { de: iso(somarDias(h, -6)), ate: iso(h), agrupar: "dia" };
    case "30d": return { de: iso(somarDias(h, -29)), ate: iso(h), agrupar: "dia" };
    case "mes-passado": return { de: iso(new Date(h.getFullYear(), h.getMonth() - 1, 1)), ate: iso(new Date(h.getFullYear(), h.getMonth(), 0)), agrupar: "dia" };
    case "12m": return { de: iso(new Date(h.getFullYear(), h.getMonth() - 11, 1)), ate: iso(h), agrupar: "mes" };
    case "anos": return { de: `${h.getFullYear() - 4}-01-01`, ate: iso(h), agrupar: "ano" };
    default: return { de: iso(new Date(h.getFullYear(), h.getMonth(), 1)), ate: iso(h), agrupar: "dia" }; // este mês
  }
}

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MESES_LONGOS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
export const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
export const SEMANA_LONGA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/** Rótulo curto (embaixo da barra) e longo (dica) de cada pedaço do gráfico. */
export function rotulosDe(chave, agrupar) {
  if (agrupar === "hora") {
    const [dia, h] = chave.split(" ");
    const [, m, d] = dia.split("-");
    return { curto: `${Number(h)}h`, longo: `${d}/${m} · ${Number(h)}h às ${Number(h) + 1}h` };
  }
  if (agrupar === "dia") {
    const [a, m, d] = chave.split("-").map(Number);
    const semana = SEMANA[new Date(Date.UTC(a, m - 1, d)).getUTCDay()];
    const dd = String(d).padStart(2, "0"), mm = String(m).padStart(2, "0");
    return { curto: `${dd}/${mm}`, longo: `${semana}, ${dd}/${mm}/${a}` };
  }
  if (agrupar === "mes") {
    const [a, m] = chave.split("-").map(Number);
    return { curto: `${MESES[m - 1]}/${String(a).slice(2)}`, longo: `${MESES_LONGOS[m - 1]} de ${a}` };
  }
  return { curto: chave, longo: chave };
}

/** Quanto mudou em relação ao período anterior: { pct, sobe } ou null quando não dá para comparar. */
export function variacao(atual, anterior) {
  if (!anterior) return null;
  const pct = Math.round(((atual - anterior) / anterior) * 100);
  return { pct: Math.abs(pct), sobe: pct >= 0 };
}
