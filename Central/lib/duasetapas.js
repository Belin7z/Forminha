/* ==========================================================
   VERIFICAÇÃO EM DUAS ETAPAS — além da senha, o código de 6 dígitos
   do aplicativo no celular (Google Authenticator e parecidos).
   • Ligar: a Central mostra um QR Code; a pessoa lê no aplicativo e
     digita o primeiro código. Saem 8 códigos de reserva (uso único)
     para o dia em que o celular sumir.
   • Vale para o dono e para cada pessoa da equipe (uma linha por
     pessoa). O segredo fica criptografado; dos códigos de reserva,
     só o resumo.
   • Do dono: se o "npm run configurar" trocar a senha (opção 7),
     a segunda etapa dele desliga junto — é o caminho de volta.
   ========================================================== */
import { createHash, randomInt } from "node:crypto";
import qrcode from "qrcode-generator";
import { ErroHttp } from "./erros.js";
import { confere, linkDoAplicativo, novoSegredo } from "./totp.js";

const LETRAS = "abcdefghjkmnpqrstuvwxyz23456789";
const RESERVAS = 8;
const resumo = (t) => createHash("sha256").update(String(t)).digest("hex");
const normalizarReserva = (t) => String(t ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const novaReserva = () => Array.from({ length: 8 }, (_, i) => (i === 4 ? "-" : "") + LETRAS[randomInt(LETRAS.length)]).join("");

/** O QR Code como imagem (data:), pronto para <img>. */
export function qrDoLink(link) {
  const q = qrcode(0, "M");
  q.addData(link);
  q.make();
  return `data:image/svg+xml;base64,${Buffer.from(q.createSvgTag({ cellSize: 5, margin: 2, scalable: true })).toString("base64")}`;
}

export function criarDuasEtapas({ banco, cofre, preparar = async () => {}, marcaDono = "" }) {
  const sql = async (t, p) => { await preparar(); return banco.consultar(t, p); };
  const ctx = (quem) => `totp:${quem.id}`;
  // a do dono só vale enquanto a senha do configurar for a mesma de quando ela foi ligada
  const valida = (l, quem) => l && (quem.tipo !== "dono" || l.base === marcaDono);

  async function linha(quem) {
    const [l] = await sql("select * from duas_etapas where quem = $1", [quem.id]);
    return valida(l, quem) ? l : null;
  }

  async function estado(quem) {
    const l = await linha(quem);
    return { ligada: Boolean(l?.ativo), desde: l?.ativo ? l.ligada_em : null, reservas: l?.ativo ? (l.reserva ?? []).length : 0 };
  }
  const ligada = async (quem) => (await estado(quem)).ligada;

  /** Começa a ligar: segredo novo (ainda pendente) e o QR Code para o aplicativo. */
  async function iniciar(quem, conta) {
    if (await ligada(quem)) throw new ErroHttp(409, "A verificação em duas etapas já está ligada.");
    const segredo = novoSegredo();
    await sql(`insert into duas_etapas (quem, pendente, ativo, segredo, reserva, base) values ($1, $2, false, null, '[]'::jsonb, $3)
      on conflict (quem) do update set pendente = excluded.pendente, ativo = false, segredo = null, reserva = '[]'::jsonb, base = excluded.base`,
    [quem.id, cofre.cifrar(segredo, ctx(quem)), marcaDono]);
    const link = linkDoAplicativo({ segredo, conta });
    return { segredo: segredo.match(/.{1,4}/g).join(" "), qr: qrDoLink(link) };
  }

  /** Confere o primeiro código do aplicativo e liga. Devolve os códigos de reserva (só desta vez). */
  async function ativar(quem, digitado) {
    const [l] = await sql("select * from duas_etapas where quem = $1", [quem.id]);
    if (!l?.pendente) throw new ErroHttp(409, "Comece de novo: clique em Ligar.");
    const segredo = cofre.decifrar(l.pendente, ctx(quem));
    const passo = confere(segredo, digitado);
    if (passo === null) throw new ErroHttp(422, "Código incorreto. Confira se o horário do celular está automático e tente o código novo.", { codigo: "Código incorreto." });
    const reservas = Array.from({ length: RESERVAS }, novaReserva);
    await sql(`update duas_etapas set segredo = pendente, pendente = null, ativo = true, ligada_em = now(), ultimo_passo = $2,
      reserva = $3::jsonb, base = $4 where quem = $1`, [quem.id, passo, JSON.stringify(reservas.map((r) => resumo(normalizarReserva(r)))), marcaDono]);
    return { codigos: reservas };
  }

  /**
   * Confere o código do login: o do aplicativo (cada código vale uma vez só) ou um de reserva (que some ao usar).
   * Devolve "aplicativo", "reserva" ou null.
   */
  async function conferirCodigo(quem, digitado) {
    const l = await linha(quem);
    if (!l?.ativo) return null;
    const segredo = cofre.decifrar(l.segredo, ctx(quem));
    const passo = confere(segredo, digitado);
    if (passo !== null) {
      const [ok] = await sql("update duas_etapas set ultimo_passo = $2 where quem = $1 and (ultimo_passo is null or ultimo_passo < $2) returning quem", [quem.id, passo]);
      return ok ? "aplicativo" : null; // o mesmo código de novo: recusa (alguém pode ter visto)
    }
    const r = resumo(normalizarReserva(digitado));
    if (normalizarReserva(digitado).length !== 8 || !(l.reserva ?? []).includes(r)) return null;
    await sql("update duas_etapas set reserva = reserva - $2 where quem = $1", [quem.id, r]);
    return "reserva";
  }

  const desligar = (quem) => sql("delete from duas_etapas where quem = $1", [quem.id]).then(() => ({ ligada: false }));

  /** Quem da lista (ids) está com a segunda etapa ligada (para a tela Equipe). */
  async function ligadasEntre(ids) {
    if (!ids.length) return new Set();
    return new Set((await sql("select quem from duas_etapas where ativo and quem = any($1)", [ids])).map((l) => l.quem));
  }

  return { estado, ligada, iniciar, ativar, conferirCodigo, desligar, ligadasEntre };
}
