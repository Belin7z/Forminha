/* ==========================================================
   AMBIENTE — lê as configurações (variáveis de ambiente) e
   confere se estão certas ANTES de publicar o site.
     SUPABASE_URL       endereço do projeto Supabase
     SUPABASE_ANON_KEY  chave pública (anon / publishable)
     URL_LOJA           (opcional, só no Dashboard) endereço público da Loja
   Localmente podem ficar num arquivo .env dentro da pasta do site.
   Na Vercel são cadastradas em Settings > Environment Variables.
   ========================================================== */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Carrega o arquivo .env da pasta (se existir) sem sobrescrever variáveis já definidas. */
export function carregarAmbiente(pasta) {
  const arquivo = join(pasta, ".env");
  if (!existsSync(arquivo)) return;
  for (const linha of readFileSync(arquivo, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(linha);
    if (!m || linha.trimStart().startsWith("#")) continue;
    const valor = m[2].replace(/^(['"])(.*)\1$/, "$2");
    if (process.env[m[1]] === undefined) process.env[m[1]] = valor;
  }
}

function papelDaChave(chave) {
  const partes = chave.split(".");
  if (partes.length !== 3) return null;
  try { return JSON.parse(Buffer.from(partes[1], "base64url").toString()).role ?? null; }
  catch { return null; }
}

/** Confere e devolve a configuração de um site ("loja" ou "dashboard"). Lança um Error com texto claro em português. */
export function configDoApp(app, env = process.env) {
  const url = String(env.SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
  const chave = String(env.SUPABASE_ANON_KEY ?? "").trim();
  const urlLoja = String(env.URL_LOJA ?? "").trim().replace(/\/+$/, "");

  const faltando = [!url && "SUPABASE_URL", !chave && "SUPABASE_ANON_KEY"].filter(Boolean);
  if (faltando.length) {
    throw new Error(`Falta configurar: ${faltando.join(" e ")}.\n  Cadastre em Vercel > Settings > Environment Variables (veja docs/PUBLICAR.md no repositório do Dashboard).`);
  }
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url)) {
    throw new Error(`SUPABASE_URL inválida: "${url}". Use algo como https://abcdefgh.supabase.co`);
  }
  // segurança: a chave secreta NUNCA pode ir para o navegador
  if (chave.startsWith("sb_secret_") || papelDaChave(chave) === "service_role") {
    throw new Error("SUPABASE_ANON_KEY está com a chave SECRETA (service_role). Use a chave pública \"anon\" — a secreta daria acesso total ao banco a qualquer visitante.");
  }
  if (urlLoja && !/^https?:\/\/[^\s]+$/.test(urlLoja)) throw new Error(`URL_LOJA inválida: "${urlLoja}".`);

  return { supabaseUrl: url, supabaseAnonKey: chave, urlLoja: app === "dashboard" ? urlLoja : "" };
}

/** Conteúdo do config.js que o navegador carrega antes do site. */
export const textoDoConfig = (cfg) => `window.CONFIG_APP = Object.freeze(${JSON.stringify(cfg)});\n`;
