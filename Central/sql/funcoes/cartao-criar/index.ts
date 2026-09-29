// Abre o checkout de cartão do Mercado Pago para um pedido. Rode: supabase functions deploy cartao-criar --no-verify-jwt
import { criarServidor } from "../_shared/comum.js";
import { criarCheckoutCartao } from "./logica.js";

Deno.serve(criarServidor(criarCheckoutCartao, ["SUPABASE_URL", "SUPABASE_ANON_KEY", "MP_ACCESS_TOKEN", "ORIGENS_PERMITIDAS"]));
