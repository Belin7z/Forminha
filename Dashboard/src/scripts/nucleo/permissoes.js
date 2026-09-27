/* ==========================================================
   NÚCLEO — quem vê o quê no painel.
   O administrador vê tudo. O atendente cuida de pedidos, agenda
   e produção (o banco também recusa o resto: isto só esconde
   o que a pessoa não poderia usar).
   ========================================================== */
export const PAPEIS = { admin: "Administrador", atendente: "Atendente" };

const DO_ATENDENTE = ["/pedidos", "/agenda", "/producao", "/conta"];

export const podeAcessar = (papel, caminho) =>
  papel === "admin" || DO_ATENDENTE.some((r) => caminho === r || caminho.startsWith(`${r}/`));
