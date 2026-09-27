/* ==========================================================
   DOMÍNIO — regras e rótulos usados pela loja e pelo painel (o banco
   tem a versão SQL em _status_texto/_proximos). Código puro (sem DOM, sem Node), para que
   todos falem exatamente a mesma língua.
   ========================================================== */

export const STATUS_TEXTO = {
  novo: "Pedido recebido",
  confirmado: "Confirmado",
  em_preparo: "Em preparo",
  pronto: "Pronto",
  saiu_entrega: "Saiu para entrega",
  entregue: "Entregue",
  cancelado: "Cancelado",
};

/** Rótulo do status, considerando se o pedido é entrega ou retirada. */
export function statusTexto(status, tipo) {
  if (tipo === "retirada") {
    if (status === "pronto") return "Pronto para retirada";
    if (status === "entregue") return "Retirado";
  }
  return STATUS_TEXTO[status] ?? status;
}

/** Linha do tempo exibida ao cliente (a retirada não tem "saiu para entrega"). */
export const etapasDoPedido = (tipo) =>
  ["novo", "confirmado", "em_preparo", "pronto", ...(tipo === "entrega" ? ["saiu_entrega"] : []), "entregue"];

const PROXIMOS = {
  novo: ["confirmado"],
  confirmado: ["em_preparo"],
  em_preparo: ["pronto"],
  pronto: ["saiu_entrega", "entregue"],
  saiu_entrega: ["entregue"],
};

export const STATUS_FINAIS = ["entregue", "cancelado"];
export const STATUS_ATIVOS = ["novo", "confirmado", "em_preparo", "pronto", "saiu_entrega"];

/** Status para os quais o pedido pode avançar (cancelar é sempre possível antes do fim). */
export function proximosStatus(status, tipo) {
  const avancos = (PROXIMOS[status] ?? []).filter((s) => tipo === "entrega" || s !== "saiu_entrega");
  return STATUS_FINAIS.includes(status) ? [] : [...avancos, "cancelado"];
}

export const FORMAS_PAGAMENTO = {
  pix: "PIX",
  dinheiro: "Dinheiro",
  cartao_entrega: "Cartão (na entrega ou retirada)",
};

/** Alérgenos que o produto pode declarar: [código, nome mostrado]. Os códigos são validados no banco. */
export const ALERGENOS = [
  ["gluten", "Glúten"], ["leite", "Leite"], ["ovos", "Ovos"], ["soja", "Soja"], ["amendoim", "Amendoim"], ["oleaginosas", "Oleaginosas (castanhas, nozes)"],
];

export const DIAS_SEMANA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

export const UFS = [
  "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA",
  "PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO",
];
