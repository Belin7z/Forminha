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
/** Versão dos termos de uso e da política de privacidade da Forminha (mude quando o texto mudar). */
export const VERSAO_DOS_TERMOS = "2026-09-29";
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
export function criarClientes({ banco, cofre, lojas, email = null, mp = null, urlBase, segredoInterno = "", fetchFn = fetch, orcamentoMs = 40_000, agendar = null, esperaBancoMs = 4000,
  avisar = async () => {}, cupons = null }) {
  // o endereço da Central pode mudar (domínio próprio): `urlBase` é texto ou função
  const central = typeof urlBase === "function" ? urlBase : () => urlBase;
  const sql = (t, p) => banco.consultar(t, p);
  const ctx = (id) => `cliente:${id}`;
  const brl = (centavos) => (Number(centavos) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  /** O sino da Central (lib/avisos.js): nunca atrapalha o que estava sendo feito. */
  const aviso = (dados) => Promise.resolve().then(() => avisar(dados)).catch(() => {});

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

  /* metas do mês: faturamento e lojas vendidas (0 = sem meta) */
  async function lerMetas() {
    const [l] = await sql("select valor from configuracoes where chave = 'metas'");
    return { faturamento_centavos: Number(l?.valor?.faturamento_centavos ?? 0), lojas: Number(l?.valor?.lojas ?? 0) };
  }
  async function salvarMetas(corpo) {
    const faturamento = Math.round(Number(corpo.faturamento_centavos ?? 0));
    const qtd = Math.round(Number(corpo.lojas ?? 0));
    const campos = {};
    if (!Number.isFinite(faturamento) || faturamento < 0 || faturamento > 1_000_000_000) campos.faturamento = "Meta de faturamento: de R$ 0 a R$ 10 milhões.";
    if (!Number.isFinite(qtd) || qtd < 0 || qtd > 10_000) campos.lojas = "Meta de lojas: de 0 a 10.000.";
    if (Object.keys(campos).length) throw new ErroHttp(422, Object.values(campos)[0], campos);
    await sql("insert into configuracoes (chave, valor) values ('metas', $1::jsonb) on conflict (chave) do update set valor = excluded.valor",
      [JSON.stringify({ faturamento_centavos: faturamento, lojas: qtd })]);
    return lerMetas();
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

  /* ---------- e-mails (se o Resend ou o Gmail estiver configurado) ---------- */
  async function mandar(c, modelo, dados) {
    if (!email) return false;
    const pessoa = abrir(c);
    const m = modelos[modelo]({ nome: pessoa.nome.split(" ")[0], nomeLoja: c.nome_loja, ...dados });
    await email.enviar({ para: pessoa.email, assunto: m.assunto, texto: m.texto, html: m.html });
    await anotarHistorico(c.id, "email", `E-mail enviado: ${m.assunto}`);
    return true;
  }

  /* ---------- cobrança ---------- */
  /**
   * Cobrança PIX (e Mercado Pago, se ligado) com página de pagamento. `tipo` "loja" (a criação) ou "mensalidade";
   * a cobrança nova cancela as pendentes do mesmo tipo.
   */
  async function novaCobranca(c, { valor = c.valor_centavos, tipo = "loja", vencimento = null, credito = 0 } = {}) {
    const cfg = await lerConfig();
    if (!cfg.pix.chave) throw new ErroHttp(409, "Antes de cobrar, informe a sua chave PIX em Configurações.");
    const pessoa = abrir(c);
    await sql("update pagamentos set situacao = 'cancelado' where cliente_id = $1 and situacao = 'pendente' and tipo = $2", [c.id, tipo]);
    const id = randomUUID();
    const token = randomBytes(24).toString("base64url");
    const link = `${central()}/#/pagar/${token}`;
    const pix = gerarPix({ ...cfg.pix, valor, identificador: `FM${id.replace(/-/g, "").slice(0, 20)}` });
    let automatico = null;
    if (mp) {
      try {
        const descricao = tipo === "mensalidade" ? `Mensalidade ${c.nome_loja} - Forminha` : `Loja ${c.nome_loja} - Forminha`;
        automatico = await mp.criarCobranca({ valorCentavos: valor, descricao, email: pessoa.email, referencia: id, notificacao: `${central()}/api/webhook/mercadopago`, chaveUnica: id });
      } catch (e) { await anotarHistorico(c.id, "pagamento", `Mercado Pago indisponível; ficou só o PIX com a sua chave (${e.message}).`); }
    }
    await sql(`insert into pagamentos (id, cliente_id, token_hash, link, valor_centavos, pix_copia_cola, mp_id, mp_copia_cola, mp_qr_base64, tipo, vencimento, credito_usado_centavos)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [id, c.id, resumo(token), cofre.cifrar(link, `pagamento:${id}`), valor, pix, automatico?.id ?? null, automatico?.copiaCola ?? null, automatico?.qrBase64 ?? null,
      tipo, vencimento, credito]);
    const onde = automatico ? " (PIX automático + manual)" : " (PIX com a sua chave)";
    await anotarHistorico(c.id, "pagamento", tipo === "mensalidade"
      ? `Mensalidade de ${brl(valor)} gerada, vence em ${dataBRdoISO(vencimento)}${credito ? ` (${brl(credito)} de crédito abatido)` : ""}${onde}.`
      : `Cobrança de ${(valor / 100).toFixed(2).replace(".", ",")} gerada${onde}.`);
    return { id, link };
  }

  /** `so_interesse`: só registra o interesse (etapa "interessada" do funil), sem cobrança; a proposta vai depois. */
  async function cadastrar(corpo) {
    const cfg = await lerConfig();
    const d = validarCliente({ ...corpo, valor_centavos: corpo.valor_centavos ?? cfg.valor_padrao_centavos });
    const soInteresse = corpo.so_interesse === true;
    if (!soInteresse && !cfg.pix.chave) throw new ErroHttp(409, "Antes de cadastrar, informe a sua chave PIX em Configurações.");
    // cupom (de desconto ou de indicação): confere, reserva um uso e já cobra o valor com desconto
    let cupom = null;
    if (String(corpo.cupom ?? "").trim()) {
      if (!cupons) throw new ErroHttp(503, "Cupons indisponíveis agora.");
      cupom = await cupons.conferir(corpo.cupom, d.valor_centavos);
      await cupons.reservar(cupom.codigo);
    }
    const id = randomUUID();
    const pessoa = { nome: d.nome, email: d.email, telefone: d.telefone ?? "", documento: d.documento ?? "", observacoes: d.observacoes ?? "" };
    try {
      await sql(`insert into clientes (id, dados, email_indice, nome_loja, valor_centavos, situacao, cadastrado_por, cupom, desconto_centavos, indicada_por)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [id, cofre.cifrar(pessoa, ctx(id)), cofre.indice(d.email), d.nome_loja, cupom ? cupom.valor_final : d.valor_centavos,
          soInteresse ? "interessada" : "aguardando_pagamento", autorAtual() ?? null, cupom?.codigo ?? null, cupom?.desconto_centavos ?? 0, cupom?.indicacao_de ?? null]);
    } catch (e) {
      if (cupom) await cupons.liberar(cupom.codigo).catch(() => {});
      if (String(e.code) === "23505" || /duplicate|unique/i.test(e.message)) throw new ErroHttp(409, "Já existe uma cliente com esse e-mail.", { email: "Já existe uma cliente com esse e-mail." });
      throw e;
    }
    await anotarHistorico(id, "cadastro", soInteresse ? "Interesse registrado (ainda sem cobrança)." : "Cliente cadastrada.");
    if (cupom) {
      const [quem] = cupom.indicacao_de ? await sql("select nome_loja from clientes where id = $1", [cupom.indicacao_de]) : [];
      await anotarHistorico(id, "cadastro", `Cupom ${cupom.codigo} aplicado: ${cupom.descricao} (−${brl(cupom.desconto_centavos)}).${quem ? ` Veio por indicação de ${quem.nome_loja}.` : ""}`);
    }
    const autor = autorAtual();
    if (autor && autor !== "Dono") aviso({ tipo: "cadastro", titulo: `Cliente nova: ${d.nome_loja}`, texto: `Cadastrada por ${autor} · ${brl(d.valor_centavos)}`, cliente_id: id, permissao: "dono" });
    if (soInteresse) return { ...(await detalhe(id)), link_pagamento: null, email_enviado: false, so_interesse: true };
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
      cadastrado_por: c.cadastrado_por ?? null, pronta_em: c.pronta_em ?? null,
      cupom: c.cupom ?? null, desconto_centavos: c.desconto_centavos ?? 0, indicada_por: c.indicada_por ?? null, credito_centavos: c.credito_centavos ?? 0,
      termos_versao: c.termos_versao ?? null, termos_aceitos_em: c.termos_aceitos_em ?? null,
    };
  }

  async function listar() {
    const linhas = await sql("select * from clientes order by criado_em desc");
    return linhas.map((c) => {
      try { const p = publico(c); return { id: p.id, criado_em: p.criado_em, nome: p.nome, email: p.email, telefone: p.telefone, nome_loja: p.nome_loja, valor_centavos: p.valor_centavos, situacao: p.situacao, etapa: p.etapa, parada: p.parada, loja_url: p.loja_url, suspensa: Boolean(c.suspensa_em) }; }
      catch { return { id: c.id, criado_em: c.criado_em, nome: "(não foi possível abrir)", nome_loja: c.nome_loja, situacao: c.situacao, etapa: c.etapa, ilegivel: true }; }
    });
  }

  async function detalhe(id) {
    const c = await linha(id);
    const pagamentos = (await sql("select * from pagamentos where cliente_id = $1 order by criado_em desc", [id])).map((p) => ({
      id: p.id, criado_em: p.criado_em, valor_centavos: p.valor_centavos, situacao: p.situacao, automatico: Boolean(p.mp_id),
      tipo: p.tipo ?? "loja", vencimento: p.vencimento ? isoDia(p.vencimento) : null, credito_usado_centavos: p.credito_usado_centavos ?? 0, nota_fiscal: p.nota_fiscal ?? null,
      link: cofre.decifrar(p.link, `pagamento:${p.id}`), pix_copia_cola: p.pix_copia_cola, confirmado_em: p.confirmado_em, confirmado_por: p.confirmado_por,
    }));
    const historico = (await sql("select id, quando, tipo, texto from historico where cliente_id = $1 order by id desc limit 60", [id]))
      .map((h) => ({ id: h.id, quando: h.quando, tipo: h.tipo, texto: (() => { try { return cofre.decifrar(h.texto, `historico:${id}`); } catch { return "(não foi possível abrir)"; } })() }));
    return { cliente: publico(c), pagamentos, historico, email_configurado: Boolean(email), assinatura: await resumoAssinatura(c) };
  }

  async function atualizar(id, corpo) {
    const c = await linha(id);
    const d = validarCliente(corpo, { parcial: true });
    const pessoa = { ...abrir(c) };
    for (const k of ["nome", "email", "telefone", "documento", "observacoes"]) if (d[k] !== undefined) pessoa[k] = d[k];
    if (d.nome_loja !== undefined && c.loja_ref) throw new ErroHttp(409, "A loja já foi criada: o nome dela agora é trocado pela própria dona, no painel.");
    if (d.valor_centavos !== undefined && !["interessada", "aguardando_pagamento"].includes(c.situacao)) throw new ErroHttp(409, "O pagamento já foi feito: o valor não muda mais.");
    try {
      await sql(`update clientes set dados = $2, email_indice = $3, nome_loja = coalesce($4, nome_loja), valor_centavos = coalesce($5, valor_centavos), atualizado_em = now() where id = $1`,
        [id, cofre.cifrar(pessoa, ctx(id)), cofre.indice(pessoa.email), d.nome_loja ?? null, d.valor_centavos ?? null]);
    } catch (e) {
      if (String(e.code) === "23505" || /duplicate|unique/i.test(e.message)) throw new ErroHttp(409, "Já existe uma cliente com esse e-mail.", { email: "Já existe uma cliente com esse e-mail." });
      throw e;
    }
    await anotarHistorico(id, "suporte", "Dados da cliente atualizados.");
    if (d.valor_centavos !== undefined && c.situacao === "aguardando_pagamento") await novaCobranca(await linha(id));
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
      if (atual.situacao === "aprovado") return { cliente_id: atual.cliente_id, ja_estava: true, tipo: atual.tipo }; // aviso repetido: não conta duas vezes
      throw new ErroHttp(409, "Esta cobrança foi cancelada (há uma mais nova).");
    }
    if (p.tipo === "mensalidade") { await mensalidadePaga(p, por); return { cliente_id: p.cliente_id, ja_estava: false, tipo: "mensalidade" }; }
    await sql(`update clientes set situacao = 'pago', etapa = 'criar_projeto', tentativas = 0, etapa_erro = null, atualizado_em = now(),
        termos_versao = $2, termos_aceitos_em = now()
      where id = $1 and situacao = 'aguardando_pagamento'`, [p.cliente_id, VERSAO_DOS_TERMOS]);
    await anotarHistorico(p.cliente_id, "pagamento", `Pagamento de ${(p.valor_centavos / 100).toFixed(2).replace(".", ",")} confirmado ${por === "mercado_pago" ? "pelo Mercado Pago" : "manualmente"}.`);
    const [dona] = await sql("select nome_loja, indicada_por from clientes where id = $1", [p.cliente_id]);
    if (dona?.indicada_por && cupons) await premiarIndicacao(dona.indicada_por, dona.nome_loja);
    aviso({ tipo: "pagamento", titulo: `Pagamento recebido: ${dona?.nome_loja ?? "loja"}`, texto: `${brl(p.valor_centavos)} · ${por === "mercado_pago" ? "PIX automático" : "confirmado à mão"}. A loja já está sendo criada.`,
      cliente_id: p.cliente_id, permissao: "clientes.ver" });
    return { cliente_id: p.cliente_id, ja_estava: false };
  }

  /** A indicada pagou: quem indicou ganha o crédito da indicação (para abater nas mensalidades). */
  async function premiarIndicacao(indicouId, nomeDaIndicada) {
    const { recompensa_centavos: valor } = await cupons.lerIndicacao();
    if (!(valor > 0)) return;
    const [quem] = await sql("update clientes set credito_centavos = credito_centavos + $2, atualizado_em = now() where id = $1 returning nome_loja, credito_centavos", [indicouId, valor]);
    if (!quem) return;
    await anotarHistorico(indicouId, "pagamento", `Indicou ${nomeDaIndicada}: ganhou ${brl(valor)} de crédito (total: ${brl(quem.credito_centavos)}).`);
    aviso({ tipo: "indicacao", titulo: `Indicação: ${quem.nome_loja} trouxe ${nomeDaIndicada}`, texto: `${brl(valor)} de crédito para ${quem.nome_loja}.`, cliente_id: indicouId, permissao: "clientes.ver" });
  }

  async function confirmarManual(id, corpo) {
    const c = await linha(id);
    const [p] = corpo.pagamento_id ? [{ id: corpo.pagamento_id }] : await sql("select id from pagamentos where cliente_id = $1 and situacao = 'pendente' order by criado_em desc limit 1", [id]);
    if (!p) throw new ErroHttp(409, c.situacao === "pago" ? "O pagamento já está confirmado." : "Não há cobrança pendente.");
    const r = await confirmarPagamento(p.id, autorAtual() ?? "admin"); // quem confirmou fica guardado no pagamento
    if (r.cliente_id !== id) throw new ErroHttp(404, "Pagamento não encontrado.");
    if (r.tipo !== "mensalidade") await avancar(id, { orcamento: Math.min(orcamentoMs, 20_000) }); // cria o banco já e pede para outra execução seguir
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
    if (!r.ja_estava && r.tipo !== "mensalidade") continuar(r.cliente_id);
    return { ok: true };
  }

  /* ---------- criação automática da loja ---------- */
  /** Pede para outra execução continuar a criação (a função da Vercel tem tempo limitado). */
  function continuar(id) {
    if (agendar) return agendar(id);
    if (!segredoInterno || !central()) return;
    fetchFn(`${central()}/api/interno/avancar`, {
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
        aviso({ tipo: "loja_pronta", titulo: `Loja pronta: ${c.nome_loja}`, texto: enviado ? "O convite já foi por e-mail para a dona." : "Mande o link do convite para a dona (está na ficha).",
          cliente_id: c.id, permissao: "clientes.ver" });
        return mudar({ etapa: "pronta", pronta_em: new Date().toISOString(), email_boas_vindas_em: enviado ? new Date().toISOString() : null });
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
      if (c.tentativas >= MAX_TENTATIVAS) {
        await anotarHistorico(id, "loja", `A criação parou na etapa "${c.etapa}": ${erro.message}. Use "Tentar de novo".`);
        aviso({ tipo: "parada", titulo: `A criação parou: ${c.nome_loja}`, texto: `Na etapa "${c.etapa}". Abra a ficha e use "Tentar de novo".`, cliente_id: id, permissao: "lojas.suporte" });
      }
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
    if (p.tipo !== "mensalidade" && c.situacao === "pago" && c.etapa !== "pronta") { await avancar(c.id, { orcamento: 8000 }); c = await linha(c.id); }
    const passoAtual = ORDEM.indexOf(c.etapa);
    return {
      nome_loja: c.nome_loja, valor_centavos: p.valor_centavos, cupom: p.tipo === "mensalidade" ? null : c.cupom ?? null, desconto_centavos: p.tipo === "mensalidade" ? 0 : c.desconto_centavos ?? 0,
      tipo: p.tipo ?? "loja", vencimento: p.vencimento ? isoDia(p.vencimento) : null, credito_usado_centavos: p.credito_usado_centavos ?? 0,
      situacao: p.situacao === "cancelado" ? "cancelado" : p.tipo === "mensalidade" ? (p.situacao === "aprovado" ? "pago" : "pendente") : c.situacao === "pago" ? "pago" : "pendente",
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

  /** Cobrança nova (ou a primeira, para quem só tinha registrado interesse: vira "aguardando pagamento"). */
  async function cobrarDeNovo(id) {
    let c = await linha(id);
    if (!["interessada", "aguardando_pagamento"].includes(c.situacao)) throw new ErroHttp(409, "Esta cliente não está aguardando pagamento.");
    if (c.situacao === "interessada") {
      if (!(await lerConfig()).pix.chave) throw new ErroHttp(409, "Antes de cobrar, informe a sua chave PIX em Configurações.");
      [c] = await sql("update clientes set situacao = 'aguardando_pagamento', atualizado_em = now() where id = $1 returning *", [id]);
      await anotarHistorico(id, "cadastro", "Proposta enviada: a cobrança foi gerada.");
    }
    const r = await novaCobranca(c);
    const enviado = await mandar(c, "cobranca", { valorCentavos: c.valor_centavos, link: r.link }).catch(() => false);
    return { ...(await detalhe(id)), link_pagamento: r.link, email_enviado: enviado };
  }

  async function cancelar(id) {
    const c = await linha(id);
    if (!["interessada", "aguardando_pagamento"].includes(c.situacao)) throw new ErroHttp(409, "Só dá para cancelar antes do pagamento. Depois, exclua a loja na aba Lojas.");
    await sql("update clientes set situacao = 'cancelado', atualizado_em = now() where id = $1", [id]);
    if (c.cupom && cupons) await cupons.liberar(c.cupom).catch(() => {});
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
        count(*) filter (where situacao = 'interessada')::int as interessadas,
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
    const atrasadas = await sql(`select c.id, c.nome_loja, p.valor_centavos, c.suspensa_em from pagamentos p join clientes c on c.id = p.cliente_id
      where p.tipo = 'mensalidade' and p.situacao = 'pendente' and p.vencimento < (now() ${LOCAL})::date order by p.vencimento limit 5`);
    const r = {
      numeros: n,
      atencao: [
        ...atrasadas.map((c) => ({ tipo: c.suspensa_em ? "parada" : "pagamento", cliente_id: c.id, nome_loja: c.nome_loja,
          texto: c.suspensa_em ? "Loja suspensa: mensalidade atrasada" : "Mensalidade atrasada", valor_centavos: c.valor_centavos })),
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
        count(*) filter (where situacao = 'aprovado')::int as vendas,
        count(*) filter (where situacao = 'aprovado' and confirmado_em ${LOCAL} >= ${INICIO_DO_MES})::int as vendas_mes,
        extract(day from now() ${LOCAL})::int as dia,
        extract(day from ${INICIO_DO_MES} + interval '1 month' - interval '1 day')::int as dias_no_mes
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
      sem_nota: Number((await sql("select count(*)::int as n from pagamentos where situacao = 'aprovado' and nota_fiscal is null"))[0].n),
      // mensalidades: quanto entra todo mês (as lojas no ar que pagam) e quantas estão atrasadas
      recorrente: await recorrencia(),
      // meta do mês e onde ele fecha se o ritmo continuar
      meta: {
        ...(await lerMetas()), faturamento_feito: Number(f.mes), lojas_feitas: f.vendas_mes, dia: f.dia, dias_no_mes: f.dias_no_mes,
        projecao_centavos: f.dia ? Math.round((Number(f.mes) / f.dia) * f.dias_no_mes) : 0,
        projecao_lojas: f.dia ? Math.round((f.vendas_mes / f.dia) * f.dias_no_mes) : 0,
      },
    };
  }

  /** Todas as cobranças (as mais novas primeiro), com o total recebido e o pendente. */
  async function listarPagamentos({ situacao = "" } = {}) {
    if (situacao === "sem_nota") return listarPagamentosSemNota();
    const filtro = ["pendente", "aprovado", "cancelado"].includes(situacao) ? situacao : null;
    const linhas = await sql(`select p.id, p.cliente_id, p.valor_centavos, p.situacao, p.criado_em, p.confirmado_em, p.confirmado_por, p.mp_id,
        p.tipo, p.nota_fiscal, to_char(p.vencimento, 'YYYY-MM-DD') as vencimento, c.nome_loja, c.dados, c.id as cid
      from pagamentos p join clientes c on c.id = p.cliente_id ${filtro ? "where p.situacao = $1" : ""}
      order by coalesce(p.confirmado_em, p.criado_em) desc limit 300`, filtro ? [filtro] : []);
    const [t] = await sql(`select coalesce(sum(valor_centavos) filter (where situacao = 'aprovado'), 0)::bigint as recebido,
      coalesce(sum(valor_centavos) filter (where situacao = 'pendente'), 0)::bigint as pendente,
      count(*) filter (where situacao = 'aprovado' and nota_fiscal is null)::int as sem_nota from pagamentos`);
    return {
      totais: { recebido: Number(t.recebido), pendente: Number(t.pendente), sem_nota: t.sem_nota },
      pagamentos: linhas.map((p) => ({
        id: p.id, cliente_id: p.cliente_id, cliente: nomeDe({ id: p.cid, dados: p.dados }), nome_loja: p.nome_loja, valor_centavos: p.valor_centavos,
        situacao: p.situacao, criado_em: p.criado_em, confirmado_em: p.confirmado_em, automatico: Boolean(p.mp_id),
        confirmado_por: p.confirmado_por === "mercado_pago" ? "Mercado Pago" : p.confirmado_por === "admin" ? "Manual" : p.confirmado_por,
        tipo: p.tipo ?? "loja", vencimento: p.vencimento ?? null, nota_fiscal: p.nota_fiscal ?? null,
      })),
    };
  }

  async function listarPagamentosSemNota() {
    const r = await listarPagamentos({ situacao: "aprovado" });
    return { ...r, pagamentos: r.pagamentos.filter((p) => !p.nota_fiscal) };
  }

  /** Nota fiscal de um pagamento recebido (emitida fora da Central): número e, se houver, o link. Número vazio apaga. */
  async function registrarNota(pagamentoId, corpo) {
    if (!UUID.test(String(pagamentoId))) throw new ErroHttp(404, "Pagamento não encontrado.");
    const numero = String(corpo.numero ?? "").trim();
    const link = String(corpo.link ?? "").trim();
    const campos = {};
    if (numero.length > 40) campos.numero = "Número: até 40 caracteres.";
    if (link && !/^https:\/\/\S{4,500}$/.test(link)) campos.link = "O link precisa começar com https://";
    if (Object.keys(campos).length) throw new ErroHttp(422, Object.values(campos)[0], campos);
    const nota = numero ? { numero, link: link || null, emitida_em: new Date().toISOString() } : null;
    const [p] = await sql("update pagamentos set nota_fiscal = $2::jsonb where id = $1 and situacao = 'aprovado' returning id, cliente_id",
      [pagamentoId, nota ? JSON.stringify(nota) : null]);
    if (!p) throw new ErroHttp(409, "Só dá para registrar nota de um pagamento recebido.");
    await anotarHistorico(p.cliente_id, "pagamento", nota ? `Nota fiscal ${numero} registrada.` : "Nota fiscal apagada.");
    return { id: p.id, nota_fiscal: nota };
  }

  /* dados da empresa (aparecem nos termos de uso e na política de privacidade) */
  async function lerEmpresa() {
    const [l] = await sql("select valor from configuracoes where chave = 'empresa'");
    return { nome: "", documento: "", email: "", cidade: "", ...(l?.valor ?? {}), termos_versao: VERSAO_DOS_TERMOS };
  }
  async function salvarEmpresa(corpo) {
    const d = { nome: texto(corpo.nome, 120), documento: soDigitos(corpo.documento), email: String(corpo.email ?? "").trim().toLowerCase(), cidade: texto(corpo.cidade, 80) };
    const campos = {};
    if (d.nome.length > 120) campos.nome = "Até 120 letras.";
    if (d.documento && !(cpfValido(d.documento) || cnpjValido(d.documento))) campos.documento = "CPF ou CNPJ inválido.";
    if (d.email && !EMAIL.test(d.email)) campos.email = "E-mail inválido.";
    if (Object.keys(campos).length) throw new ErroHttp(422, Object.values(campos)[0], campos);
    await sql("insert into configuracoes (chave, valor) values ('empresa', $1::jsonb) on conflict (chave) do update set valor = excluded.valor", [JSON.stringify(d)]);
    return lerEmpresa();
  }

  /**
   * Relatório de vendas de um período (datas AAAA-MM-DD, no horário de Brasília): total, quantidade,
   * ticket médio, comparação com o período anterior do mesmo tamanho, a série para o gráfico
   * (por hora, dia, mês ou ano — com os buracos zerados) e cada venda.
   */
  async function vendas({ de, ate, agrupar } = {}) {
    if (!DATA_ISO.test(String(de)) || !DATA_ISO.test(String(ate)) || !dataValida(de) || !dataValida(ate)) throw new ErroHttp(422, "Escolha as datas do período.");
    const inicio = Date.parse(`${de}T00:00:00Z`), fim = Date.parse(`${ate}T00:00:00Z`);
    if (inicio > fim) throw new ErroHttp(422, "A data inicial precisa ser antes da final.");
    const dias = Math.round((fim - inicio) / UM_DIA) + 1;
    if (dias > 3700) throw new ErroHttp(422, "Período longo demais (até 10 anos).");
    const g = GRUPOS[agrupar] ? agrupar : dias <= 1 ? "hora" : dias <= 92 ? "dia" : dias <= 1100 ? "mes" : "ano";
    const baldes = baldesDoPeriodo(g, de, ate);
    if (baldes.length > 400) throw new ErroHttp(422, "Período longo demais para esse agrupamento.");

    const NO_PERIODO = `(p.confirmado_em ${LOCAL}) >= $1::date and (p.confirmado_em ${LOCAL}) < $2::date + 1`;
    const linhas = await sql(`select p.id, p.cliente_id, p.valor_centavos, p.confirmado_em, p.confirmado_por, p.mp_id, c.nome_loja, c.dados, c.id as cid,
        to_char(date_trunc('${GRUPOS[g].unidade}', p.confirmado_em ${LOCAL}), '${GRUPOS[g].formato}') as chave
      from pagamentos p join clientes c on c.id = p.cliente_id
      where p.situacao = 'aprovado' and ${NO_PERIODO} order by p.confirmado_em desc`, [de, ate]);
    const antesDe = isoDoDia(inicio - dias * UM_DIA), antesAte = isoDoDia(inicio - UM_DIA);
    const [antes] = await sql(`select coalesce(sum(p.valor_centavos), 0)::bigint as total, count(*)::int as vendas from pagamentos p
      where p.situacao = 'aprovado' and ${NO_PERIODO}`, [antesDe, antesAte]);

    const somas = new Map();
    for (const l of linhas) {
      const s = somas.get(l.chave) ?? { total: 0, vendas: 0 };
      s.total += l.valor_centavos; s.vendas += 1;
      somas.set(l.chave, s);
    }
    const total = linhas.reduce((t, l) => t + l.valor_centavos, 0);
    return {
      de, ate, agrupamento: g,
      resumo: {
        total, vendas: linhas.length, ticket: linhas.length ? Math.round(total / linhas.length) : 0,
        anterior: { de: antesDe, ate: antesAte, total: Number(antes.total), vendas: antes.vendas },
      },
      serie: baldes.map((chave) => ({ chave, ...(somas.get(chave) ?? { total: 0, vendas: 0 }) })),
      itens: linhas.slice(0, 1000).map((l) => ({
        id: l.id, cliente_id: l.cliente_id, nome_loja: l.nome_loja, cliente: nomeDe({ id: l.cid, dados: l.dados }), valor_centavos: l.valor_centavos,
        confirmado_em: l.confirmado_em, automatico: Boolean(l.mp_id),
        confirmado_por: l.confirmado_por === "mercado_pago" ? "Mercado Pago" : l.confirmado_por === "admin" ? "Manual" : l.confirmado_por,
      })),
    };
  }

  /* ==========================================================
     ASSINATURA (mensalidade)
       • a primeira vence N dias depois da loja pronta (padrão 30);
       • a cobrança sai alguns dias antes (padrão 5), com o crédito de indicação abatido;
       • vencida: lembrete; passada a carência (padrão 7 dias), a loja para de receber
         pedidos pelo site (o painel continua); pagou, volta na hora e o vencimento avança 1 mês;
       • a loja fica sabendo pela ficha "forminha" (o painel mostra o aviso com o link).
     ========================================================== */
  const PADRAO_ASSINATURA = { valor_centavos: 0, primeira_em_dias: 30, aviso_antes_dias: 5, carencia_dias: 7 };
  async function lerAssinatura() {
    const [l] = await sql("select valor from configuracoes where chave = 'assinatura'");
    return { ...PADRAO_ASSINATURA, ...(l?.valor ?? {}) };
  }
  async function salvarAssinatura(corpo) {
    const d = { valor_centavos: Math.round(Number(corpo.valor_centavos ?? 0)), primeira_em_dias: Math.round(Number(corpo.primeira_em_dias ?? 30)),
      aviso_antes_dias: Math.round(Number(corpo.aviso_antes_dias ?? 5)), carencia_dias: Math.round(Number(corpo.carencia_dias ?? 7)) };
    const campos = {};
    if (!Number.isFinite(d.valor_centavos) || d.valor_centavos < 0 || d.valor_centavos > 10_000_000) campos.valor = "Mensalidade: de R$ 0 a R$ 100.000 (0 = sem mensalidade).";
    if (!Number.isFinite(d.primeira_em_dias) || d.primeira_em_dias < 0 || d.primeira_em_dias > 365) campos.primeira_em_dias = "De 0 a 365 dias.";
    if (!Number.isFinite(d.aviso_antes_dias) || d.aviso_antes_dias < 0 || d.aviso_antes_dias > 30) campos.aviso_antes_dias = "De 0 a 30 dias.";
    if (!Number.isFinite(d.carencia_dias) || d.carencia_dias < 0 || d.carencia_dias > 90) campos.carencia_dias = "De 0 a 90 dias.";
    if (Object.keys(campos).length) throw new ErroHttp(422, Object.values(campos)[0], campos);
    await sql("insert into configuracoes (chave, valor) values ('assinatura', $1::jsonb) on conflict (chave) do update set valor = excluded.valor", [JSON.stringify(d)]);
    return lerAssinatura();
  }

  const valorMensal = (c, cfg) => (c.mensalidade_centavos ?? cfg.valor_centavos) || 0;
  const cobravel = (c, cfg) => c.situacao === "pago" && c.etapa === "pronta" && !c.assinatura_isenta && valorMensal(c, cfg) > 0;
  const pendenteDe = async (id) => (await sql(`select *, to_char(vencimento, 'YYYY-MM-DD') as venc from pagamentos
    where cliente_id = $1 and tipo = 'mensalidade' and situacao = 'pendente' order by criado_em desc limit 1`, [id]))[0] ?? null;

  /** A situação da mensalidade (a mesma que vai para a ficha da loja). */
  async function estadoAssinatura(c, cfg, hoje = hojeSP()) {
    if (c.situacao !== "pago" || c.etapa !== "pronta") return null;
    if (!cobravel(c, cfg)) return { situacao: c.assinatura_isenta ? "isenta" : "sem_mensalidade", vencimento: null, valor_centavos: 0, link: null, suspensa: false };
    const pend = await pendenteDe(c.id);
    const venc = pend?.venc ?? (c.proximo_vencimento ? isoDia(c.proximo_vencimento) : null);
    const situacao = c.suspensa_em ? "suspensa" : pend ? (pend.venc < hoje ? "atrasada" : "aberta") : "em_dia";
    return { situacao, vencimento: venc, valor_centavos: pend?.valor_centavos ?? valorMensal(c, cfg), link: pend ? cofre.decifrar(pend.link, `pagamento:${pend.id}`) : null,
      suspensa: Boolean(c.suspensa_em) };
  }

  /** Para a ficha da cliente na Central. */
  async function resumoAssinatura(c) {
    const cfg = await lerAssinatura();
    const e = await estadoAssinatura(c, cfg);
    if (!e) return null;
    return { ...e, mensalidade_centavos: c.mensalidade_centavos ?? null, padrao_centavos: cfg.valor_centavos, isenta: c.assinatura_isenta,
      proximo_vencimento: c.proximo_vencimento ? isoDia(c.proximo_vencimento) : null, credito_centavos: c.credito_centavos ?? 0,
      suspensa_em: c.suspensa_em ?? null, pendente_id: (await pendenteDe(c.id))?.id ?? null };
  }

  /** Conta para a loja (ficha "forminha") a situação da mensalidade — só quando mudou. */
  async function sincronizarAssinatura(c, cfg) {
    const e = await estadoAssinatura(c, cfg);
    if (!e || !c.loja_ref) return false;
    if (JSON.stringify(e) === JSON.stringify(c.assinatura_estado ?? null)) return false;
    try {
      await lojas.escreverFicha(c.loja_ref, { assinatura: e });
      await sql("update clientes set assinatura_estado = $2::jsonb where id = $1", [c.id, JSON.stringify(e)]);
      return true;
    } catch (erro) { console.error("[assinatura]", c.id, erro.message); return false; } // loja pausada: tenta de novo amanhã
  }

  async function suspender(c, motivo) {
    const [s] = await sql("update clientes set suspensa_em = now(), atualizado_em = now() where id = $1 and suspensa_em is null returning *", [c.id]);
    if (!s) return c;
    await anotarHistorico(c.id, "loja", `Loja suspensa (${motivo}): o site parou de receber pedidos; o painel continua.`);
    aviso({ tipo: "parada", titulo: `Loja suspensa: ${c.nome_loja}`, texto: motivo, cliente_id: c.id, permissao: "clientes.ver" });
    const pend = await pendenteDe(c.id);
    if (pend) await mandar(s, "lojaSuspensa", { link: cofre.decifrar(pend.link, `pagamento:${pend.id}`) }).catch(() => false);
    return s;
  }

  async function reativarAssinatura(c, motivo) {
    const [s] = await sql("update clientes set suspensa_em = null, atualizado_em = now() where id = $1 and suspensa_em is not null returning *", [c.id]);
    if (!s) return c;
    await anotarHistorico(c.id, "loja", `Loja reativada (${motivo}).`);
    aviso({ tipo: "loja_pronta", titulo: `Loja reativada: ${c.nome_loja}`, texto: motivo, cliente_id: c.id, permissao: "clientes.ver" });
    return s;
  }

  /** Mensalidade paga: o vencimento avança 1 mês, o crédito usado sai e, se estava suspensa, a loja volta. */
  async function mensalidadePaga(p, por) {
    const venc = isoDia(p.vencimento);
    const [c] = await sql(`update clientes set proximo_vencimento = greatest(coalesce(proximo_vencimento, $2::date), $2::date),
        credito_centavos = greatest(credito_centavos - $3, 0), atualizado_em = now() where id = $1 returning *`, [p.cliente_id, somarMes(venc), p.credito_usado_centavos ?? 0]);
    await anotarHistorico(c.id, "pagamento", `Mensalidade de ${brl(p.valor_centavos)} (venceu em ${dataBRdoISO(venc)}) paga ${por === "mercado_pago" ? "pelo Mercado Pago" : "e confirmada à mão"}. Próximo vencimento: ${dataBRdoISO(somarMes(venc))}.`);
    aviso({ tipo: "pagamento", titulo: `Mensalidade paga: ${c.nome_loja}`, texto: brl(p.valor_centavos), cliente_id: c.id, permissao: "clientes.ver" });
    const atual = c.suspensa_em ? await reativarAssinatura(c, "mensalidade paga") : c;
    await sincronizarAssinatura(atual, await lerAssinatura());
  }

  /** Gera a cobrança da mensalidade de agora (o crédito de indicação abate; se cobrir tudo, já conta como paga). */
  async function gerarMensalidade(c, cfg) {
    const valor = valorMensal(c, cfg);
    const venc = isoDia(c.proximo_vencimento);
    if (c.credito_centavos >= valor) {
      const [n] = await sql(`update clientes set credito_centavos = credito_centavos - $2, proximo_vencimento = $3::date, atualizado_em = now() where id = $1 returning *`,
        [c.id, valor, somarMes(venc)]);
      await anotarHistorico(c.id, "pagamento", `Mensalidade de ${brl(valor)} (vence em ${dataBRdoISO(venc)}) paga com o crédito de indicação.`);
      return { com_credito: true, cliente: n };
    }
    const credito = Math.min(c.credito_centavos ?? 0, Math.max(0, valor - 100)); // a cobrança nunca fica abaixo de R$ 1,00
    const r = await novaCobranca(c, { valor: valor - credito, tipo: "mensalidade", vencimento: venc, credito });
    await mandar(c, "mensalidade", { valorCentavos: valor - credito, vencimento: dataBRdoISO(venc), link: r.link }).catch(() => false);
    return { com_credito: false, link: r.link };
  }

  /** Todo dia (cron): primeira data, cobrança, lembrete, suspensão e o aviso para a loja. `hoje` só muda nos testes. */
  async function cobrarMensalidades({ hoje = hojeSP() } = {}) {
    const cfg = await lerAssinatura();
    const r = { geradas: 0, pagas_com_credito: 0, lembretes: 0, suspensas: 0, reativadas: 0, sincronizadas: 0, erros: 0 };
    for (let c of await sql("select * from clientes where situacao = 'pago' and etapa = 'pronta' order by criado_em")) {
      try {
        if (!cobravel(c, cfg)) {
          if (c.suspensa_em) { c = await reativarAssinatura(c, c.assinatura_isenta ? "isenta de mensalidade" : "sem mensalidade"); r.reativadas += 1; }
          if (await sincronizarAssinatura(c, cfg)) r.sincronizadas += 1;
          continue;
        }
        if (!c.proximo_vencimento) {
          const base = isoDia(c.pronta_em ?? c.atualizado_em ?? c.criado_em);
          [c] = await sql("update clientes set proximo_vencimento = $2::date where id = $1 returning *", [c.id, somarDias(base, cfg.primeira_em_dias)]);
        }
        let pend = await pendenteDe(c.id);
        if (!pend && diasEntre(hoje, isoDia(c.proximo_vencimento)) <= cfg.aviso_antes_dias) {
          const g = await gerarMensalidade(c, cfg);
          if (g.com_credito) { r.pagas_com_credito += 1; c = g.cliente; } else r.geradas += 1;
          pend = await pendenteDe(c.id);
        }
        if (pend) {
          const atraso = diasEntre(pend.venc, hoje);
          if (atraso >= 1 && !pend.lembrete_em) {
            await sql("update pagamentos set lembrete_em = now() where id = $1", [pend.id]);
            await mandar(c, "mensalidade", { valorCentavos: pend.valor_centavos, vencimento: dataBRdoISO(pend.venc), link: cofre.decifrar(pend.link, `pagamento:${pend.id}`), atrasada: true }).catch(() => false);
            r.lembretes += 1;
          }
          if (atraso > cfg.carencia_dias && !c.suspensa_em) { c = await suspender(c, `mensalidade atrasada há ${atraso} dias`); r.suspensas += 1; }
        }
        if (await sincronizarAssinatura(await linha(c.id), cfg)) r.sincronizadas += 1;
      } catch (e) { r.erros += 1; console.error("[mensalidade]", c.id, e.message); }
    }
    return r;
  }

  /** Ações da ficha: valor próprio, vencimento, isenção; cobrar agora; suspender/reativar à mão. */
  async function ajustarAssinatura(id, corpo) {
    const c = await linha(id);
    const campos = {};
    const d = {};
    if (corpo.mensalidade_centavos !== undefined) {
      d.mensalidade_centavos = corpo.mensalidade_centavos === null || corpo.mensalidade_centavos === "" ? null : Math.round(Number(corpo.mensalidade_centavos));
      if (d.mensalidade_centavos !== null && (!Number.isFinite(d.mensalidade_centavos) || d.mensalidade_centavos < 0 || d.mensalidade_centavos > 10_000_000)) campos.mensalidade = "Valor inválido.";
    }
    if (corpo.proximo_vencimento !== undefined) {
      d.proximo_vencimento = String(corpo.proximo_vencimento);
      if (!DATA_ISO.test(d.proximo_vencimento) || !dataValida(d.proximo_vencimento)) campos.proximo_vencimento = "Data inválida.";
    }
    if (corpo.isenta !== undefined) d.assinatura_isenta = Boolean(corpo.isenta);
    if (Object.keys(campos).length) throw new ErroHttp(422, Object.values(campos)[0], campos);
    const chaves = Object.keys(d);
    if (chaves.length) {
      await sql(`update clientes set ${chaves.map((k, i) => `${k} = $${i + 2}`).join(", ")}, atualizado_em = now() where id = $1`, [id, ...chaves.map((k) => d[k])]);
      await anotarHistorico(id, "suporte", `Mensalidade ajustada: ${[
        d.mensalidade_centavos !== undefined && (d.mensalidade_centavos === null ? "valor padrão" : `valor ${brl(d.mensalidade_centavos)}`),
        d.proximo_vencimento && `vencimento ${dataBRdoISO(d.proximo_vencimento)}`,
        d.assinatura_isenta !== undefined && (d.assinatura_isenta ? "isenta" : "volta a pagar"),
      ].filter(Boolean).join(", ")}.`);
      // mudou o vencimento com uma cobrança aberta: a cobrança passa a valer para a data nova
      if (d.proximo_vencimento) await sql("update pagamentos set vencimento = $2::date, lembrete_em = null where cliente_id = $1 and tipo = 'mensalidade' and situacao = 'pendente'", [id, d.proximo_vencimento]);
      if (d.assinatura_isenta) await sql("update pagamentos set situacao = 'cancelado' where cliente_id = $1 and tipo = 'mensalidade' and situacao = 'pendente'", [id]);
    }
    let atual = await linha(id);
    const cfg = await lerAssinatura();
    if (atual.suspensa_em && (!cobravel(atual, cfg) || (await estadoAssinatura({ ...atual, suspensa_em: null }, cfg))?.situacao !== "atrasada")) {
      atual = await reativarAssinatura(atual, "ajuste da mensalidade");
    }
    await sincronizarAssinatura(atual, cfg);
    return detalhe(id);
  }

  async function cobrarMensalidadeAgora(id) {
    let c = await linha(id);
    const cfg = await lerAssinatura();
    if (!cobravel(c, cfg)) throw new ErroHttp(409, c.assinatura_isenta ? "Esta cliente está isenta da mensalidade." : "Esta loja não tem mensalidade (confira o valor em Configurações).");
    if (!c.proximo_vencimento) [c] = await sql("update clientes set proximo_vencimento = $2::date where id = $1 returning *", [id, somarDias(hojeSP(), cfg.aviso_antes_dias)]);
    await gerarMensalidade(c, cfg);
    await sincronizarAssinatura(await linha(id), cfg);
    return detalhe(id);
  }

  async function suspenderAgora(id, suspender_) {
    let c = await linha(id);
    if (c.situacao !== "pago" || c.etapa !== "pronta") throw new ErroHttp(409, "A loja ainda não está no ar.");
    c = suspender_ ? await suspender(c, "à mão, pela Central") : await reativarAssinatura(c, "à mão, pela Central");
    await sincronizarAssinatura(c, await lerAssinatura());
    return detalhe(id);
  }

  /** Quanto entra todo mês com as mensalidades e quantas estão atrasadas. */
  async function recorrencia() {
    const cfg = await lerAssinatura();
    const [r] = await sql(`select
        coalesce(sum(coalesce(mensalidade_centavos, $1)) filter (where not assinatura_isenta), 0)::bigint as mensal,
        count(*) filter (where not assinatura_isenta and coalesce(mensalidade_centavos, $1) > 0)::int as pagantes,
        count(*) filter (where suspensa_em is not null)::int as suspensas
      from clientes where situacao = 'pago' and etapa = 'pronta'`, [cfg.valor_centavos]);
    const [a] = await sql(`select count(*)::int as atrasadas, coalesce(sum(valor_centavos), 0)::bigint as valor from pagamentos
      where tipo = 'mensalidade' and situacao = 'pendente' and vencimento < (now() ${LOCAL})::date`);
    return { mensal_centavos: Number(r.mensal), pagantes: r.pagantes, suspensas: r.suspensas, atrasadas: a.atrasadas, atrasado_centavos: Number(a.valor) };
  }

  /**
   * Funil de vendas das clientes que ENTRARAM no período (cadastro): interessadas -> receberam a cobrança -> pagaram ->
   * loja no ar, com a conversão de cada passo, o tempo até pagar e o resultado de cada pessoa da equipe.
   * `financeiro`: inclui os valores (só para quem vê dinheiro).
   */
  async function funil({ de, ate, financeiro = false } = {}) {
    if (!DATA_ISO.test(String(de)) || !DATA_ISO.test(String(ate)) || !dataValida(de) || !dataValida(ate)) throw new ErroHttp(422, "Escolha as datas do período.");
    if (de > ate) throw new ErroHttp(422, "A data inicial precisa ser antes da final.");
    const linhas = await sql(`select c.situacao, c.etapa, c.cadastrado_por, c.criado_em, c.pronta_em,
        exists (select 1 from pagamentos p where p.cliente_id = c.id) as proposta,
        (select min(p.confirmado_em) from pagamentos p where p.cliente_id = c.id and p.situacao = 'aprovado') as pago_em,
        (select coalesce(sum(p.valor_centavos), 0) from pagamentos p where p.cliente_id = c.id and p.situacao = 'aprovado')::bigint as valor
      from clientes c where (c.criado_em ${LOCAL}) >= $1::date and (c.criado_em ${LOCAL}) < $2::date + 1`, [de, ate]);
    const pagou = (l) => l.situacao === "pago";
    const contagem = { entraram: linhas.length, proposta: linhas.filter((l) => l.proposta).length, pagaram: linhas.filter(pagou).length,
      no_ar: linhas.filter((l) => l.etapa === "pronta").length };
    const NOMES = [["entraram", "Entraram"], ["proposta", "Receberam a cobrança"], ["pagaram", "Pagaram"], ["no_ar", "Loja no ar"]];
    const etapas = NOMES.map(([id, nome], i) => {
      const n = contagem[id];
      const anterior = i ? contagem[NOMES[i - 1][0]] : n;
      return { id, nome, n, pct_do_inicio: contagem.entraram ? Math.round((n / contagem.entraram) * 100) : 0, pct_da_anterior: anterior ? Math.round((n / anterior) * 100) : 0 };
    });
    const horas = (a, b) => (new Date(b) - new Date(a)) / 3_600_000;
    const tempos = linhas.filter((l) => l.pago_em).map((l) => horas(l.criado_em, l.pago_em));
    const media = (xs) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : null);
    const equipe = new Map();
    for (const l of linhas) {
      const quem = l.cadastrado_por || "Sem registro";
      const e = equipe.get(quem) ?? { quem, entraram: 0, pagaram: 0, valor: 0 };
      e.entraram += 1;
      if (pagou(l)) { e.pagaram += 1; e.valor += Number(l.valor); }
      equipe.set(quem, e);
    }
    const porPessoa = [...equipe.values()].map((e) => ({ quem: e.quem, entraram: e.entraram, pagaram: e.pagaram,
      conversao: e.entraram ? Math.round((e.pagaram / e.entraram) * 100) : 0, ...(financeiro && { valor: e.valor }) }))
      .sort((a, b) => b.pagaram - a.pagaram || b.entraram - a.entraram);
    return {
      de, ate, etapas,
      em_aberto: { interessadas: linhas.filter((l) => l.situacao === "interessada").length, aguardando: linhas.filter((l) => l.situacao === "aguardando_pagamento").length },
      canceladas: linhas.filter((l) => l.situacao === "cancelado").length,
      horas_ate_pagar: media(tempos),
      horas_ate_loja: media(linhas.filter((l) => l.pago_em && l.pronta_em).map((l) => horas(l.pago_em, l.pronta_em))),
      por_pessoa: porPessoa,
      ...(financeiro && { valor: linhas.filter(pagou).reduce((s, l) => s + Number(l.valor), 0) }),
    };
  }

  /** O código de indicação da cliente (depois que ela paga), quem ela já trouxe e o crédito que tem. */
  async function indicacao(id) {
    if (!cupons) throw new ErroHttp(503, "Cupons indisponíveis agora.");
    const c = await linha(id);
    if (c.situacao !== "pago") throw new ErroHttp(409, "O código de indicação aparece depois que a cliente paga.");
    const cupom = await cupons.codigoDeIndicacao(c);
    const cfg = await cupons.lerIndicacao();
    const indicadas = await sql("select id, nome_loja, situacao, etapa, criado_em from clientes where indicada_por = $1 order by criado_em desc", [id]);
    return {
      codigo: cupom.codigo, ativo: cupom.ativo, desconto_pct: cfg.desconto_pct, recompensa_centavos: cfg.recompensa_centavos, credito_centavos: c.credito_centavos ?? 0,
      indicadas: indicadas.map((i) => ({ id: i.id, nome_loja: i.nome_loja, situacao: i.situacao, etapa: i.etapa, criado_em: i.criado_em })),
    };
  }

  /** A loja passou a usar outro endereço (domínio próprio ligado ou tirado): a ficha da cliente acompanha. */
  async function atualizarEnderecos(lojaRef, { loja, painel }) {
    const mudadas = await sql(`update clientes set loja_url = $2, painel_url = $3, atualizado_em = now()
      where loja_ref = $1 and (loja_url is distinct from $2 or painel_url is distinct from $3) returning id`, [lojaRef, loja, painel]);
    for (const { id } of mudadas) await anotarHistorico(id, "loja", `Endereço da loja: ${loja}`);
  }

  return {
    lerConfig, salvarConfig, cadastrar, listar, detalhe, atualizar, anotar, confirmarManual, receberAvisoMercadoPago,
    avancar, retomar, paginaDePagamento, reenviar, novoConvite, redefinirSenha, cobrarDeNovo, cancelar, retomarParadas,
    visaoGeral, listarPagamentos, vendas, atualizarEnderecos, lerMetas, salvarMetas, funil, indicacao,
    lerAssinatura, salvarAssinatura, cobrarMensalidades, ajustarAssinatura, cobrarMensalidadeAgora, suspenderAgora,
    registrarNota, lerEmpresa, salvarEmpresa,
  };
}

/* ---------- datas do relatório de vendas ---------- */
const UM_DIA = 86_400_000;
const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/* ---------- datas da mensalidade (dias de calendário, horário de Brasília) ---------- */
/** "AAAA-MM-DD" de um valor do banco: "date" chega como meia-noite; data e hora viram o dia de Brasília. */
export function isoDia(v) {
  if (!(v instanceof Date)) return String(v ?? "").slice(0, 10);
  if (Number.isNaN(v.getTime())) return "";
  const utc = v.toISOString();
  return utc.slice(11, 19) === "00:00:00" ? utc.slice(0, 10) : new Date(v.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
}
export const hojeSP = () => new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);
export const somarDias = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const diasEntre = (de, ate) => Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000);
/** +1 mês no mesmo dia (31/01 -> 28/02; 29/02 -> 29/03). */
export function somarMes(iso) {
  const [a, m, d] = iso.split("-").map(Number);
  const ultimo = new Date(Date.UTC(a, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(a, m, Math.min(d, ultimo))).toISOString().slice(0, 10);
}
const dataBRdoISO = (iso) => (iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : "");
const GRUPOS = {
  hora: { unidade: "hour", formato: "YYYY-MM-DD HH24" },
  dia: { unidade: "day", formato: "YYYY-MM-DD" },
  mes: { unidade: "month", formato: "YYYY-MM" },
  ano: { unidade: "year", formato: "YYYY" },
};
const isoDoDia = (ms) => new Date(ms).toISOString().slice(0, 10);
const dataValida = (d) => isoDoDia(Date.parse(`${d}T00:00:00Z`)) === d; // recusa 2026-02-31

/** Todas as chaves do período (as mesmas que o banco gera), para o gráfico não pular os dias sem venda. */
export function baldesDoPeriodo(g, de, ate) {
  const inicio = Date.parse(`${de}T00:00:00Z`), fim = Date.parse(`${ate}T00:00:00Z`);
  const chaves = [];
  if (g === "hora" || g === "dia") {
    for (let t = inicio; t <= fim && chaves.length <= 24 * 400; t += UM_DIA) {
      const dia = isoDoDia(t);
      if (g === "dia") chaves.push(dia);
      else for (let h = 0; h < 24; h++) chaves.push(`${dia} ${String(h).padStart(2, "0")}`);
    }
    return chaves;
  }
  const [a0, m0] = de.split("-").map(Number), [a1, m1] = ate.split("-").map(Number);
  if (g === "ano") { for (let a = a0; a <= a1; a++) chaves.push(String(a)); return chaves; }
  for (let a = a0, m = m0; a < a1 || (a === a1 && m <= m1); m === 12 ? (a++, m = 1) : m++) chaves.push(`${a}-${String(m).padStart(2, "0")}`);
  return chaves;
}
