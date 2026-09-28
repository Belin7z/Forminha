/* ==========================================================
   CHAVES — as chaves do Supabase e da Vercel podem ter prazo.
   O "configurar" guarda a data de vencimento (SUPABASE_CHAVE_VENCE,
   VERCEL_CHAVE_VENCE, no formato AAAA-MM-DD); aqui a Central conta
   quantos dias faltam, para avisar no painel e por e-mail antes
   de parar de criar lojas.
   ========================================================== */
const CHAVES = [["SUPABASE_CHAVE_VENCE", "Supabase", "5"], ["VERCEL_CHAVE_VENCE", "Vercel", "6"]];
const DIA = 86_400_000;
const daChave = (nome) => (nome === "Vercel" ? "A chave da Vercel" : `A chave do ${nome}`);

/** Chaves que vencem em até `antes` dias, ou que já venceram. */
export function chavesVencendo(env, { hoje = new Date(), antes = 15 } = {}) {
  const inicio = Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate());
  return CHAVES.flatMap(([variavel, nome, opcao]) => {
    const vence = String(env[variavel] ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(vence) || Number.isNaN(Date.parse(`${vence}T00:00:00Z`))) return [];
    const dias = Math.round((Date.parse(`${vence}T00:00:00Z`) - inicio) / DIA);
    return dias <= antes ? [{ nome, vence, dias, opcao }] : [];
  });
}

/** "A chave do Supabase vence em 3 dias" / "vence hoje" / "venceu". */
export function textoDoPrazo({ nome, dias }) {
  if (dias < 0) return `${daChave(nome)} venceu`;
  if (dias === 0) return `${daChave(nome)} vence hoje`;
  return `${daChave(nome)} vence em ${dias} ${dias === 1 ? "dia" : "dias"}`;
}

/** Chave recusada (vencida, apagada ou sem permissão): diz o que fazer. */
export function mensagemDeChaveRecusada(quem, status) {
  const opcao = quem === "Vercel" ? "6" : "5";
  const motivo = status === 403 ? "não tem permissão para isso" : "foi recusada (venceu ou foi apagada)";
  return `${daChave(quem)} ${motivo}. Crie uma nova e rode "npm run configurar", opção ${opcao}.`;
}
