/* NÚCLEO — conexão do painel com o Supabase (configuração vem de config.js) */
import { criarClienteSupabase } from "/src/scripts/base/api/nucleo.js";
import { criarApiPainel } from "/src/scripts/base/api/painel.js";

const cfg = window.CONFIG_APP ?? {};

export const supabase = criarClienteSupabase({ url: cfg.supabaseUrl, chave: cfg.supabaseAnonKey, storageKey: "sb-painel-auth" });

// o e-mail de redefinição enviado a um cliente leva para a loja
export const api = criarApiPainel(supabase, { urlLoja: cfg.urlLoja || undefined });
