/* ==========================================================
   FUNÇÃO cartao-criar — abre o checkout do Mercado Pago para o
   cliente pagar um pedido com cartão de crédito ou débito.
   O valor NUNCA vem da tela: é lido do próprio pedido, no banco.
   A confirmação chega pela mesma função do PIX (pix-webhook).
   Segredos: MP_ACCESS_TOKEN, ORIGENS_PERMITIDAS.
   ========================================================== */
import { bearer, erroDoBanco, origemPermitida, resposta, valorDevido } from "../_shared/comum.js";

export async function criarCheckoutCartao(req, { env, fetchFn, rpc }) {
  if (req.metodo === "OPTIONS") return resposta(204);
  if (req.metodo !== "POST") return resposta(405, { erro: "Método não permitido." });
  const jwt = bearer(req.cabecalhos);
  if (!jwt) return resposta(401, { erro: "Faça login para continuar." });
  if (!env.MP_ACCESS_TOKEN) return resposta(503, { erro: "O pagamento com cartão ainda não foi configurado." });

  let corpo = {};
  try { corpo = JSON.parse(req.corpoTexto || "{}"); } catch { return resposta(400, { erro: "Pedido inválido." }); }
  const codigo = String(corpo.codigo ?? "");
  if (!/^LA\d{1,12}$/.test(codigo)) return resposta(422, { erro: "Código do pedido inválido." });

  let pedido, eu, config;
  try {
    ({ pedido } = await rpc("cliente_pedido", { codigo }, jwt)); // só enxerga pedido do próprio cliente
    eu = await rpc("perfil_atual", {}, jwt);
    config = await rpc("loja_config", {}, null);
  } catch (e) { return erroDoBanco(e); }

  if (!config?.pagamento?.cartao_online) return resposta(409, { erro: "O pagamento com cartão está desligado nesta loja." });
  if (["cancelado", "entregue"].includes(pedido.status)) return resposta(409, { erro: "Este pedido não recebe mais pagamento." });
  const devido = valorDevido(pedido);
  if (devido <= 0) return resposta(409, { erro: "Este pedido já está pago." });

  // depois de pagar, o cliente volta para a página do pedido (só se for um endereço da própria loja)
  const origem = origemPermitida(corpo.voltar, env.ORIGENS_PERMITIDAS);
  const volta = origem ? `${origem}/#/pedido/${codigo}` : null;
  const nomeLoja = String(config?.loja?.nome ?? "").normalize("NFD").replace(/[^\w ]/g, "").slice(0, 22);

  const r = await fetchFn("https://api.mercadopago.com/checkout/preferences", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}`, "Content-Type": "application/json", "X-Idempotency-Key": `cartao-${codigo}-${devido}-${pedido.pago}` },
    body: JSON.stringify({
      items: [{ id: codigo, title: `Pedido ${codigo}${nomeLoja ? ` · ${nomeLoja}` : ""}`, quantity: 1, unit_price: devido / 100, currency_id: "BRL" }],
      payer: { email: eu.email }, external_reference: codigo,
      notification_url: `${env.SUPABASE_URL}/functions/v1/pix-webhook`,
      payment_methods: { excluded_payment_types: [{ id: "ticket" }, { id: "atm" }], installments: 12 },
      ...(nomeLoja && { statement_descriptor: nomeLoja }),
      ...(volta && { back_urls: { success: volta, pending: volta, failure: volta }, auto_return: "approved" }),
      expires: true, expiration_date_to: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    }),
  });
  const dados = await r.json().catch(() => ({}));
  if (!r.ok || !dados?.init_point) {
    console.error("[mercadopago] falha ao abrir o checkout", r.status, JSON.stringify(dados).slice(0, 400));
    return resposta(502, { erro: "Não foi possível abrir o pagamento com cartão agora. Tente de novo ou pague com PIX." });
  }
  return resposta(200, { url: dados.init_point, valor: devido });
}
