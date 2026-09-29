/* ==========================================================
   DOMÍNIOS — o endereço próprio de uma loja (ex.: suadoceria.com.br).
   Aqui ficam só as regras de texto: conferir o domínio digitado,
   achar a "raiz", quais endereços ele ocupa e o registro de DNS de
   cada um. Quem fala com a Vercel e com o Supabase é lojas.js.
   ========================================================== */
import { ErroHttp } from "./erros.js";

// finais com 2 partes: o domínio de verdade fica um nível antes (doce.com.br, e não com.br)
const DOIS_NIVEIS = new Set([
  "com.br", "net.br", "org.br", "art.br", "blog.br", "eco.br", "emp.br", "ind.br", "inf.br", "log.br", "ong.br", "rec.br", "srv.br", "tec.br",
  "tur.br", "adv.br", "arq.br", "eng.br", "med.br", "vet.br", "pro.br", "fot.br", "nom.br", "app.br", "dev.br", "leg.br", "gov.br", "edu.br",
  "com.pt", "co.uk", "com.ar", "com.mx", "com.co", "com.uy", "com.py",
]);
// endereços que não são de ninguém em particular (e os dos próprios serviços)
const PROIBIDOS = /(^|\.)(vercel\.app|vercel\.com|vercel\.dev|supabase\.co|supabase\.com|localhost)$/;
const PARTE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** O que a Vercel usa quando ela mesma não recomenda outro valor. */
export const IP_PADRAO = "76.76.21.21";
export const CNAME_PADRAO = "cname.vercel-dns.com";

/**
 * Deixa o domínio digitado no formato certo: sem "https://", sem "www.", sem barra, em minúsculas
 * e com acentos convertidos (doçura.com.br vira xn--doura-zra.com.br, como a internet entende).
 * `reservados`: domínios que nenhuma loja pode usar (o da própria Central, por exemplo).
 */
export function normalizarDominio(texto, { reservados = [] } = {}) {
  const erro = (msg) => new ErroHttp(422, msg, { dominio: msg });
  let t = String(texto ?? "").trim().toLowerCase();
  if (!t) throw erro("Digite o domínio. Exemplo: suadoceria.com.br");
  t = t.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").split(/[/?#\s]/)[0].replace(/\.+$/, "");
  let host;
  try { host = new URL(`http://${t}`).hostname; } catch { throw erro("Esse domínio não parece certo. Exemplo: suadoceria.com.br"); }
  if (/@/.test(t)) throw erro("Digite só o domínio, sem e-mail. Exemplo: suadoceria.com.br");
  host = host.replace(/^www\./, "");
  const partes = host.split(".");
  const final = partes.at(-1);
  if (partes.length < 2 || host.length > 253 || !partes.every((p) => PARTE.test(p)) || !(/^[a-z]{2,24}$/.test(final) || /^xn--[a-z0-9-]+$/.test(final))) {
    throw erro("Esse domínio não parece certo. Exemplo: suadoceria.com.br");
  }
  if (DOIS_NIVEIS.has(host)) throw erro("Falta o nome antes do final. Exemplo: suadoceria.com.br");
  if (PROIBIDOS.test(host)) throw erro("Use um domínio seu, comprado no Registro.br ou em outro site de domínios.");
  if (reservados.some((r) => r && (host === r || host.endsWith(`.${r}`)))) throw erro("Esse domínio é reservado. Use um domínio seu.");
  return host;
}

/** A raiz do domínio (onde os registros de DNS são criados): loja.doce.com.br -> doce.com.br. */
export function raizDoDominio(host) {
  const partes = String(host).split(".");
  return partes.slice(DOIS_NIVEIS.has(partes.slice(-2).join(".")) ? -3 : -2).join(".");
}

/**
 * Os endereços que o domínio ocupa: a loja no próprio domínio, o "www" (só na raiz; leva para o
 * endereço principal) e, se a dona quiser, "painel." para o painel dela.
 */
export function enderecosDoDominio(dominio, { painel = true } = {}) {
  const lista = [{ host: dominio, site: "loja" }];
  if (raizDoDominio(dominio) === dominio) lista.push({ host: `www.${dominio}`, site: "loja", redirecionar: dominio });
  if (painel) lista.push({ host: `painel.${dominio}`, site: "painel" });
  return lista;
}

/** O nome do registro como os sites de domínio pedem: "@" na raiz; senão, o pedaço antes da raiz ("www", "painel"). */
export const nomeNoDns = (host, raiz) => (host === raiz ? "@" : String(host).slice(0, -(raiz.length + 1)));

const primeiro = (lista) => [...(Array.isArray(lista) ? lista : [])].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))[0]?.value;

/** O registro que aponta o endereço para a Vercel: "A" na raiz, "CNAME" nos demais (com o valor que a Vercel recomenda). */
export function registroDoEndereco(host, raiz, config) {
  if (host === raiz) {
    const ip = primeiro(config?.recommendedIPv4);
    return { tipo: "A", nome: "@", valor: (Array.isArray(ip) ? ip[0] : ip) || IP_PADRAO };
  }
  return { tipo: "CNAME", nome: nomeNoDns(host, raiz), valor: String(primeiro(config?.recommendedCNAME) || CNAME_PADRAO).replace(/\.$/, "") };
}
