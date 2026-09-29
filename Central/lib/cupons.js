/* ==========================================================
   CUPONS E INDICAÇÃO
     - cupom: desconto em % ou em R$, com validade e limite de usos
       (o uso é reservado no cadastro e devolvido se ela cancelar);
     - indicação: cada cliente que já pagou tem o próprio código;
       quem usa ganha o desconto da indicação e, quando paga, quem
       indicou ganha crédito (para abater nas mensalidades).
   Os códigos ficam sempre em MAIÚSCULAS, sem espaço.
   ========================================================== */
import { randomBytes } from "node:crypto";
import { ErroHttp } from "./erros.js";

const CODIGO = /^[A-Z0-9-]{3,20}$/;
const HOJE = "(now() at time zone 'America/Sao_Paulo')::date";
const PADRAO_INDICACAO = { desconto_pct: 10, recompensa_centavos: 5000 };
const LETRAS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export const normalizarCodigo = (t) => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, "");

/** Quanto o cupom tira de um valor (nunca deixa a loja abaixo de R$ 1,00). */
export function descontoDe(cupom, valorCentavos) {
  const bruto = cupom.tipo === "percentual" ? Math.round((valorCentavos * cupom.valor) / 100) : cupom.valor;
  return Math.max(0, Math.min(bruto, valorCentavos - 100));
}

/** "10% de desconto" · "R$ 20,00 de desconto" */
export const descricaoDe = (c) => (c.tipo === "percentual" ? `${c.valor}% de desconto` : `${(c.valor / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} de desconto`);

export function criarCupons({ banco, preparar = async () => {} }) {
  const sql = async (t, p) => { await preparar(); return banco.consultar(t, p); };

  const publico = (c) => ({
    id: c.id, codigo: c.codigo, tipo: c.tipo, valor: c.valor, validade: c.validade ? String(c.validade instanceof Date ? c.validade.toISOString() : c.validade).slice(0, 10) : null,
    max_usos: c.max_usos, usos: c.usos, ativo: c.ativo, indicacao: Boolean(c.indicacao_de), descricao: descricaoDe(c), criado_em: c.criado_em,
  });

  /* ---------- configuração da indicação ---------- */
  async function lerIndicacao() {
    const [l] = await sql("select valor from configuracoes where chave = 'indicacao'");
    return { ...PADRAO_INDICACAO, ...(l?.valor ?? {}) };
  }
  async function salvarIndicacao(corpo) {
    const pct = Math.round(Number(corpo.desconto_pct));
    const recompensa = Math.round(Number(corpo.recompensa_centavos));
    const campos = {};
    if (!Number.isFinite(pct) || pct < 0 || pct > 90) campos.desconto_pct = "Desconto da indicada: de 0% a 90%.";
    if (!Number.isFinite(recompensa) || recompensa < 0 || recompensa > 10_000_000) campos.recompensa = "Crédito de quem indicou: de R$ 0 a R$ 100.000.";
    if (Object.keys(campos).length) throw new ErroHttp(422, Object.values(campos)[0], campos);
    await sql("insert into configuracoes (chave, valor) values ('indicacao', $1::jsonb) on conflict (chave) do update set valor = excluded.valor",
      [JSON.stringify({ desconto_pct: pct, recompensa_centavos: recompensa })]);
    // os códigos de indicação que já existem passam a dar o desconto novo (0% = desligados)
    await sql("update cupons set valor = greatest($1, 1), ativo = $1 > 0 where indicacao_de is not null", [pct]);
    return lerIndicacao();
  }

  /* ---------- cupons ---------- */
  async function listar() {
    const linhas = await sql("select * from cupons where indicacao_de is null order by criado_em desc");
    const [ind] = await sql("select count(*)::int as codigos, coalesce(sum(usos), 0)::int as usos from cupons where indicacao_de is not null");
    return { cupons: linhas.map(publico), indicacao: { ...(await lerIndicacao()), codigos: ind.codigos, usos: ind.usos } };
  }

  function validar(corpo, { parcial = false } = {}) {
    const d = {}; const campos = {};
    const tem = (k) => !parcial || corpo[k] !== undefined;
    if (tem("codigo")) { d.codigo = normalizarCodigo(corpo.codigo); if (!CODIGO.test(d.codigo)) campos.codigo = "Código: de 3 a 20 letras, números ou hífen."; }
    if (tem("tipo")) { d.tipo = corpo.tipo === "valor" ? "valor" : "percentual"; }
    if (tem("valor")) {
      d.valor = Math.round(Number(corpo.valor));
      const tipo = d.tipo ?? corpo.tipo;
      if (!Number.isFinite(d.valor) || d.valor < 1 || (tipo === "percentual" ? d.valor > 90 : d.valor > 10_000_000)) {
        campos.valor = tipo === "percentual" ? "Desconto: de 1% a 90%." : "Desconto: de R$ 0,01 a R$ 100.000,00.";
      }
    }
    if (tem("validade")) {
      d.validade = corpo.validade ? String(corpo.validade) : null;
      if (d.validade && !/^\d{4}-\d{2}-\d{2}$/.test(d.validade)) campos.validade = "Data inválida.";
    }
    if (tem("max_usos")) {
      d.max_usos = corpo.max_usos === null || corpo.max_usos === "" || corpo.max_usos === undefined ? null : Math.round(Number(corpo.max_usos));
      if (d.max_usos !== null && (!Number.isFinite(d.max_usos) || d.max_usos < 1 || d.max_usos > 1_000_000)) campos.max_usos = "Limite: de 1 a 1.000.000 (ou em branco para sem limite).";
    }
    if (tem("ativo")) d.ativo = corpo.ativo !== false;
    if (Object.keys(campos).length) throw new ErroHttp(422, Object.values(campos)[0], campos);
    return d;
  }

  async function criar(corpo) {
    const d = validar(corpo);
    try {
      const [c] = await sql(`insert into cupons (codigo, tipo, valor, validade, max_usos) values ($1, $2, $3, $4, $5) returning *`,
        [d.codigo, d.tipo, d.valor, d.validade, d.max_usos]);
      return publico(c);
    } catch (e) {
      if (String(e.code) === "23505" || /duplicate|unique/i.test(e.message)) throw new ErroHttp(409, "Já existe um cupom com esse código.", { codigo: "Já existe um cupom com esse código." });
      throw e;
    }
  }

  async function editar(id, corpo) {
    const d = validar(corpo, { parcial: true });
    delete d.codigo; delete d.tipo; // código e tipo não mudam (quem já recebeu o cupom continua usando o mesmo)
    const chaves = Object.keys(d);
    if (!chaves.length) throw new ErroHttp(422, "Nada para mudar.");
    const sets = chaves.map((k, i) => `${k} = $${i + 2}`).join(", ");
    const [c] = await sql(`update cupons set ${sets} where id = $1 and indicacao_de is null returning *`, [id, ...chaves.map((k) => d[k])]).catch(() => []);
    if (!c) throw new ErroHttp(404, "Cupom não encontrado.");
    return publico(c);
  }

  async function excluir(id) {
    const [c] = await sql("delete from cupons where id = $1 and indicacao_de is null and usos = 0 returning codigo", [id]).catch(() => []);
    if (!c) throw new ErroHttp(409, "Cupom já usado não pode ser apagado: desligue-o.");
    return { ok: true };
  }

  /** Confere o cupom para um valor (sem reservar): o que a vendedora vê antes de cadastrar. */
  async function conferir(codigoDigitado, valorCentavos) {
    const codigo = normalizarCodigo(codigoDigitado);
    const erro = (msg) => new ErroHttp(422, msg, { cupom: msg });
    if (!CODIGO.test(codigo)) throw erro("Cupom inválido.");
    const [c] = await sql(`select *, validade < ${HOJE} as vencido from cupons where codigo = $1`, [codigo]);
    if (!c || !c.ativo) throw erro("Cupom não encontrado ou desligado.");
    if (c.vencido) throw erro("Este cupom venceu.");
    if (c.max_usos !== null && c.usos >= c.max_usos) throw erro("Este cupom já foi usado o máximo de vezes.");
    const desconto = descontoDe(c, valorCentavos);
    return { codigo, descricao: descricaoDe(c), desconto_centavos: desconto, valor_final: valorCentavos - desconto, indicacao_de: c.indicacao_de ?? null };
  }

  /** Reserva um uso (de uma vez só, para dois cadastros ao mesmo tempo não passarem do limite). */
  async function reservar(codigo) {
    const [c] = await sql(`update cupons set usos = usos + 1 where codigo = $1 and ativo and (validade is null or validade >= ${HOJE})
      and (max_usos is null or usos < max_usos) returning *`, [codigo]);
    if (!c) throw new ErroHttp(422, "Este cupom acabou de esgotar ou vencer.", { cupom: "Cupom esgotado ou vencido." });
    return c;
  }
  const liberar = (codigo) => sql("update cupons set usos = greatest(usos - 1, 0) where codigo = $1", [codigo]);

  /** O código de indicação da cliente (criado na primeira vez, a partir do nome da loja). */
  async function codigoDeIndicacao(cliente) {
    const [ja] = await sql("select * from cupons where indicacao_de = $1", [cliente.id]);
    if (ja) return ja;
    const cfg = await lerIndicacao();
    const base = normalizarCodigo(cliente.nome_loja).replace(/[^A-Z0-9]/g, "").slice(0, 12) || "INDICA";
    for (let i = 0; i < 6; i++) {
      const extra = i === 0 ? "" : `-${Array.from(randomBytes(3), (b) => LETRAS[b % LETRAS.length]).join("")}`;
      const codigo = (base.length < 3 ? `${base}XYZ` : base) + extra;
      try {
        const [c] = await sql(`insert into cupons (codigo, tipo, valor, indicacao_de, ativo) values ($1, 'percentual', $2, $3, $4) returning *`,
          [codigo, Math.max(cfg.desconto_pct, 1), cliente.id, cfg.desconto_pct > 0]);
        return c;
      } catch (e) { if (!(String(e.code) === "23505" || /duplicate|unique/i.test(e.message))) throw e; }
    }
    throw new ErroHttp(409, "Não consegui criar o código agora. Tente de novo.");
  }

  return { lerIndicacao, salvarIndicacao, listar, criar, editar, excluir, conferir, reservar, liberar, codigoDeIndicacao, publico };
}
