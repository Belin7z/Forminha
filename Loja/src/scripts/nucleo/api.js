/* NÚCLEO — conexão da loja com o Supabase (configuração vem de config.js) */
import { criarClienteSupabase } from "/src/scripts/base/api/nucleo.js";
import { criarApiLoja } from "/src/scripts/base/api/loja.js";

const cfg = window.CONFIG_APP ?? {};

// um site para várias lojas (banco único): a loja é a do endereço aberto
const loja = cfg.multiloja ? location.hostname : "";

export const supabase = criarClienteSupabase({ url: cfg.supabaseUrl, chave: cfg.supabaseAnonKey, storageKey: "sb-loja-auth", loja });

// o link do e-mail "esqueci a senha" volta para esta mesma loja
export const api = criarApiLoja(supabase, { urlRecuperacao: `${location.origin}${location.pathname}`, loja });
