/* ==========================================================
   FUNÇÃO whatsapp-avisar — manda o aviso de pedido para o cliente
   (e o aviso de estoque para a dona) pelo WhatsApp oficial (Meta
   Cloud API), usando modelo aprovado.
   Chamada pelo Dashboard, com o login da equipe. Quem decide se o
   aviso deve sair (e para qual número) é o banco.
   Segredos: WHATSAPP_TOKEN, WHATSAPP_PHONE_ID e URL_LOJA (endereço
   da loja, para o link de acompanhamento).
   ========================================================== */
import { bearer, erroDoBanco, resposta } from "../_shared/comum.js";

/** Traduz os erros mais comuns da Meta para o que a pessoa da loja precisa saber. */
export function traduzirErroMeta(erro = {}) {
  const codigo = Number(erro.code);
  const detalhe = erro.error_data?.details ?? erro.message ?? "";
  const mapa = {
    190: "A chave do WhatsApp venceu ou está errada. Gere uma nova no Meta e atualize o segredo WHATSAPP_TOKEN.",
    131030: "Este número não está autorizado no modo de teste da Meta. Adicione-o na lista de números de teste ou finalize a configuração da conta.",
    131026: "Este número não tem WhatsApp ou não pôde receber a mensagem.",
    131042: "Há um problema com a forma de pagamento da conta do WhatsApp Business.",
    132000: "Os campos do modelo não batem. O modelo precisa de 4 variáveis no texto: {{1}} nome, {{2}} código, {{3}} quando e {{4}} link.",
    132001: "O modelo de mensagem não existe ou ainda não foi aprovado. Confira o nome em Configurações → Integrações e no Meta.",
    132005: "O texto do modelo ficou grande demais depois de preenchido.",
    132012: "O formato dos campos do modelo está diferente do cadastrado no Meta.",
    130429: "Limite de mensagens do WhatsApp atingido. Tente daqui a pouco.",
  };
  return mapa[codigo] ?? `O WhatsApp recusou o envio${detalhe ? `: ${String(detalhe).slice(0, 160)}` : "."}`;
}

/** Manda um modelo aprovado pela Meta. Devolve { ok, id } ou { ok: false, erro } (já em português). */
async function enviarModelo({ env, fetchFn, telefone, modelo, idioma, parametros }) {
  const r = await fetchFn(`https://graph.facebook.com/v21.0/${encodeURIComponent(env.WHATSAPP_PHONE_ID)}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp", to: telefone, type: "template",
      template: { name: modelo, language: { code: idioma }, components: [{ type: "body", parameters: parametros.map((t) => ({ type: "text", text: String(t).slice(0, 1000) })) }] },
    }),
  });
  const resp = await r.json().catch(() => ({}));
  const id = resp?.messages?.[0]?.id;
  if (r.ok && id) return { ok: true, id };
  console.error("[whatsapp] falha", r.status, JSON.stringify(resp).slice(0, 400));
  return { ok: false, erro: traduzirErroMeta(resp?.error) };
}

/** Aviso de estoque para a dona (o Dashboard pergunta de tempos em tempos; o banco decide se há algo novo). */
async function avisarEstoque({ env, fetchFn, rpc, jwt }) {
  let dados;
  try { dados = await rpc("admin_estoque_aviso_dados", {}, jwt); }
  catch (e) { return erroDoBanco(e); }
  if (!dados.enviar) return resposta(200, { enviado: false, motivo: dados.motivo });
  const registrar = (estado, detalhe) => rpc("admin_estoque_aviso_registrar", { estado, detalhe, resumo: dados.resumo, itens: dados.itens }, jwt)
    .catch((e) => console.error("[aviso-estoque] não registrou", e.message));
  if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_ID) {
    const erro = "O WhatsApp ainda não foi configurado (faltam as chaves nos Secrets do Supabase).";
    await registrar("erro", erro);
    return resposta(503, { erro });
  }
  const r = await enviarModelo({ env, fetchFn, telefone: dados.telefone, modelo: dados.modelo, idioma: dados.idioma, parametros: dados.variaveis });
  await registrar(r.ok ? "enviado" : "erro", r.ok ? r.id : r.erro);
  return resposta(200, r.ok ? { enviado: true } : { enviado: false, erro: r.erro });
}

export async function avisarWhatsapp(req, { env, fetchFn, rpc }) {
  if (req.metodo === "OPTIONS") return resposta(204);
  if (req.metodo !== "POST") return resposta(405, { erro: "Método não permitido." });
  const jwt = bearer(req.cabecalhos);
  if (!jwt) return resposta(401, { erro: "Faça login para continuar." });

  let corpo = {};
  try { corpo = JSON.parse(req.corpoTexto || "{}"); } catch { return resposta(400, { erro: "Pedido inválido." }); }
  if (corpo.tipo === "estoque") return avisarEstoque({ env, fetchFn, rpc, jwt });
  const pedidoId = String(corpo.pedido_id ?? ""), evento = String(corpo.evento ?? "");
  if (!/^\d{1,15}$/.test(pedidoId)) return resposta(422, { erro: "Pedido inválido." });

  let dados;
  try { dados = await rpc("admin_aviso_dados", { id: pedidoId, evento, forcar: corpo.forcar === true }, jwt); } // o banco confere que é da equipe
  catch (e) { return erroDoBanco(e); }
  if (!dados.enviar) return resposta(200, { enviado: false, motivo: dados.motivo });
  // só cobra as chaves quando há mesmo um aviso para mandar (quem não usa WhatsApp nunca vê erro)
  if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_ID) return resposta(503, { erro: "O WhatsApp ainda não foi configurado (faltam as chaves nos Secrets do Supabase)." });

  const base = String(env.URL_LOJA ?? "").replace(/\/+$/, "");
  const parametros = [...dados.variaveis, base ? `${base}/#/pedido/${dados.codigo}` : `pedido ${dados.codigo}`];
  const r = await enviarModelo({ env, fetchFn, telefone: dados.telefone, modelo: dados.modelo, idioma: dados.idioma, parametros });
  const registrar = (estado, detalhe) => rpc("admin_aviso_registrar", { pedido_id: pedidoId, evento, estado, detalhe }, jwt).catch((e) => console.error("[aviso] não registrou", e.message));

  if (r.ok) {
    await registrar("enviado", r.id);
    return resposta(200, { enviado: true });
  }
  await registrar("erro", r.erro);
  return resposta(200, { enviado: false, erro: r.erro });
}
