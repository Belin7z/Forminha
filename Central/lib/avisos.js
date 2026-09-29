/* ==========================================================
   AVISOS — o sino da Central: o que acabou de acontecer
   (pagamento caiu, loja pronta, criação parou, cliente nova).
   Cada aviso diz quem pode ver (uma permissão, "dono" ou todos) e
   cada pessoa guarda até onde já viu. Sem dados pessoais: só o
   nome público da loja e valores.
   ========================================================== */
const MAXIMO_NA_LISTA = 30;

export function criarAvisos({ banco, preparar = async () => {} }) {
  const sql = async (t, p) => { await preparar(); return banco.consultar(t, p); };
  const podeVer = (quem, a) => !a.permissao || (a.permissao === "dono" ? quem.tipo === "dono" : quem.permissoes.includes(a.permissao));

  /** Registra um aviso. Nunca derruba quem chamou (o aviso é um extra). */
  async function registrar({ tipo, titulo, texto = "", cliente_id = null, permissao = null }) {
    try {
      await sql("insert into avisos (tipo, titulo, texto, cliente_id, permissao) values ($1, $2, $3, $4, $5)",
        [tipo, String(titulo).slice(0, 160), String(texto).slice(0, 300), cliente_id, permissao]);
      if (Math.random() < 0.02) await sql("delete from avisos where em < now() - interval '90 days'");
    } catch (e) { console.error("[avisos]", e.message); }
  }

  /** Os avisos que a pessoa pode ver, os mais novos primeiro, e quantos ela ainda não viu. */
  async function listar(quem) {
    const linhas = await sql("select id, em, tipo, titulo, texto, cliente_id, permissao from avisos order by id desc limit 300");
    const [v] = await sql("select ate from avisos_vistos where quem = $1", [quem.id]);
    const visto = Number(v?.ate ?? 0);
    const meus = linhas.filter((a) => podeVer(quem, a));
    return {
      avisos: meus.slice(0, MAXIMO_NA_LISTA).map((a) => ({ id: Number(a.id), em: a.em, tipo: a.tipo, titulo: a.titulo, texto: a.texto, cliente_id: a.cliente_id, novo: Number(a.id) > visto })),
      nao_vistos: meus.filter((a) => Number(a.id) > visto).length,
      ultimo: Number(meus[0]?.id ?? 0),
    };
  }

  /** Marca como visto tudo até `ate` (nunca volta para trás). */
  async function marcarVistos(quem, ate) {
    const n = Math.max(0, Math.floor(Number(ate) || 0));
    await sql(`insert into avisos_vistos (quem, ate) values ($1, $2)
      on conflict (quem) do update set ate = greatest(avisos_vistos.ate, excluded.ate)`, [quem.id, n]);
    return { ok: true };
  }

  return { registrar, listar, marcarVistos };
}
