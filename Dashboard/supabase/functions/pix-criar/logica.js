/* ==========================================================
   FUNÇÃO pix-criar — gera o PIX (QR Code + copia e cola) de um
   pedido no Mercado Pago. Chamada pela loja com o login do cliente.
   O valor NUNCA vem da tela: é lido do próprio pedido, no banco.
   Segredos: MP_ACCESS_TOKEN.
   ========================================================== */
import { CODIGO_DO_PEDIDO, bearer, enderecoDoAviso, envDaLoja, erroDoBanco, resposta, valorDevido } from "../_shared/comum.js";

export { valorDevido };

/** "2026-09-22T10:30:00.000-03:00" — o formato que o Mercado Pago pede para a validade. */
export function validadeMercadoPago(data) {
  return new Date(data.getTime() - 3 * 3600 * 1000).toISOString().replace("Z", "-03:00");
}


export async function criarPix(req, { env: ambiente, fetchFn, rpc, loja }) {
  if (req.metodo === "OPTIONS") return resposta(204);
  if (req.metodo !== "POST") return resposta(405, { erro: "Método não permitido." });
  const jwt = bearer(req.cabecalhos);
  if (!jwt) return resposta(401, { erro: "Faça login para continuar." });
  let env;
  try { env = await envDaLoja({ env: ambiente, rpc, loja }); } catch (e) { return erroDoBanco(e); } // banco único: as chaves DESTA loja
  if (!env.MP_ACCESS_TOKEN) return resposta(503, { erro: "O PIX automático ainda não foi configurado." });

  let corpo = {};
  try { corpo = JSON.parse(req.corpoTexto || "{}"); } catch { return resposta(400, { erro: "Pedido inválido." }); }
  const codigo = String(corpo.codigo ?? "");
  if (!CODIGO_DO_PEDIDO.test(codigo)) return resposta(422, { erro: "Código do pedido inválido." });

  let pedido, eu, config;
  try {
    ({ pedido } = await rpc("cliente_pedido", { codigo }, jwt)); // só enxerga pedido do próprio cliente
    eu = await rpc("perfil_atual", {}, jwt);
    config = await rpc("loja_config", {}, null);
  } catch (e) { return erroDoBanco(e); }

  if (!config?.pagamento?.pix_automatico) return resposta(409, { erro: "O PIX automático está desligado. Use o código de pagamento." });
  if (["cancelado", "entregue"].includes(pedido.status)) return resposta(409, { erro: "Este pedido não recebe mais pagamento." });
  const devido = valorDevido(pedido);
  if (devido <= 0) return resposta(409, { erro: "Este pedido já está pago." });

  const expira = new Date(Date.now() + 30 * 60 * 1000);
  const r = await fetchFn("https://api.mercadopago.com/v1/payments", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.MP_ACCESS_TOKEN}`, "Content-Type": "application/json",
      // mesma chave = mesmo pagamento: clicar duas vezes não gera dois PIX
      "X-Idempotency-Key": `${codigo}-${devido}-${pedido.pago}`,
    },
    body: JSON.stringify({
      transaction_amount: devido / 100, description: `Pedido ${codigo}`, payment_method_id: "pix",
      payer: { email: eu.email }, external_reference: codigo,
      notification_url: enderecoDoAviso(env), date_of_expiration: validadeMercadoPago(expira),
    }),
  });
  const dados = await r.json().catch(() => ({}));
  const t = dados?.point_of_interaction?.transaction_data;
  if (!r.ok || !t?.qr_code) {
    console.error("[mercadopago] falha ao criar pagamento", r.status, JSON.stringify(dados).slice(0, 400));
    return resposta(502, { erro: "Não foi possível gerar o PIX agora. Use o código de pagamento ou tente de novo." });
  }
  return resposta(200, { id: String(dados.id), valor: devido, qr_code: t.qr_code, qr_code_base64: t.qr_code_base64 ?? "", expira_em: dados.date_of_expiration ?? validadeMercadoPago(expira) });
}
