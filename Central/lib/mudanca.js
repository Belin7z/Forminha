/* ==========================================================
   MUDANÇA PARA O BANCO ÚNICO — traz uma loja que tinha projeto
   próprio no Supabase (e 2 sites próprios) para o banco único, sem
   perder nada: pedidos, clientes, cardápio, estoque, os logins (com
   as MESMAS senhas), as fotos e os endereços (os de sempre continuam
   abrindo a loja).
   Por etapas (cada chamada faz um pedaço; a tela chama de novo):
     1. preparar  — pausa os pedidos da loja antiga ("atualizando"),
                    cria a loja no banco único, traz os logins e
                    reserva os números (ids) dela;
     2. dados     — uma tabela por vez, com os números novos (as
                    ligações acompanham) e as fotos apontando para a
                    pasta da loja;
     3. fotos     — copia os arquivos, poucos por vez;
     4. enderecos — apaga os 2 sites antigos e liga os MESMOS
                    endereços nos sites do banco único; religa os
                    pedidos.
   O banco antigo fica guardado (a Central mostra "pode excluir").
   O pagamento online e o WhatsApp precisam ser conectados de novo:
   as chaves ficavam nos segredos do projeto antigo, que não se leem.
   O andamento fica na ficha da loja ANTIGA (migracao).
   ========================================================== */
import { comParametros } from "./banco-unico.js";
import { gravarFicha, noProjeto, situacao } from "./banco.js";
import { enderecosDoDominio, enderecosNaForminha } from "./dominios.js";
import { ErroHttp } from "./erros.js";

// tabelas que não vêm: as das lojas, os limites de acesso (passageiros) e os segredos (a loja antiga não usa)
const FORA = ["lojas", "loja_enderecos", "limites", "loja_segredos", "forminha_servidor"];
const MIGRANDO = "select set_config('forminha.migrando', '1', true);";
const TEMPO_POR_CHAMADA = 20_000;
const FOTOS_POR_CHAMADA = 20;
const hostDe = (url) => { try { return new URL(url).host; } catch { return null; } };

/**
 * sb, vc, unico: como em lojas.js. f: ferramentas de lojas.js (bd, doBancoUnico, ligarEndereco, aplicarEnderecos,
 * siteDoEndereco, semDominioNoSite, enderecoLoja, enderecoPainel). aoMudar(refAntigo, loja, enderecos): a Central
 * acompanha no cadastro da cliente.
 */
export function criarMudanca({ sb, vc, unico, fetchFn = fetch, f, aoMudar = async () => {} }) {
  const velho = (loja) => noProjeto(sb, loja.ref);
  const lerEstado = async (loja) => (await situacao(velho(loja))).ficha?.migracao ?? null;
  const gravarEstado = (loja, migracao) => gravarFicha(velho(loja), { migracao });
  /** Vários comandos de uma vez no banco único (com os valores já no texto: a API só aceita parâmetros com um comando). */
  const lote = (texto, params) => unico.sqlBanco(comParametros(texto, params));

  /* ---------- o que muda em cada coluna ---------- */
  /** Para cada tabela: as colunas, as que são número próprio (identity), e o que fazer com cada coluna ao copiar. */
  async function esquema() {
    const colunas = await unico.sqlBanco(`select table_name t, column_name c, is_identity = 'YES' as identidade
      from information_schema.columns where table_schema = 'public' and is_generated = 'NEVER' order by table_name, ordinal_position`);
    const ligacoes = await unico.sqlBanco(`select filha.relname f, pai.relname p, pn.nspname pe,
        (select array_agg(a.attname::text order by k.o) from unnest(c.conkey) with ordinality k(n, o) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.n) cf,
        (select array_agg(a.attname::text order by k.o) from unnest(c.confkey) with ordinality k(n, o) join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.n) cp
      from pg_constraint c join pg_class filha on filha.oid = c.conrelid join pg_class pai on pai.oid = c.confrelid join pg_namespace pn on pn.oid = pai.relnamespace
      where c.contype = 'f' and filha.relnamespace = 'public'::regnamespace`);
    const tabelas = {};
    for (const x of colunas) {
      if (FORA.includes(x.t)) continue;
      (tabelas[x.t] ??= { colunas: [], identidade: null, ref: {} }).colunas.push(x.c);
      if (x.identidade) tabelas[x.t].identidade = x.c;
    }
    for (const t of Object.keys(tabelas)) if (!tabelas[t].colunas.includes("loja_id")) delete tabelas[t];
    // de onde vem cada coluna ligada: (tabela, coluna) -> (tabela pai, coluna pai); a conta de login -> "usuario"
    const pai = {};
    for (const l of ligacoes) {
      l.cf.forEach((col, i) => {
        if (col === "loja_id") return;
        pai[`${l.f}.${col}`] = l.pe === "auth" ? "usuario" : `${l.p}.${l.cp[i]}`;
      });
    }
    const resolver = (t, c, visto = new Set()) => {
      if (tabelas[t]?.identidade === c) return `numero:${t}`;
      const p = pai[`${t}.${c}`];
      if (!p) return null;
      if (p === "usuario") return "usuario";
      if (visto.has(p)) return null;
      visto.add(p);
      const [pt, pc] = p.split(".");
      return resolver(pt, pc, visto);
    };
    for (const [t, info] of Object.entries(tabelas)) {
      for (const c of info.colunas) { const r = resolver(t, c); if (r) info.ref[c] = r; }
    }
    // ordem: quem é apontado vem antes de quem aponta
    const ordem = [];
    const deps = (t) => [...new Set(ligacoes.filter((l) => l.f === t && tabelas[l.p] && l.p !== t).map((l) => l.p))];
    const visitar = (t, caminho = new Set()) => {
      if (ordem.includes(t) || caminho.has(t)) return;
      caminho.add(t);
      for (const d of deps(t)) visitar(d, caminho);
      ordem.push(t);
    };
    for (const t of Object.keys(tabelas).sort()) visitar(t);
    return { tabelas, ordem };
  }

  /* ---------- 1. preparar ---------- */
  async function preparar(loja, codigoDigitado) {
    if (String(codigoDigitado ?? "").trim() !== loja.codigo) {
      throw new ErroHttp(422, "Digite o código da loja exatamente como aparece para confirmar.", { codigo: "O código não confere." });
    }
    const c = await unico.pronto();
    if (!c) throw new ErroHttp(409, "Prepare o banco único antes (Configurações → Banco único das lojas).");
    if (!c.funcoes_versao) throw new ErroHttp(409, "Atualize o banco único antes (Configurações → Banco único das lojas).");
    if (loja.status !== "ACTIVE_HEALTHY") throw new ErroHttp(409, "A loja está pausada. Reative antes de mudar.");
    const s = await situacao(velho(loja));
    if (!s.ficha?.loja?.id || !s.ficha?.painel?.id) throw new ErroHttp(409, "Esta loja ainda não foi publicada.");
    if (s.pendentes.length) throw new ErroHttp(409, "Atualize o banco desta loja antes (botão Atualizar banco).");
    if ((await situacao({ sql: unico.sqlBanco, sqlBanco: unico.sqlBanco })).pendentes.length) {
      throw new ErroHttp(409, "Atualize as tabelas do banco único antes (Configurações → Banco único das lojas).");
    }
    const antigo = s.ficha.migracao;

    // os pedidos da loja antiga param enquanto os dados mudam de casa (nada entra no meio da cópia)
    const [ped] = await sb.sql(loja.ref, "select valor from public.configuracoes where chave = 'pedidos'");
    const pedidos = typeof ped?.valor === "string" ? JSON.parse(ped.valor) : ped?.valor ?? {};
    const pausaAntes = antigo?.pausa_antes ?? { pausados: Boolean(pedidos.pausados), mensagem_pausa: pedidos.mensagem_pausa ?? "" };
    await sb.sql(loja.ref, "update public.configuracoes set valor = valor || $1::jsonb where chave = 'pedidos'",
      [JSON.stringify({ pausados: true, mensagem_pausa: "Estamos atualizando a loja. Volte em alguns minutos!" })]);

    // a loja no banco único (se uma tentativa anterior parou no meio, começa do zero: apagar a loja leva junto tudo dela)
    await unico.sqlBanco("delete from public.lojas where codigo = $1", [loja.codigo]);
    const [principal] = await sb.sql(loja.ref, "select nome, prefixo_pedido, ultimo_pedido from public.lojas order by criada_em limit 1");
    const [nova] = await unico.sqlBanco(`insert into public.lojas (codigo, nome, prefixo_pedido, ultimo_pedido) values ($1, $2, $3, $4) returning id`,
      [loja.codigo, loja.nome, principal?.prefixo_pedido ?? "LA", Number(principal?.ultimo_pedido ?? 1000)]);

    // os logins: quem já tem conta no banco único (mesmo e-mail) usa a de lá; os outros vêm com a mesma senha
    const [{ u: usuariosVelhos }] = await sb.sql(loja.ref, "select coalesce(jsonb_agg(to_jsonb(u)), '[]'::jsonb) as u from auth.users u");
    const lista = typeof usuariosVelhos === "string" ? JSON.parse(usuariosVelhos) : usuariosVelhos;
    const existentes = lista.length ? await unico.sqlBanco(`select id::text id, lower(email) email from auth.users
      where lower(email) in (select lower(x) from jsonb_array_elements_text($1::jsonb) x) or id::text in (select x from jsonb_array_elements_text($2::jsonb) x)`,
      [JSON.stringify(lista.map((u) => u.email ?? "")), JSON.stringify(lista.map((u) => u.id))]) : [];
    const usuarios = {};
    const novos = [];
    for (const u of lista) {
      const mesmo = existentes.find((e) => e.email && e.email === String(u.email ?? "").toLowerCase());
      if (mesmo) { usuarios[u.id] = mesmo.id; continue; }
      const idOcupado = existentes.some((e) => e.id === u.id);
      const id = idOcupado ? crypto.randomUUID() : u.id;
      usuarios[u.id] = id;
      novos.push({ ...u, id });
    }
    if (novos.length) {
      const cols = (await unico.sqlBanco(`select column_name c from information_schema.columns
        where table_schema = 'auth' and table_name = 'users' and is_generated = 'NEVER' and is_identity = 'NO'`)).map((x) => `"${x.c}"`).join(", ");
      await lote(`${MIGRANDO}\ninsert into auth.users (${cols}) select ${cols} from jsonb_populate_recordset(null::auth.users, $1::jsonb) on conflict do nothing;`, [JSON.stringify(novos)]);
      // a identidade de login por e-mail (o Supabase precisa dela para entrar com senha)
      const [temIdentidades] = await unico.sqlBanco("select to_regclass('auth.identities') is not null as ok");
      const [velhasIdentidades] = temIdentidades?.ok ? await sb.sql(loja.ref, `select to_regclass('auth.identities') is not null as ok`) : [];
      if (velhasIdentidades?.ok) {
        const [{ i }] = await sb.sql(loja.ref, "select coalesce(jsonb_agg(to_jsonb(i)), '[]'::jsonb) as i from auth.identities i");
        const idents = (typeof i === "string" ? JSON.parse(i) : i)
          .filter((x) => novos.some((n) => usuarios[x.user_id] === n.id))
          .map((x) => {
            const id = usuarios[x.user_id];
            return { ...x, user_id: id, ...(x.provider === "email" && x.provider_id === x.user_id && { provider_id: id }),
              identity_data: { ...(x.identity_data ?? {}), ...(x.identity_data?.sub === x.user_id && { sub: id }) } };
          });
        if (idents.length) {
          const colsI = (await unico.sqlBanco(`select column_name c from information_schema.columns
            where table_schema = 'auth' and table_name = 'identities' and is_generated = 'NEVER' and is_identity = 'NO'`)).map((x) => `"${x.c}"`).join(", ");
          await lote(`insert into auth.identities (${colsI}) select ${colsI} from jsonb_populate_recordset(null::auth.identities, $1::jsonb) on conflict do nothing;`, [JSON.stringify(idents)]);
        }
      }
    }

    // os números (ids) da loja no banco único: um bloco reservado por tabela, sem esbarrar nos das outras lojas
    const { tabelas, ordem } = await esquema();
    const comNumero = ordem.filter((t) => tabelas[t].identidade);
    const faixas = comNumero.length ? await sb.sql(loja.ref, comNumero.map((t) =>
      `select '${t}' as t, min("${tabelas[t].identidade}")::bigint as menor, max("${tabelas[t].identidade}")::bigint as maior from public."${t}"`).join(" union all ")) : [];
    const deslocamentos = {};
    for (const x of faixas) {
      if (x.menor === null) continue;
      const n = Number(x.maior) - Number(x.menor) + 1;
      const col = tabelas[x.t].identidade;
      const [r] = await unico.sqlBanco(`select setval(s::regclass, greatest(coalesce(pg_sequence_last_value(s::regclass), 0), (select coalesce(max("${col}"), 0) from public."${x.t}")) + ${n}) - ${n} as inicio
        from (select pg_get_serial_sequence('public."${x.t}"', '${col}') as s) q`);
      deslocamentos[x.t] = Number(r.inicio) + 1 - Number(x.menor);
    }

    const [{ objetos }] = await sb.sql(loja.ref, "select count(*)::int as objetos from storage.objects where bucket_id in ('produtos', 'site')");
    const estado = {
      etapa: "dados", codigo: loja.codigo, loja_id: nova.id, pausa_antes: pausaAntes, usuarios, deslocamentos,
      tabelas: ordem, feitas: 0, fotos: { total: objetos, feitas: 0, falhas: 0 }, iniciada_em: antigo?.iniciada_em ?? new Date().toISOString(),
    };
    await gravarEstado(loja, estado);
    return resumo(estado);
  }

  /* ---------- 2. dados ---------- */
  async function dados(loja, estado) {
    const c = await unico.pronto();
    const { tabelas } = await esquema();
    const inicio = Date.now();
    const velhaBase = `https://${loja.ref}.supabase.co/storage/v1/object/public/`;
    const novaBase = `https://${c.ref}.supabase.co/storage/v1/object/public/`;
    while (estado.feitas < estado.tabelas.length && Date.now() - inicio < TEMPO_POR_CHAMADA) {
      const t = estado.tabelas[estado.feitas];
      const info = tabelas[t];
      if (info) {
        const [{ l }] = await sb.sql(loja.ref, `select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) as l from public."${t}" x`);
        const linhas = (typeof l === "string" ? JSON.parse(l) : l).map((linha) => {
          const nova = { ...linha, loja_id: estado.loja_id };
          for (const [col, ref] of Object.entries(info.ref)) {
            if (nova[col] === null || nova[col] === undefined) continue;
            if (ref === "usuario") nova[col] = estado.usuarios[nova[col]] ?? nova[col];
            else nova[col] = Number(nova[col]) + (estado.deslocamentos[ref.slice(7)] ?? 0);
          }
          return nova;
        });
        if (linhas.length) {
          // as fotos passam a ser as da pasta da loja no banco único (a etapa "fotos" copia os arquivos)
          const texto = JSON.stringify(linhas)
            .replaceAll(`${velhaBase}produtos/`, `${novaBase}produtos/${estado.loja_id}/`)
            .replaceAll(`${velhaBase}site/`, `${novaBase}site/${estado.loja_id}/`);
          const cols = info.colunas.map((x) => `"${x}"`).join(", ");
          await lote(`${MIGRANDO}\ninsert into public."${t}" (${cols}) ${info.identidade ? "overriding system value " : ""}select ${cols} from jsonb_populate_recordset(null::public."${t}", $1::jsonb);`, [texto]);
        }
      }
      estado.feitas += 1;
      await gravarEstado(loja, estado);
    }
    if (estado.feitas >= estado.tabelas.length) {
      estado.etapa = "fotos";
      await gravarEstado(loja, estado);
    }
    return resumo(estado);
  }

  /* ---------- 3. fotos ---------- */
  async function fotos(loja, estado) {
    const c = await unico.pronto();
    const objetos = await sb.sql(loja.ref, `select bucket_id b, name n, coalesce(to_jsonb(o) #>> '{metadata,mimetype}', 'application/octet-stream') tipo
      from storage.objects o where bucket_id in ('produtos', 'site') order by bucket_id, name limit ${FOTOS_POR_CHAMADA} offset ${Number(estado.fotos.feitas)}`);
    if (objetos.length) {
      const segredo = await sb.chaveSecreta(c.ref);
      const cab = { apikey: segredo, "x-upsert": "true", ...(segredo.startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${segredo}` }) };
      for (const o of objetos) {
        const caminho = o.n.split("/").map(encodeURIComponent).join("/");
        try {
          const r = await fetchFn(`https://${loja.ref}.supabase.co/storage/v1/object/public/${o.b}/${caminho}`);
          if (!r.ok) throw new Error(`download ${r.status}`);
          const bytes = new Uint8Array(await r.arrayBuffer());
          const envio = await fetchFn(`https://${c.ref}.supabase.co/storage/v1/object/${o.b}/${estado.loja_id}/${caminho}`, {
            method: "POST", headers: { ...cab, "Content-Type": o.tipo }, body: bytes,
          });
          if (!envio.ok) throw new Error(`envio ${envio.status}`);
        } catch (e) {
          estado.fotos.falhas += 1;
          console.error("[mudança] foto", o.b, o.n, e.message);
        }
        estado.fotos.feitas += 1;
      }
    }
    if (!objetos.length || estado.fotos.feitas >= estado.fotos.total) estado.etapa = "enderecos";
    await gravarEstado(loja, estado);
    return resumo(estado);
  }

  /* ---------- 4. endereços ---------- */
  async function enderecos(loja, estado) {
    const c = await unico.pronto();
    const antiga = (await situacao(velho(loja))).ficha;
    const nova = await f.doBancoUnico(loja.codigo);
    const novoBd = f.bd(nova);

    // os sites antigos saem (isso libera os endereços deles); o banco antigo fica guardado
    for (const site of [antiga.loja, antiga.painel]) {
      if (site?.id && site.id !== c.loja.id && site.id !== c.painel.id) await vc.excluirProjeto(site.id).catch(f.semDominioNoSite);
    }

    const conectados = { pagamento: Boolean(antiga.pagamento_conectado_em), whatsapp: false };
    const [zap] = await novoBd.sql("select 1 as ok from public.configuracoes where chave = 'whatsapp'");
    conectados.whatsapp = Boolean(zap?.ok);
    const { migracao, pagamento_conectado_em, funcoes_versao, ...resto } = antiga;
    const ficha = {
      ...resto,
      loja: { id: c.loja.id, nome: c.loja.nome, url: antiga.loja.url },
      painel: { id: c.painel.id, nome: c.painel.nome, url: antiga.painel.url },
      mudou_de_projeto: { ref: loja.ref, em: new Date().toISOString() },
      ...((conectados.pagamento || conectados.whatsapp) && { reconectar: Object.keys(conectados).filter((k) => conectados[k]) }),
    };
    await novoBd.sql("update public.configuracoes set valor = $1::jsonb where chave = 'forminha'", [JSON.stringify(ficha)]);

    // os MESMOS endereços .vercel.app, agora nos sites de todas as lojas; se a Vercel não devolver, a loja ganha outro
    // (nome-codigo.vercel.app) — o domínio próprio e o endereço na Forminha continuam iguais
    const pares = [[hostDe(antiga.loja.url), hostDe(antiga.painel.url)]];
    const base = `${hostDe(antiga.loja.url).split(".")[0]}-${loja.codigo.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
    pares.push([`${base}.vercel.app`, `${base}-painel.vercel.app`]);
    let ligado = false;
    for (const [hLoja, hPainel] of pares) {
      try {
        await f.ligarEndereco(c.loja, { host: hLoja, site: "loja" }, nova);
        await f.ligarEndereco(c.painel, { host: hPainel, site: "painel" }, nova);
        ficha.loja.url = `https://${hLoja}`;
        ficha.painel.url = `https://${hPainel}`;
        ligado = true;
        break;
      } catch (e) { if (!(e instanceof ErroHttp)) throw e; }
    }
    if (!ligado) throw new ErroHttp(409, "A Vercel ainda está soltando os endereços antigos. Espere 1 minuto e clique em Continuar.");
    const outros = [
      ...(antiga.dominio?.nome ? enderecosDoDominio(antiga.dominio.nome, antiga.dominio) : []),
      ...(antiga.sub ? enderecosNaForminha(antiga.sub.rotulo, antiga.sub.raiz) : []),
    ];
    try {
      for (const e of outros) await f.ligarEndereco(f.siteDoEndereco(ficha, e), e, nova);
    } catch (e) {
      if (e instanceof ErroHttp && e.status === 409) {
        throw new ErroHttp(409, "A Vercel ainda está soltando os endereços antigos. Espere 1 minuto e clique em Continuar.");
      }
      throw e;
    }
    await novoBd.sql("update public.configuracoes set valor = $1::jsonb where chave = 'forminha'", [JSON.stringify(ficha)]);
    await f.aplicarEnderecos(nova, ficha, { publicarPainel: false });

    // pedidos voltam como estavam; pagamento online e WhatsApp desligados até conectar de novo
    await novoBd.sql("update public.configuracoes set valor = valor || $1::jsonb where chave = 'pedidos'", [JSON.stringify(estado.pausa_antes)]);
    await novoBd.sql(`update public.configuracoes set valor = (valor - 'segredo_hash') || '{"ativo": false, "cartao": false}'::jsonb where chave = 'gateway'`);
    await novoBd.sql("delete from public.configuracoes where chave = 'whatsapp'");

    await aoMudar(loja.ref, nova, { loja: f.enderecoLoja(ficha), painel: f.enderecoPainel(ficha) });
    estado.etapa = "pronta";
    estado.pronta_em = new Date().toISOString();
    estado.reconectar = ficha.reconectar ?? [];
    delete estado.usuarios; // não precisa mais (e pesa)
    await gravarEstado(loja, estado);
    return { ...resumo(estado), loja: f.enderecoLoja(ficha), painel: f.enderecoPainel(ficha) };
  }

  function resumo(e) {
    return {
      etapa: e.etapa, codigo: e.codigo, tabelas: { feitas: e.feitas, total: e.tabelas?.length ?? 0 },
      fotos: e.fotos, reconectar: e.reconectar ?? [],
    };
  }

  /** Um passo da mudança (a tela chama de novo até "pronta"). Começar exige o código da loja digitado. */
  async function passo(loja, { codigo } = {}) {
    if (loja.tipo === "unico") throw new ErroHttp(409, "Esta loja já está no banco único.");
    const estado = await lerEstado(loja);
    if (!estado || estado.etapa === "preparar") return preparar(loja, codigo);
    if (estado.etapa === "dados") return dados(loja, estado);
    if (estado.etapa === "fotos") return fotos(loja, estado);
    if (estado.etapa === "enderecos") return enderecos(loja, estado);
    return resumo(estado);
  }

  return { passo };
}
