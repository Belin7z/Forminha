/* ==========================================================
   PROTEÇÃO CONTRA TENTATIVAS — senha (ou código) errado muitas
   vezes seguidas bloqueia por um tempo que cresce: 1 min depois de
   5 erros, 2 min depois de 10, 4, 8… até 15 min. Conta por endereço
   (IP) e por conta, e fica no BANCO: vale para todas as cópias da
   Central na Vercel ao mesmo tempo. Sem banco, fica na memória.
   ========================================================== */
import { ErroHttp } from "./erros.js";

const POR_RODADA = 5;
const MAXIMO_MIN = 15;
const ESQUECE_DEPOIS = "1 hour"; // erros antigos param de contar
export const minutosDeBloqueio = (falhas) => (falhas < POR_RODADA ? 0 : Math.min(MAXIMO_MIN, 2 ** (Math.floor(falhas / POR_RODADA) - 1)));

export function criarProtecao({ banco = null, preparar = async () => {} } = {}) {
  const memoria = new Map();
  const sql = async (t, p) => { await preparar(); return banco.consultar(t, p); };

  /** Bloqueado agora? Lança 429 dizendo quanto falta. */
  async function conferir(chaves) {
    let ate = 0;
    if (banco) {
      const linhas = await sql("select bloqueado_ate from tentativas_login where chave = any($1) and bloqueado_ate > now()", [chaves]).catch(() => []);
      for (const l of linhas) ate = Math.max(ate, new Date(l.bloqueado_ate).getTime());
    } else {
      for (const k of chaves) ate = Math.max(ate, memoria.get(k)?.ate ?? 0);
    }
    if (ate > Date.now()) {
      const s = Math.ceil((ate - Date.now()) / 1000);
      throw new ErroHttp(429, `Muitas tentativas. Aguarde ${s >= 90 ? `${Math.ceil(s / 60)} minutos` : `${s} segundos`}.`);
    }
  }

  /** Mais um erro para cada chave (e bloqueia quando passar do limite). */
  async function falhou(chaves) {
    if (banco) {
      for (const k of chaves) {
        await sql(`insert into tentativas_login as t (chave, falhas, atualizado_em) values ($1, 1, now())
          on conflict (chave) do update set
            falhas = case when t.atualizado_em < now() - interval '${ESQUECE_DEPOIS}' then 1 else t.falhas + 1 end,
            atualizado_em = now()`, [k]).catch((e) => console.error("[protecao]", e.message));
        await sql(`update tentativas_login set bloqueado_ate = now() + make_interval(mins => least(${MAXIMO_MIN}, power(2, floor(falhas / ${POR_RODADA}) - 1)::int))
          where chave = $1 and falhas >= ${POR_RODADA} and falhas % ${POR_RODADA} = 0`, [k]).catch((e) => console.error("[protecao]", e.message));
      }
      if (Math.random() < 0.02) await sql("delete from tentativas_login where atualizado_em < now() - interval '1 day'").catch(() => {});
      return;
    }
    for (const k of chaves) {
      const t = memoria.get(k) ?? { n: 0, ate: 0 };
      t.n += 1;
      if (t.n % POR_RODADA === 0) t.ate = Date.now() + minutosDeBloqueio(t.n) * 60_000;
      memoria.set(k, t);
    }
  }

  /** Acertou: zera as chaves. */
  async function acertou(chaves) {
    if (banco) { await sql("delete from tentativas_login where chave = any($1)", [chaves]).catch(() => {}); return; }
    for (const k of chaves) memoria.delete(k);
  }

  return { conferir, falhou, acertou };
}
