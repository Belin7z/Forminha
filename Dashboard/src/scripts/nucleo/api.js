/* NÚCLEO — conexão do painel com o Supabase (configuração vem de config.js) */
import { criarClienteSupabase } from "/src/scripts/base/api/nucleo.js";
import { criarApiPainel } from "/src/scripts/base/api/painel.js";

const cfg = window.CONFIG_APP ?? {};

// um site para várias lojas (banco único): a loja é a do endereço aberto
const loja = cfg.multiloja ? location.hostname : "";

export const supabase = criarClienteSupabase({ url: cfg.supabaseUrl, chave: cfg.supabaseAnonKey, storageKey: "sb-painel-auth", loja });

// o e-mail de redefinição enviado a um cliente leva para a loja
export const api = criarApiPainel(supabase, { urlLoja: cfg.urlLoja || undefined, loja });
