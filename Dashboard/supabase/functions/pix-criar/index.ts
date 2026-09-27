// Gera o PIX (QR Code) de um pedido no Mercado Pago. Rode: supabase functions deploy pix-criar
import { criarServidor } from "../_shared/comum.js";
import { criarPix } from "./logica.js";

Deno.serve(criarServidor(criarPix, ["SUPABASE_URL", "SUPABASE_ANON_KEY", "MP_ACCESS_TOKEN", "ORIGENS_PERMITIDAS"]));
