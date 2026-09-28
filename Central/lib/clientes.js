/* ==========================================================
   CLIENTES DA FORMINHA — cadastro, cobrança, pagamento e suporte.

   Caminho de uma cliente:
     1. cadastrar  -> dados CIFRADOS + cobrança PIX (sua chave; e Mercado
                      Pago, se configurado) + e-mail com a página de pagamento
     2. pagamento  -> você confirma no painel OU o Mercado Pago avisa sozinho
     3. avançar    -> a loja é criada em etapas curtas (criar banco, esperar,
                      tabelas, sites, convite, e-mail). Cada chamada anda o
                      quanto der e deixa o resto para a próxima; uma TRAVA no
                      banco garante que duas chamadas nunca criem duas lojas.
     4. pronta     -> a cliente recebe o link por e-mail e ele aparece no painel.
   ========================================================== */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { EMAIL, ErroHttp } from "./erros.js";
import { gerarCodigo } from "./codigo.js";
import { gerarPix } from "./pix.js";
import { modelos } from "./email.js";
import { mascararEmail } from "./cofre.js";
import { assinaturaValida } from "./mercadopago.js";
import { autorAtual } from "./autoria.js";

const resumo = (t) => createHash("sha256").update(String(t)).digest("hex");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORDEM = ["criar_projeto", "aguardar_banco", "preparar", "publicar", "convite", "email", "pronta"];
const MAX_TENTATIVAS = 6;
const ESPERA_MAXIMA_BANCO_MS = 20 * 60 * 1000;
const dorme = (ms) => new Promise((ok) => setTimeout(ok, ms));

/* ---------- validação ---------- */
const soDigitos = (t) => String(t ?? "").replace(/\D/g, "");
function cpfValido(c) {
  if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  for (const n of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(c[i]) * (n + 1 - i);
    if (((soma * 10) % 11) % 10 !== Number(c[n])) return false;
  }
  return true;
}
function cnpjValido(c) {
  if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false;
  const digito = (n) => { const p = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const r = p.reduce((s, peso, i) => s + Number(c[i]) * peso, 0) % 11; return r < 2 ? 0 : 11 - r; };
  return digito(12) === Number(c[12]) && digito(13) === Number(c[13]);
}
const texto = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max + 1);

/** Confere e limpa os dados da cliente. `parcial` = só os campos enviados (edição). */
export function validarCliente(corpo, { parcial = false } = {}) {
  const d = {}; const campos = {};
  const tem = (k) => !parcial || corpo[k] !== undefined;
  if (tem("nome")) { d.nome = texto(corpo.nome, 120); if (d.nome.length < 2 || d.nome.length > 120) campos.nome = "Nome: de 2 a 120 letras."; }
  if (tem("email")) { d.email = String(corpo.email ?? "").trim().toLowerCase(); if (!EMAIL.test(d.email) || d.email.length > 120) campos.email = "Informe um e-mail válido."; }
  if (tem("telefone")) {
    let t = soDigitos(corpo.telefone);
    if (/^55\d{10,11}$/.test(t)) t = t.slice(2);
    d.telefone = t;
    if (t && (t.length < 10 || t.length > 11)) campos.telefone = "WhatsApp com DDD (10 ou 11 números).";
  }
  if (tem("documento")) {
    d.documento = soDigitos(corpo.documento);
    if (d.documento && !(cpfValido(d.documento) || cnpjValido(d.documento))) campos.documento = "CPF ou CNPJ inválido.";
  }
  if (tem("observacoes")) { d.observacoes = String(corpo.observacoes ?? "").trim(); if (d.observacoes.length > 1000) campos.observacoes = "Observações: até 1.000 letras."; }
  if (tem("nome_loja")) { d.nome_loja = texto(corpo.nome_loja, 60); if (d.nome_loja.length < 2 || d.nome_loja.length > 60) campos.nome_loja = "Nome da loja: de 2 a 60 letras."; }
  if (tem("valor_centavos")) { d.valor_centavos = Math.round(Number(corpo.valor_centavos)); if (!Number.isFinite(d.valor_centavos) || d.valor_centavos < 100 || d.valor_centavos > 10_000_000) campos.valor_centavos = "Valor: de R$ 1,00 a R$ 100.000,00."; }
  if (Object.keys(campos).length) throw new ErroHttp(422, Object.values(campos)[0], campos);
  return d;
}

/* ---------- módulo ---------- */
export function criarClientes({ banco, cofre, lojas, email = null, mp = null, urlBase, segredoInterno = "", fetchFn = fetch, orcamentoMs = 40_000, agendar = null, esperaBancoMs = 4000 }) {
  const sql = (t, p) => banco.consultar(t, p);
  const ctx = (id) => `cliente:${id}`;

  /* configurações da Central (valor padrão da loja e a SUA chave PIX) */
  async function lerConfig() {
    const [linha] = await sql("select valor from configuracoes where chave = 'geral'");
    const v = linha?.valor ?? {};
    return { valor_padrao_centavos: Number(v.valor_padrao_centavos ?? 0), pix: { chave: v.pix?.chave ?? "", nome: v.pix?.nome ?? "", cidade: v.pix?.cidade ?? "" } };
  }
  async function salvarConfig(corpo) {
    const campos = {};
    const valor = Math.round(Number(corpo.valor_padrao_centavos ?? 0));
    if (!Number.isFinite(valor) || valor < 0 || valor > 10_000_000) campos.valor_padrao_centavos = "Valor inválido.";
    const pix = { chave: String(corpo.pix?.chave ?? "").trim(), nome: texto(corpo.pix?.nome, 25), cidade: texto(corpo.pix?.cidade, 15) };
    if (pix.chave.length > 77) campos.pix_chave = "Chave PIX longa demais.";
    if (pix.nome.length > 25) campos.pix_nome = "Nome do recebedor: até 25 letras.";
    if (pix.cidade.length > 15) campos.pix_cidade = "Cidade: até 15 letras.";
    if (pix.chave && (!pix.nome || !pix.cidade)) campos.pix_nome = "Informe o nome e a cidade do recebedor do PIX.";
    if (Object.keys(campos).length) throw new ErroHttp(422, Object.values(campos)[0], campos);
    const valorFinal = { valor_padrao_centavos: valor, pix };
    await sql("insert into configuracoes (chave, valor) values ('geral', $1::jsonb) on conflict (chave) do update set valor = excluded.valor", [JSON.stringify(valorFinal)]);
    return lerConfig();
  }

  // ações de pessoas (não as etapas automáticas da loja nem os e-mails) dizem quem fez
  const COM_AUTOR = new Set(["cadastro", "pagamento", "suporte", "nota"]);
  async function anotarHistorico(clienteId, tipo, mensagem) {
    const autor = COM_AUTOR.has(tipo) ? autorAtual() : null;
    const texto = autor ? `${mensagem} (${autor})` : mensagem;
    await sql("insert into historico (cliente_id, tipo, texto) values ($1, $2, $3)", [clienteId, tipo, cofre.cifrar(texto, `historico:${clienteId}`)]);
  }

  async function linha(id) {
    if (!UUID.test(String(id))) throw new ErroHttp(404, "Cliente não encontrada.");
    const [c] = await sql("select * from clientes where id = $1", [id]);
    if (!c) throw new ErroHttp(404, "Cliente não encontrada.");
    return c;
  }
  const abrir = (c) => cofre.decifrar(c.dados, ctx(c.id), { json: true });

  /* ---------- e-mails (se o Gmail estiver configurado) ---------- */
  async function mandar(c, modelo, dados) {
    if (!email) return false;
    const pessoa = abrir(c);
    const m = modelos[modelo]({ nome: pessoa.nome.split(" ")[0], nomeLoja: c.nome_loja, ...dados });
    await email.enviar({ para: pessoa.email, assunto: m.assunto, texto: m.texto, html: m.html });
    await anotarHistorico(c.id, "email", `E-mail enviado: ${m.assunto}`);
    return true;
  }

  /* ---------- cobrança ---------- */
  async function novaCobranca(c) {
    const cfg = await lerConfig();
    if (!cfg.pix.chave) throw new ErroHttp(409, "Antes de cobrar, informe a sua chave PIX em Configurações.");
    const pessoa = abrir(c);
    await sql("update pagamentos set situacao = 'cancelado' where cliente_id = $1 and situacao = 'pendente'", [c.id]);
    const id = randomUUID();
    const token = randomBytes(24).toString("base64url");
    const link = `${urlBase}/#/pagar/${token}`;
    const pix = gerarPix({ ...cfg.pix, valor: c.valor_centavos, identificador: `FM${id.replace(/-/g, "").slice(0, 20)}` });
    let automatico = null;
    if (mp) {
      try {
        automatico = await mp.criarCobranca({ valorCentavos: c.valor_centavos, descricao: `Loja ${c.nome_loja} - Forminha`, email: pessoa.email, referencia: id, notificacao: `${urlBase}/api/webhook/mercadopago`, chaveUnica: id });
      } catch (e) { await anotarHistorico(c.id, "pagamento", `Mercado Pago indisponível; ficou só o PIX com a sua chave (${e.message}).`); }
    }
    await sql(`insert into pagamentos (id, cliente_id, token_hash, link, valor_centavos, pix_copia_cola, mp_id, mp_copia_cola, mp_qr_base64)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, c.id, resumo(token), cofre.cifrar(link, `pagamento:${id}`), c.valor_centavos, pix, automatico?.id ?? null, automatico?.copiaCola ?? null, automatico?.qrBase64 ?? null]);
    await anotarHistorico(c.id, "pagamento", `Cobrança de ${(c.valor_centavos / 100).toFixed(2).replace(".", ",")} gerada${automatico ? " (PIX automático + manual)" : " (PIX com a sua chave)"}.`);
    return { id, link };
  }

  async function cadastrar(corpo) {
    const cfg = await lerConfig();
    const d = validarCliente({ ...corpo, valor_centavos: corpo.valor_centavos ?? cfg.valor_padrao_centavos });
    if (!cfg.pix.chave) throw new ErroHttp(409, "Antes de cadastrar, informe a sua chave PIX em Configurações.");
    const id = randomUUID();
    const pessoa = { nome: d.nome, email: d.email, telefone: d.telefone ?? "", documento: d.documento ?? "", observacoes: d.observacoes ?? "" };
    try {
      await sql(`insert into clientes (id, dados, email_indice, nome_loja, valor_centavos) values ($1, $2, $3, $4, $5)`,
        [id, cofre.cifrar(pessoa, ctx(id)), cofre.indice(d.email), d.nome_loja, d.valor_centavos]);
    } catch (e) {
      if (String(e.code) === "23505" || /duplicate|unique/i.test(e.message)) throw new ErroHttp(409, "Já existe uma cliente com esse e-mail.", { email: "Já existe uma cliente com esse e-mail." });
      throw e;
    }
    await anotarHistorico(id, "cadastro", "Cliente cadastrada.");
    const c = await linha(id);
    const cobranca = await novaCobranca(c);
    const enviado = await mandar(c, "cobranca", { valorCentavos: c.valor_centavos, link: cobranca.link }).catch(async (e) => {
      await anotarHistorico(id, "email", `Falha ao enviar o e-mail de cobrança: ${e.message}`); return false;
    });
    return { ...(await detalhe(id)), link_pagamento: cobranca.link, email_enviado: enviado };
  }

  /* ---------- leitura ---------- */
  function publico(c, pessoa = abrir(c)) {
    return {
      id: c.id, criado_em: c.criado_em, nome: pessoa.nome, email: pessoa.email, telefone: pessoa.telefone, documento: pessoa.documento,
      observacoes: pessoa.observacoes, nome_loja: c.nome_loja, valor_centavos: c.valor_centavos, situacao: c.situacao, etapa: c.etapa,
      etapa_erro: c.tentativas >= MAX_TENTATIVAS ? c.etapa_erro : null, parada: c.tentativas >= MAX_TENTATIVAS,
      loja_ref: c.loja_ref, loja_codigo: c.loja_codigo, loja_url: c.loja_url, painel_url: c.painel_url,
      convite: c.convite ? cofre.decifrar(c.convite, ctx(c.id)) : null, convite_em: c.convite_em, email_boas_vindas_em: c.email_boas_vindas_em,
    };
  }

  async function listar() {
    const linhas = await sql("select * from clientes order by criado_em desc");
    return linhas.map((c) => {
      try { const p = publico(c); return { id: p.id, criado_em: p.criado_em, nome: p.nome, email: p.email, telefone: p.telefone, nome_loja: p.nome_loja, valor_centavos: p.valor_centavos, situacao: p.situacao, etapa: p.etapa, parada: p.parada, loja_url: p.loja_url }; }
      catch { return { id: c.id, criado_em: c.criado_em, nome: "(não foi possível abrir)", nome_loja: c.nome_loja, situacao: c.situacao, etapa: c.etapa, ilegivel: true }; }
    });
  }

  async function detalhe(id) {
    const c = await linha(id);
    const pagamentos = (await sql("select * from pagamentos where cliente_id = $1 order by criado_em desc", [id])).map((p) => ({
      id: p.id, criado_em: p.criado_em, valor_centavos: p.valor_centavos, situacao: p.situacao, automatico: Boolean(p.mp_id),
      link: cofre.decifrar(p.link, `pagamento:${p.id}`), pix_copia_cola: p.pix_copia_cola, confirmado_em: p.confirmado_em, confirmado_por: p.confirmado_por,
    }));
    const historico = (await sql("select id, quando, tipo, texto from historico where cliente_id = $1 order by id desc limit 60", [id]))
      .map((h) => ({ id: h.id, quando: h.quando, tipo: h.tipo, texto: (() => { try { return cofre.decifrar(h.texto, `historico:${id}`); } catch { return "(não foi possível abrir)"; } })() }));
    return { cliente: publico(c), pagamentos, historico, email_configurado: Boolean(email) };
  }

  async function atualizar(id, corpo) {
    const c = await linha(id);
    const d = validarCliente(corpo, { parcial: true });
    const pessoa = { ...abrir(c) };
    for (const k of ["nome", "email", "telefone", "documento", "observacoes"]) if (d[k] !== undefined) pessoa[k] = d[k];
    if (d.nome_loja !== undefined && c.loja_ref) throw new ErroHttp(409, "A loja já foi criada: o nome dela agora é trocado pela própria dona, no painel.");
    if (d.valor_centavos !== undefined && c.situacao !== "aguardando_pagamento") throw new ErroHttp(409, "O pagamento já foi feito: o valor não muda mais.");
    try {
      await sql(`update clientes set dados = $2, email_indice = $3, nome_loja = coalesce($4, nome_loja), valor_centavos = coalesce($5, valor_centavos), atualizado_em = now() where id = $1`,
        [id, cofre.cifrar(pessoa, ctx(id)), cofre.indice(pessoa.email), d.nome_loja ?? null, d.valor_centavos ?? null]);
    } catch (e) {
      if (String(e.code) === "23505" || /duplicate|unique/i.test(e.message)) throw new ErroHttp(409, "Já existe uma cliente com esse e-mail.", { email: "Já existe uma cliente com esse e-mail." });
      throw e;
    }
    await anotarHistorico(id, "suporte", "Dados da cliente atualizados.");
    if (d.valor_centavos !== undefined) await novaCobranca(await linha(id));
    return detalhe(id);
  }

  async function anotar(id, corpo) {
    await linha(id);
    const t = String(corpo.texto ?? "").trim();
    if (!t || t.length > 2000) throw new ErroHttp(422, "Escreva a nota (até 2.000 letras).", { texto: "Escreva a nota." });
    await anotarHistorico(id, "nota", t);
    return detalhe(id);
  }

  /* ---------- pagamento ---------- */
  async function confirmarPagamento(pagamentoId, por) {
    if (!UUID.test(String(pagamentoId))) throw new ErroHttp(404, "Pagamento não encontrado.");
    const [p] = await sql(`update pagamentos set situacao = 'aprovado', confirmado_em = now(), confirmado_por = $2
      where id = $1 and situacao = 'pendente' returning *`, [pagamentoId, por]);
    if (!p) {
      const [atual] = await sql("select * from pagamentos where id = $1", [pagamentoId]);
      if (!atual) throw new ErroHttp(404, "Pagamento não encontrado.");
      if (atual.situacao === "aprovado") return { cliente_id: atual.cliente_id, ja_estava: true }; // aviso repetido: não conta duas vezes
      throw new ErroHttp(409, "Esta cobrança foi cancelada (há uma mais nova).");
    }
    await sql(`update clientes set situacao = 'pago', etapa = 'criar_projeto', tentativas = 0, etapa_erro = null, atualizado_em = now()
      where id = $1 and situacao = 'aguardando_pagamento'`, [p.cliente_id]);
    await anotarHistorico(p.cliente_id, "pagamento", `Pagamento de ${(p.valor_centavos / 100).toFixed(2).replace(".", ",")} confirmado ${por === "mercado_pago" ? "pelo Mercado Pago" : "manualmente"}.`);
    return { cliente_id: p.cliente_id, ja_estava: false };
  }

  async function confirmarManual(id, corpo) {
    const c = await linha(id);
    const [p] = corpo.pagamento_id ? [{ id: corpo.pagamento_id }] : await sql("select id from pagamentos where cliente_id = $1 and situacao = 'pendente' order by criado_em desc limit 1", [id]);
    if (!p) throw new ErroHttp(409, c.situacao === "pago" ? "O pagamento já está confirmado." : "Não há cobrança pendente.");
    const r = await confirmarPagamento(p.id, autorAtual() ?? "admin"); // quem confirmou fica guardado no pagamento
    if (r.cliente_id !== id) throw new ErroHttp(404, "Pagamento não encontrado.");
    await avancar(id, { orcamento: Math.min(orcamentoMs, 20_000) }); // cria o banco já e pede para outra execução seguir
    return detalhe(id);
  }

  /** Aviso do Mercado Pago: confere a assinatura (se configurada) e CONSULTA o pagamento na API antes de aceitar. */
  async function receberAvisoMercadoPago({ url, corpo, cabecalhos, segredoAssinatura }) {
    if (!mp) return { ignorado: true };
    const tipo = url.searchParams.get("type") ?? corpo?.type ?? url.searchParams.get("topic");
    const dataId = String(url.searchParams.get("data.id") ?? corpo?.data?.id ?? "");
    if (tipo !== "payment" || !dataId) return { ignorado: true };
    if (segredoAssinatura && !assinaturaValida({ cabecalhos, dataId, segredo: segredoAssinatura })) throw new ErroHttp(401, "Assinatura inválida.");
    const pag = await mp.consultar(dataId);
    if (!pag || pag.status !== "approved" || pag.payment_method_id !== "pix") return { ignorado: true, estado: pag?.status ?? "desconhecido" };
    const referencia = String(pag.external_reference ?? "");
    if (!UUID.test(referencia)) return { ignorado: true };
    const [p] = await sql("select * from pagamentos where id = $1", [referencia]);
    if (!p || p.mp_id !== String(pag.id)) return { ignorado: true }; // cobrança que não é desta Central
    if (Math.round(Number(pag.transaction_amount) * 100) < p.valor_centavos) {
      await anotarHistorico(p.cliente_id, "pagamento", `Mercado Pago avisou um valor menor que o cobrado (${pag.transaction_amount}). Confira antes de liberar.`);
      return { ignorado: true };
    }
    const r = await confirmarPagamento(p.id, "mercado_pago");
    if (!r.ja_estava) continuar(r.cliente_id);
    return { ok: true };
  }

  /* ---------- criação automática da loja ---------- */
  /** Pede para outra execução continuar a criação (a função da Vercel tem tempo limitado). */
  function continuar(id) {
    if (agendar) return agendar(id);
    if (!segredoInterno || !urlBase) return;
    fetchFn(`${urlBase}/api/interno/avancar`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${segredoInterno}` }, body: JSON.stringify({ id }),
      signal: AbortSignal.timeout(2500),
    }).catch(() => {}); // quem chama não espera: a outra execução segue sozinha
  }

  /** Um passo da criação. `limite` = até quando esta chamada pode trabalhar (sempre faz pelo menos uma ação). */
  async function passo(c, limite) {
    const pessoa = abrir(c);
    const mudar = async (campos) => {
      const chaves = Object.keys(campos);
      const sets = chaves.map((k, i) => `${k} = $${i + 2}`).join(", ");
      const [nova] = await sql(`update clientes set ${sets}, atualizado_em = now(), tentativas = 0, etapa_erro = null where id = $1 returning *`, [c.id, ...chaves.map((k) => campos[k])]);
      return nova;
    };
    switch (c.etapa) {
      case "criar_projeto": {
        // o código é guardado ANTES de criar: se cair no meio, a próxima chamada acha o banco em vez de criar outro
        let codigo = c.loja_codigo;
        if (!codigo) { codigo = gerarCodigo(); c = await mudar({ loja_codigo: codigo }); }
        const existente = c.loja_ref ? { ref: c.loja_ref } : await lojas.porCodigo(codigo);
        const ref = existente?.ref ?? (await lojas.criar(c.nome_loja, codigo)).ref;
        await anotarHistorico(c.id, "loja", `Banco da loja criado (código ${codigo}).`);
        return mudar({ loja_ref: ref, etapa: "aguardar_banco" });
      }
      case "aguardar_banco": {
        for (let i = 0; i < 5; i++) {
          const loja = await lojas.porRef(c.loja_ref);
          if (loja.status === "ACTIVE_HEALTHY") return mudar({ etapa: "preparar" });
          if (["INIT_FAILED", "REMOVED"].includes(loja.status)) throw new Error(`o Supabase não conseguiu criar o banco (${loja.status})`);
          if (Date.now() - new Date(c.atualizado_em).getTime() > ESPERA_MAXIMA_BANCO_MS) throw new Error("o banco está demorando demais para ficar pronto");
          if (Date.now() + esperaBancoMs > limite) break;
          await dorme(esperaBancoMs);
        }
        return c; // ainda criando: a próxima chamada continua esperando
      }
      case "preparar": {
        const loja = await lojas.porRef(c.loja_ref);
        const inicio = Date.now();
        let r;
        do { r = await lojas.prepararPasso(loja, pessoa.email); } while (r.etapa === "tabelas" && Date.now() < limite && Date.now() - inicio < 25_000);
        return r.etapa === "tabelas" ? c : mudar({ etapa: "publicar" });
      }
      case "publicar": {
        const r = await lojas.publicar(await lojas.porRef(c.loja_ref));
        await anotarHistorico(c.id, "loja", `Loja publicada: ${r.loja}`);
        return mudar({ loja_url: r.loja, painel_url: r.painel, etapa: "convite" });
      }
      case "convite": {
        const r = await lojas.convite(await lojas.porRef(c.loja_ref), pessoa.email);
        return mudar({ convite: cofre.cifrar(r.link, ctx(c.id)), convite_em: new Date().toISOString(), etapa: "email" });
      }
      case "email": {
        const convite = cofre.decifrar(c.convite, ctx(c.id));
        const enviado = await mandar(c, "boasVindas", { convite, loja: c.loja_url });
        if (!enviado) await anotarHistorico(c.id, "email", "E-mail não configurado: envie o link do convite pelo painel.");
        await anotarHistorico(c.id, "loja", "Loja pronta.");
        return mudar({ etapa: "pronta", email_boas_vindas_em: enviado ? new Date().toISOString() : null });
      }
      default:
        return c;
    }
  }

  /** Anda com a criação da loja o quanto der dentro do tempo; devolve em que etapa ficou. */
  async function avancar(id, { orcamento = orcamentoMs } = {}) {
    const [travada] = await sql(`update clientes set processando_ate = now() + interval '90 seconds'
      where id = $1 and situacao = 'pago' and etapa <> 'pronta' and tentativas < $2 and (processando_ate is null or processando_ate < now())
      returning *`, [id, MAX_TENTATIVAS]);
    if (!travada) { const c = await linha(id); return { etapa: c.etapa, ocupado: c.situacao === "pago" && c.etapa !== "pronta" }; }
    let c = travada;
    const inicio = Date.now();
    try {
      while (Date.now() - inicio < orcamento && c.etapa !== "pronta") {
        const antes = c.etapa;
        c = await passo(c, inicio + orcamento);
        if (c.etapa === antes) break; // esperando (banco subindo ou tabelas no meio): continua depois
      }
    } catch (erro) {
      const [falhou] = await sql(`update clientes set tentativas = tentativas + 1, etapa_erro = $2 where id = $1 returning *`, [id, `${c.etapa}: ${String(erro.message).slice(0, 300)}`]);
      c = falhou;
      if (c.tentativas >= MAX_TENTATIVAS) await anotarHistorico(id, "loja", `A criação parou na etapa "${c.etapa}": ${erro.message}. Use "Tentar de novo".`);
    } finally {
      await sql("update clientes set processando_ate = null where id = $1", [id]);
    }
    const falta = c.etapa !== "pronta" && c.tentativas < MAX_TENTATIVAS;
    if (falta && !agendar) continuar(id);
    return { etapa: c.etapa, ocupado: false };
  }

  /** "Tentar de novo" depois de a criação ter parado por erro. */
  async function retomar(id) {
    await sql("update clientes set tentativas = 0, etapa_erro = null where id = $1 and situacao = 'pago'", [id]);
    await avancar(id, { orcamento: Math.min(orcamentoMs, 20_000) });
    return detalhe(id);
  }

  /** Página de pagamento (pública, pelo link): só o necessário, sem dados pessoais. Também empurra a criação da loja. */
  async function paginaDePagamento(token) {
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(String(token))) throw new ErroHttp(404, "Link de pagamento inválido.");
    const [p] = await sql("select * from pagamentos where token_hash = $1", [resumo(token)]);
    if (!p) throw new ErroHttp(404, "Link de pagamento inválido.");
    let c = await linha(p.cliente_id);
    if (c.situacao === "pago" && c.etapa !== "pronta") { await avancar(c.id, { orcamento: 8000 }); c = await linha(c.id); }
    const passoAtual = ORDEM.indexOf(c.etapa);
    return {
      nome_loja: c.nome_loja, valor_centavos: p.valor_centavos,
      situacao: p.situacao === "cancelado" ? "cancelado" : c.situacao === "pago" ? "pago" : "pendente",
      pix: p.mp_copia_cola ?? p.pix_copia_cola, qr_base64: p.mp_qr_base64 ?? null, automatico: Boolean(p.mp_id),
      loja_pronta: c.etapa === "pronta", progresso: c.situacao === "pago" ? Math.max(0, passoAtual) / (ORDEM.length - 1) : 0,
      email: mascararEmail(abrir(c).email),
    };
  }

  /* ---------- suporte ---------- */
  async function reenviar(id, corpo) {
    const c = await linha(id);
    if (!email) throw new ErroHttp(409, "O e-mail ainda não foi configurado. Copie o link e mande pelo WhatsApp.");
    if (corpo.tipo === "cobranca") {
      if (c.situacao !== "aguardando_pagamento") throw new ErroHttp(409, "O pagamento já foi feito.");
      const [p] = await sql("select * from pagamentos where cliente_id = $1 and situacao = 'pendente' order by criado_em desc limit 1", [id]);
      if (!p) throw new ErroHttp(409, "Não há cobrança pendente.");
      await mandar(c, "cobranca", { valorCentavos: p.valor_centavos, link: cofre.decifrar(p.link, `pagamento:${p.id}`) });
    } else if (corpo.tipo === "convite") {
      if (!c.convite) throw new ErroHttp(409, "O convite ainda não foi gerado.");
      await mandar(c, "convite", { convite: cofre.decifrar(c.convite, ctx(id)) });
    } else throw new ErroHttp(422, "Escolha o que reenviar.");
    return detalhe(id);
  }

  async function novoConvite(id) {
    const c = await linha(id);
    if (!c.loja_ref || !c.painel_url) throw new ErroHttp(409, "A loja ainda não foi criada.");
    const r = await lojas.convite(await lojas.porRef(c.loja_ref), abrir(c).email);
    await sql("update clientes set convite = $2, convite_em = now() where id = $1", [id, cofre.cifrar(r.link, ctx(id))]);
    await anotarHistorico(id, "suporte", "Convite novo gerado.");
    const enviado = await mandar(await linha(id), "convite", { convite: r.link }).catch(() => false);
    return { ...(await detalhe(id)), link: r.link, email_enviado: enviado };
  }

  async function redefinirSenha(id) {
    const c = await linha(id);
    if (!c.loja_ref) throw new ErroHttp(409, "A loja ainda não foi criada.");
    const link = await lojas.linkRedefinirSenha(await lojas.porRef(c.loja_ref), abrir(c).email);
    await anotarHistorico(id, "suporte", "Link de redefinir senha gerado.");
    const enviado = await mandar(c, "redefinirSenha", { link }).catch(() => false);
    return { link, email_enviado: enviado };
  }

  async function cobrarDeNovo(id) {
    const c = await linha(id);
    if (c.situacao !== "aguardando_pagamento") throw new ErroHttp(409, "Esta cliente não está aguardando pagamento.");
    const r = await novaCobranca(c);
    const enviado = await mandar(c, "cobranca", { valorCentavos: c.valor_centavos, link: r.link }).catch(() => false);
    return { ...(await detalhe(id)), link_pagamento: r.link, email_enviado: enviado };
  }

  async function cancelar(id) {
    const c = await linha(id);
    if (c.situacao !== "aguardando_pagamento") throw new ErroHttp(409, "Só dá para cancelar antes do pagamento. Depois, exclua a loja na aba Lojas.");
    await sql("update clientes set situacao = 'cancelado', atualizado_em = now() where id = $1", [id]);
    await sql("update pagamentos set situacao = 'cancelado' where cliente_id = $1 and situacao = 'pendente'", [id]);
    await anotarHistorico(id, "cadastro", "Cadastro cancelado.");
    return detalhe(id);
  }

  /** Para o agendador diário: retoma criações que ficaram paradas no meio. */
  async function retomarParadas() {
    const paradas = await sql("select id from clientes where situacao = 'pago' and etapa <> 'pronta' and tentativas < $1", [MAX_TENTATIVAS]);
    for (const { id } of paradas) await avancar(id, { orcamento: 15_000 }).catch(() => {});
    return paradas.length;
  }

  /* ---------- visão geral e pagamentos (meses no horário de Brasília) ---------- */
  const LOCAL = "at time zone 'America/Sao_Paulo'";
  const INICIO_DO_MES = `date_trunc('month', now() ${LOCAL})`;
  const nomeDe = (c) => { try { return abrir(c).nome; } catch { return "(não foi possível abrir)"; } };

  /** Números do negócio. `financeiro`: inclui faturamento e cobranças (só para quem pode ver dinheiro). */
  async function visaoGeral({ financeiro = false } = {}) {
    const [n] = await sql(`select count(*)::int as clientes,
        count(*) filter (where criado_em ${LOCAL} >= ${INICIO_DO_MES})::int as novas_no_mes,
        count(*) filter (where situacao = 'aguardando_pagamento')::int as aguardando,
        count(*) filter (where situacao = 'pago' and etapa = 'pronta')::int as lojas_prontas,
        count(*) filter (where situacao = 'pago' and etapa <> 'pronta')::int as criando
      from clientes`);
    const paradas = await sql(`select id, nome_loja, etapa, etapa_erro from clientes
      where situacao = 'pago' and etapa <> 'pronta' and tentativas >= $1 order by atualizado_em desc limit 5`, [MAX_TENTATIVAS]);
    const esperando = await sql(`select c.id, c.nome_loja, p.valor_centavos, p.criado_em from pagamentos p join clientes c on c.id = p.cliente_id
      where p.situacao = 'pendente' and p.criado_em < now() - interval '2 days' order by p.criado_em limit 5`);
    const recentes = (await sql("select * from clientes order by criado_em desc limit 5")).map((c) => ({
      id: c.id, nome: nomeDe(c), nome_loja: c.nome_loja, situacao: c.situacao, etapa: c.etapa, parada: c.tentativas >= MAX_TENTATIVAS, criado_em: c.criado_em,
    }));
    const r = {
      numeros: n,
      atencao: [
        ...paradas.map((c) => ({ tipo: "parada", cliente_id: c.id, nome_loja: c.nome_loja, texto: "A criação da loja parou" })),
        ...esperando.map((c) => ({ tipo: "pagamento", cliente_id: c.id, nome_loja: c.nome_loja, texto: "Pagamento pendente há mais de 2 dias", valor_centavos: c.valor_centavos })),
      ],
      recentes,
    };
    if (!financeiro) return r;
    const [f] = await sql(`select
        coalesce(sum(valor_centavos) filter (where situacao = 'aprovado' and confirmado_em ${LOCAL} >= ${INICIO_DO_MES}), 0)::bigint as mes,
        coalesce(sum(valor_centavos) filter (where situacao = 'aprovado' and confirmado_em ${LOCAL} >= ${INICIO_DO_MES} - interval '1 month'
          and confirmado_em ${LOCAL} < ${INICIO_DO_MES}), 0)::bigint as mes_anterior,
        coalesce(sum(valor_centavos) filter (where situacao = 'aprovado'), 0)::bigint as total,
        coalesce(sum(valor_centavos) filter (where situacao = 'pendente'), 0)::bigint as pendente,
        count(*) filter (where situacao = 'aprovado')::int as vendas
      from pagamentos`);
    const porMes = await sql(`select to_char(date_trunc('month', confirmado_em ${LOCAL}), 'YYYY-MM') as mes, sum(valor_centavos)::bigint as total, count(*)::int as vendas
      from pagamentos where situacao = 'aprovado' and confirmado_em ${LOCAL} >= ${INICIO_DO_MES} - interval '5 months' group by 1`);
    // os 6 últimos meses, mesmo os sem venda (barra zerada)
    const [{ atual }] = await sql(`select to_char(${INICIO_DO_MES}, 'YYYY-MM') as atual`);
    const [ano, mes] = atual.split("-").map(Number);
    const meses = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(Date.UTC(ano, mes - 1 - (5 - i), 1));
      const chave = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      const achado = porMes.find((m) => m.mes === chave);
      return { mes: chave, total: Number(achado?.total ?? 0), vendas: achado?.vendas ?? 0 };
    });
    return {
      ...r,
      financeiro: { mes: Number(f.mes), mes_anterior: Number(f.mes_anterior), total: Number(f.total), pendente: Number(f.pendente), vendas: f.vendas, meses },
    };
  }

  /** Todas as cobranças (as mais novas primeiro), com o total recebido e o pendente. */
  async function listarPagamentos({ situacao = "" } = {}) {
    const filtro = ["pendente", "aprovado", "cancelado"].includes(situacao) ? situacao : null;
    const linhas = await sql(`select p.id, p.cliente_id, p.valor_centavos, p.situacao, p.criado_em, p.confirmado_em, p.confirmado_por, p.mp_id,
        c.nome_loja, c.dados, c.id as cid
      from pagamentos p join clientes c on c.id = p.cliente_id ${filtro ? "where p.situacao = $1" : ""}
      order by coalesce(p.confirmado_em, p.criado_em) desc limit 300`, filtro ? [filtro] : []);
    const [t] = await sql(`select coalesce(sum(valor_centavos) filter (where situacao = 'aprovado'), 0)::bigint as recebido,
      coalesce(sum(valor_centavos) filter (where situacao = 'pendente'), 0)::bigint as pendente from pagamentos`);
    return {
      totais: { recebido: Number(t.recebido), pendente: Number(t.pendente) },
      pagamentos: linhas.map((p) => ({
        id: p.id, cliente_id: p.cliente_id, cliente: nomeDe({ id: p.cid, dados: p.dados }), nome_loja: p.nome_loja, valor_centavos: p.valor_centavos,
        situacao: p.situacao, criado_em: p.criado_em, confirmado_em: p.confirmado_em, automatico: Boolean(p.mp_id),
        confirmado_por: p.confirmado_por === "mercado_pago" ? "Mercado Pago" : p.confirmado_por === "admin" ? "Manual" : p.confirmado_por,
      })),
    };
  }

  return {
    lerConfig, salvarConfig, cadastrar, listar, detalhe, atualizar, anotar, confirmarManual, receberAvisoMercadoPago,
    avancar, retomar, paginaDePagamento, reenviar, novoConvite, redefinirSenha, cobrarDeNovo, cancelar, retomarParadas,
    visaoGeral, listarPagamentos,
  };
}
