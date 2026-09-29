// Recebe o aviso de pagamento do Mercado Pago. Precisa ser público: supabase functions deploy pix-webhook --no-verify-jwt
import { criarServidor } from "../_shared/comum.js";
import { receberWebhook } from "./logica.js";

Deno.serve(criarServidor(receberWebhook, ["SUPABASE_URL", "SUPABASE_ANON_KEY", "MP_ACCESS_TOKEN", "SEGREDO_GATEWAY", "MP_WEBHOOK_SECRET"]));
