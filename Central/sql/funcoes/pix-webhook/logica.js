/* ==========================================================
   FUNÇÃO pix-webhook — o Mercado Pago avisa aqui quando um PIX ou
   um cartão é pago. Nada do aviso é aceito "de boca": conferimos o
   pagamento direto na API do Mercado Pago e só então registramos.
   Segredos: MP_ACCESS_TOKEN, SEGREDO_GATEWAY (a chave gerada no
   Dashboard) e, se quiser, MP_WEBHOOK_SECRET (assinatura do aviso).
   ========================================================== */
import { resposta } from "../_shared/comum.js";

const codificar = (t) => new TextEncoder().encode(t);
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** Confere a assinatura do aviso (cabeçalho x-signature) como descrito na documentação do Mercado Pago. */
export async function assinaturaValida({ cabecalhos, dataId, segredo }) {
  const partes = Object.fromEntries(String(cabecalhos["x-signature"] ?? "").split(",").map((p) => p.trim().split("=")).filter((x) => x.length === 2));
  if (!partes.ts || !partes.v1 || !dataId) return false;
  const id = /^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId;
  const manifesto = `id:${id};request-id:${cabecalhos["x-request-id"] ?? ""};ts:${partes.ts};`;
  const chave = await crypto.subtle.importKey("raw", codificar(segredo), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const esperado = hex(await crypto.subtle.sign("HMAC", chave, codificar(manifesto)));
  if (esperado.length !== partes.v1.length) return false;
  let diferenca = 0; // comparação em tempo constante
  for (let i = 0; i < esperado.length; i++) diferenca |= esperado.charCodeAt(i) ^ partes.v1.charCodeAt(i);
  return diferenca === 0;
}

/** PIX vira "pix_auto"; cartão de crédito ou débito vira "cartao_online"; o resto (boleto etc.) não conta aqui. */
export function formaDoPagamento(pag) {
  if (pag.payment_method_id === "pix") return "pix_auto";
  if (["credit_card", "debit_card", "prepaid_card"].includes(pag.payment_type_id)) return "cartao_online";
  return null;
}

export async function receberWebhook(req, { env, fetchFn, rpc }) {
  if (req.metodo !== "POST") return resposta(405, { erro: "Método não permitido." });
  if (!env.MP_ACCESS_TOKEN || !env.SEGREDO_GATEWAY) return resposta(503, { erro: "Integração ainda não configurada." });

  const url = new URL(req.url);
  let corpo = {};
  try { corpo = JSON.parse(req.corpoTexto || "{}"); } catch { /* o Mercado Pago às vezes manda só a query */ }
  const tipo = url.searchParams.get("type") ?? corpo.type ?? url.searchParams.get("topic");
  const dataId = String(url.searchParams.get("data.id") ?? corpo?.data?.id ?? "");
  if (tipo !== "payment" || !dataId) return resposta(200, { ok: true, ignorado: true });

  if (env.MP_WEBHOOK_SECRET && !(await assinaturaValida({ cabecalhos: req.cabecalhos, dataId, segredo: env.MP_WEBHOOK_SECRET }))) {
    return resposta(401, { erro: "Assinatura inválida." });
  }

  // o aviso só diz "o pagamento X mudou": quem confirma é a API do Mercado Pago
  const r = await fetchFn(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(dataId)}`, { headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}` } });
  if (r.status === 404) return resposta(200, { ok: true, ignorado: true }); // aviso de teste ou pagamento de outra conta
  if (!r.ok) return resposta(500, { erro: "Não consegui conferir o pagamento agora." }); // o Mercado Pago tenta de novo
  const pag = await r.json();
  const forma = formaDoPagamento(pag);
  if (pag.status !== "approved" || !forma) return resposta(200, { ok: true, estado: pag.status });

  try {
    const resultado = await rpc("gateway_registrar_pagamento", {
      segredo: env.SEGREDO_GATEWAY, codigo: String(pag.external_reference ?? ""), valor: Math.round(Number(pag.transaction_amount) * 100), id_externo: `mp:${pag.id}`, forma,
    }, null);
    return resposta(200, resultado);
  } catch (e) {
    if (e.status === 404 || e.status === 422) return resposta(200, { ok: true, ignorado: true }); // pedido que não é desta loja: não adianta insistir
    console.error("[pix-webhook] banco recusou", e.status, e.message);
    return resposta(500, { erro: "Não foi possível registrar o pagamento agora." });
  }
}
