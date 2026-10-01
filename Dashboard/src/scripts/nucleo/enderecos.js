/* NÚCLEO — o endereço da loja visto do painel (para "Ver a loja" e para copiar o link de um produto) */
import { caminhoDoProduto } from "../base/dominio.js"; // caminho relativo: também roda nos testes (Node)

/**
 * Endereço da loja: o da publicação (config.js) ou, no site único das lojas, o do próprio painel
 * sem o "-painel" ("doce-painel.vercel.app" -> "doce.vercel.app"; "painel.doce.com.br" -> "doce.com.br").
 */
export function urlDaLoja(cfg = window.CONFIG_APP ?? {}, local = location) {
  const publicada = String(cfg.urlLoja ?? "").replace(/\/+$/, "");
  if (publicada) return publicada;
  if (!cfg.multiloja) return "";
  const host = local.host.includes("-painel.") ? local.host.replace("-painel.", ".") : local.host.startsWith("painel.") ? local.host.slice(7) : "";
  return host ? `${local.protocol}//${host}` : "";
}

/** Link próprio do produto na loja ("" se o endereço da loja não for conhecido). */
export const linkDoProduto = (produto, base = urlDaLoja()) => (base ? base + caminhoDoProduto(produto) : "");
