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

// o escopo que cada chave precisa (o erro mais comum é criar a chave para um projeto só)
const ESCOPO = {
  Vercel: "Na Vercel, a chave precisa ser da equipe inteira (Scope: sua equipe → All Projects), não de um projeto só.",
  Supabase: "No Supabase, a chave precisa da organização Forminha com acesso total.",
};

/** Chave recusada (vencida, apagada ou sem permissão): diz o que fazer e o motivo que o serviço deu. */
export function mensagemDeChaveRecusada(quem, status, detalhe = "") {
  const opcao = quem === "Vercel" ? "6" : "5";
  const motivo = status === 403 ? "não tem permissão para isso" : "foi recusada (venceu ou foi apagada)";
  const dica = status === 403 && ESCOPO[quem] ? ` ${ESCOPO[quem]}` : "";
  const disse = String(detalhe).replace(new RegExp(`^${quem}:\\s*`), "").trim();
  return `${daChave(quem)} ${motivo}.${dica} Crie uma nova e rode "npm run configurar", opção ${opcao}.${disse ? ` (${quem}: ${disse.slice(0, 160)})` : ""}`;
}
