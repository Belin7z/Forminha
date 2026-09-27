// Avisa o cliente pelo WhatsApp oficial. Rode: supabase functions deploy whatsapp-avisar
import { criarServidor } from "../_shared/comum.js";
import { avisarWhatsapp } from "./logica.js";

Deno.serve(criarServidor(avisarWhatsapp, ["SUPABASE_URL", "SUPABASE_ANON_KEY", "WHATSAPP_TOKEN", "WHATSAPP_PHONE_ID", "URL_LOJA", "ORIGENS_PERMITIDAS"]));
