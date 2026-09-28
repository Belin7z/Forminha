/* ==========================================================
   MERCADO PAGO — PIX automático (opcional: só com MP_ACCESS_TOKEN).
   A cobrança leva a referência do pagamento da Central; quando o
   Mercado Pago avisa, NADA do aviso é aceito "de boca": o pagamento
   é consultado de novo na API do Mercado Pago antes de valer.
   ========================================================== */
import { createHmac, timingSafeEqual } from "node:crypto";

/** "2026-09-22T10:30:00.000-03:00" — o formato de validade que o Mercado Pago pede. */
export const validadeMercadoPago = (data) => new Date(data.getTime() - 3 * 3600 * 1000).toISOString().replace("Z", "-03:00");

export function criarMercadoPago({ token, fetchFn = fetch }) {
  const api = async (metodo, caminho, corpo, extras = {}) => {
    const r = await fetchFn(`https://api.mercadopago.com${caminho}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${token}`, ...(corpo && { "Content-Type": "application/json" }), ...extras },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    const dados = await r.json().catch(() => ({}));
    return { status: r.status, ok: r.ok, dados };
  };
  return {
    /** PIX com QR Code. `chaveUnica` evita cobrança dobrada se o pedido for repetido. */
    async criarCobranca({ valorCentavos, descricao, email, referencia, notificacao, chaveUnica, horas = 48 }) {
      const expira = new Date(Date.now() + horas * 3600 * 1000);
      const r = await api("POST", "/v1/payments", {
        transaction_amount: valorCentavos / 100, description: descricao, payment_method_id: "pix",
        payer: { email }, external_reference: referencia, notification_url: notificacao, date_of_expiration: validadeMercadoPago(expira),
      }, { "X-Idempotency-Key": chaveUnica });
      const t = r.dados?.point_of_interaction?.transaction_data;
      if (!r.ok || !t?.qr_code) throw new Error(`Mercado Pago recusou a cobrança (${r.status}): ${r.dados?.message ?? "sem detalhes"}`);
      return { id: String(r.dados.id), copiaCola: t.qr_code, qrBase64: t.qr_code_base64 ?? "" };
    },
    async consultar(id) {
      const r = await api("GET", `/v1/payments/${encodeURIComponent(id)}`);
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`Mercado Pago não respondeu (${r.status}).`);
      return r.dados;
    },
  };
}

/** Assinatura do aviso (cabeçalho x-signature), como na documentação do Mercado Pago. */
export function assinaturaValida({ cabecalhos, dataId, segredo }) {
  const partes = Object.fromEntries(String(cabecalhos["x-signature"] ?? "").split(",").map((p) => p.trim().split("=")).filter((x) => x.length === 2));
  if (!partes.ts || !partes.v1 || !dataId || !segredo) return false;
  const id = /^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId;
  const manifesto = `id:${id};request-id:${cabecalhos["x-request-id"] ?? ""};ts:${partes.ts};`;
  const esperado = Buffer.from(createHmac("sha256", segredo).update(manifesto).digest("hex"));
  const recebido = Buffer.from(String(partes.v1));
  return esperado.length === recebido.length && timingSafeEqual(esperado, recebido);
}
