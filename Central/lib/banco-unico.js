/* ==========================================================
   BANCO ÚNICO — todas as lojas num projeto Supabase só (migração 24).
   • Preparado uma vez, por etapas (cada chamada faz um pedaço, para
     caber no tempo de uma requisição): o projeto "Forminha · Lojas",
     as tabelas, e os DOIS sites que servem todas as lojas (a loja e o
     painel, com MULTILOJA=1 — a loja vem do endereço aberto).
   • Depois disso, loja nova = uma linha em `lojas`: fica pronta em
     segundos, sem limite de projetos do Supabase.
   • `naLoja(id)`: o SQL roda como o papel das funções (forminha_app) e
     dentro da loja (forminha.loja) — as travas do banco garantem que
     nada de outra loja aparece nem muda.
   Guardado na Central (configuracoes 'banco_unico').
   ========================================================== */
import { aplicarProxima, situacao } from "./banco.js";
import { senhaAleatoria } from "./codigo.js";
import { ErroHttp } from "./erros.js";

export const NOME_DO_PROJETO = "Forminha · Lojas";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Um valor JavaScript como literal de SQL (texto entre aspas simples, com as aspas dobradas). */
export function literal(v) {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") { if (!Number.isFinite(v)) throw new Error("número inválido"); return String(v); }
  if (typeof v === "boolean") return v ? "true" : "false";
  const texto = typeof v === "string" ? v : JSON.stringify(v);
  if (texto.includes("\u0000")) throw new Error("texto inválido");
  return `'${texto.replace(/'/g, "''")}'`;
}

/** Troca $1, $2… pelos valores (do maior para o menor, para $10 não virar "$1" + "0"). */
export function comParametros(texto, params = []) {
  let sql = String(texto);
  for (let i = params.length; i >= 1; i--) sql = sql.replace(new RegExp(`\\$${i}(?!\\d)`, "g"), literal(params[i - 1]));
  return sql;
}

/**
 * Nome curto para o código dos pedidos: as iniciais das palavras (sem "da", "de", "do"…), até 3 letras.
 * "Doce da Bia" -> "DB"; "Ana" -> "AN".
 */
export function prefixoDosPedidos(nome) {
  const palavras = String(nome ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase()
    .split(/[^A-Z]+/).filter((p) => p && !["DA", "DE", "DO", "DAS", "DOS", "E"].includes(p));
  if (!palavras.length) return "P";
  const iniciais = palavras.map((p) => p[0]).join("").slice(0, 3);
  return iniciais.length >= 2 ? iniciais : palavras[0].slice(0, 2);
}

/**
 * lerConfig/gravarConfig: onde a Central guarda o estado (o banco dela).
 * site: { repoLoja, repoPainel, pastaLoja, pastaPainel, urlCentral() }.
 */
export function criarBancoUnico({ sb, vc, org, lerConfig, gravarConfig, site }) {
  let cache = null;
  const ler = async () => { if (!cache || Date.now() - cache.lido > 15_000) cache = { valor: (await lerConfig()) ?? null, lido: Date.now() }; return cache.valor; };
  const gravar = async (v) => { await gravarConfig(v); cache = { valor: v, lido: Date.now() }; return v; };
  const esquecer = () => { cache = null; };

  /** O SQL do projeto inteiro (migrações, a lista de lojas), como dono do banco. */
  const sqlBanco = async (texto, params) => {
    const c = await ler();
    if (!c?.ref) throw new ErroHttp(409, "O banco único ainda não foi preparado.");
    return sb.sql(c.ref, texto, params);
  };

  /** O SQL DENTRO de uma loja: papel das funções + a loja da vez (as travas de loja valem). */
  function naLoja(id) {
    if (!UUID.test(String(id))) throw new Error("loja inválida");
    return async (texto, params) => {
      const c = await ler();
      return sb.sql(c.ref, `select set_config('forminha.loja', '${id}', true);\nset local role forminha_app;\n${comParametros(texto, params)}`);
    };
  }

  async function pronto() {
    const c = await ler();
    return c?.etapa === "pronto" ? c : null;
  }

  /** Situação para a tela de Configurações. */
  async function estado() {
    const c = await ler();
    if (!c) return { etapa: "nao_preparado" };
    const r = { etapa: c.etapa, ref: c.ref ?? null, loja: c.loja?.url ?? null, painel: c.painel?.url ?? null, pronto_em: c.pronto_em ?? null };
    if (c.etapa === "tabelas" || c.etapa === "pronto") {
      try { const s = await situacao({ sql: sqlBanco, sqlBanco }); Object.assign(r, { feitas: s.feitas, total: s.total, atualizar: s.pendentes.length > 0 }); }
      catch { /* o banco pode estar pausado */ }
    }
    return r;
  }

  async function criarSite({ nome, repo, pasta, variaveis }) {
    for (const tentativa of [nome, `${nome}-${senhaAleatoria().replace(/[^a-z0-9]/gi, "").slice(0, 5).toLowerCase()}`]) {
      try { const p = await vc.criarProjeto({ nome: tentativa, repo, pasta, variaveis }); return { id: p.id, nome: p.name ?? tentativa }; }
      catch (e) { if (e.status !== 409 || tentativa !== nome) throw e; }
    }
  }
  async function enderecoDoSite(s) {
    const lista = await vc.enderecos(s.id).catch(() => []);
    const vercelApp = lista.filter((d) => d.endsWith(".vercel.app")).sort((a, b) => a.length - b.length)[0];
    return `https://${vercelApp ?? `${s.nome}.vercel.app`}`;
  }

  /**
   * Um passo da preparação (a tela chama de novo até ficar "pronto"):
   * projeto -> aguardar o banco -> tabelas (uma migração por vez) -> os 2 sites -> login -> pronto.
   * Também serve para ATUALIZAR as tabelas depois (migrações novas).
   */
  async function preparar() {
    let c = await ler();
    if (!c) {
      const p = await sb.criarProjeto({ nome: NOME_DO_PROJETO, org, senhaBanco: senhaAleatoria() });
      c = await gravar({ ref: p.ref ?? p.id, etapa: "aguardar", criado_em: new Date().toISOString() });
      return estado();
    }
    if (c.etapa === "aguardar") {
      const p = await sb.projeto(c.ref);
      if (p.status !== "ACTIVE_HEALTHY") return { ...(await estado()), status: p.status };
      c = await gravar({ ...c, etapa: "tabelas" });
    }
    if (c.etapa === "tabelas" || c.etapa === "pronto") {
      const r = await aplicarProxima({ sql: sqlBanco, sqlBanco });
      if (r.aplicada) return { ...(await estado()), aplicada: r.aplicada.nome };
      if (c.etapa === "pronto") return estado();
      // o banco novo nasce com a loja "principal" (dos bancos de uma loja só): aqui ela não serve
      await sqlBanco("delete from public.lojas l where l.codigo = 'principal' and not exists (select 1 from public.perfis p where p.loja_id = l.id)");
      c = await gravar({ ...c, etapa: "sites" });
    }
    if (c.etapa === "sites") {
      const supabaseUrl = `https://${c.ref}.supabase.co`;
      const chave = await sb.chavePublica(c.ref);
      const comuns = { SUPABASE_URL: supabaseUrl, SUPABASE_ANON_KEY: chave, MULTILOJA: "1" };
      if (!c.loja?.id) {
        const s = await criarSite({ nome: "forminha-lojas", repo: site.repoLoja, pasta: site.pastaLoja, variaveis: comuns });
        await vc.publicar({ projetoId: s.id, nome: s.nome, repo: site.repoLoja });
        c = await gravar({ ...c, loja: { ...s, url: await enderecoDoSite(s) } });
      }
      if (!c.painel?.id) {
        const central = site.urlCentral();
        const s = await criarSite({ nome: "forminha-paineis", repo: site.repoPainel, pasta: site.pastaPainel, variaveis: { ...comuns, ...(central && { URL_CENTRAL: central }) } });
        await vc.publicar({ projetoId: s.id, nome: s.nome, repo: site.repoPainel });
        c = await gravar({ ...c, painel: { ...s, url: await enderecoDoSite(s) } });
      }
      c = await gravar({ ...c, etapa: "login" });
    }
    if (c.etapa === "login") {
      // login das clientes de todas as lojas: sem SMTP próprio, a conta já nasce confirmada; os endereços de volta
      // de cada loja entram quando ela ganha endereço (lojas.js)
      await sb.configurarLogin(c.ref, {
        site_url: c.loja.url, uri_allow_list: "", external_email_enabled: true, mailer_autoconfirm: true,
        password_min_length: 8, password_required_characters: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789",
      });
      c = await gravar({ ...c, etapa: "pronto", pronto_em: new Date().toISOString() });
    }
    return estado();
  }

  return { ler, esquecer, pronto, estado, preparar, sqlBanco, naLoja };
}
