/* ==========================================================
   SESSÃO — senha de quem administra a Central e o cookie de login.
   • A senha nunca fica guardada: só o resumo (scrypt, lento de propósito
     para dificultar quem tenta adivinhar). Gere com `npm run configurar`.
   • O cookie é assinado (HMAC) com SEGREDO_SESSAO, só vale 8 horas,
     não é lido por JavaScript (HttpOnly) e não viaja para outros sites.
   ========================================================== */
import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const CUSTO = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const derivar = (senha, sal) => new Promise((ok, falhar) =>
  scrypt(String(senha), sal, 32, CUSTO, (erro, chave) => (erro ? falhar(erro) : ok(chave))));

/** "scrypt$<sal>$<resumo>" (hex). */
export async function resumirSenha(senha) {
  const sal = randomBytes(16);
  return `scrypt$${sal.toString("hex")}$${(await derivar(senha, sal)).toString("hex")}`;
}

export async function conferirSenha(senha, guardado) {
  const [tipo, sal, resumo] = String(guardado ?? "").split("$");
  if (tipo !== "scrypt" || !sal || !resumo) return false;
  const calculado = await derivar(senha, Buffer.from(sal, "hex"));
  const esperado = Buffer.from(resumo, "hex");
  return esperado.length === calculado.length && timingSafeEqual(esperado, calculado);
}

export const NOME_COOKIE = "forminha_sessao";
export const DURACAO_S = 8 * 60 * 60;

const assinar = (texto, segredo) => createHmac("sha256", segredo).update(texto).digest("base64url");

export function criarSessao(segredo, agora = Date.now()) {
  const corpo = Buffer.from(JSON.stringify({ exp: Math.floor(agora / 1000) + DURACAO_S })).toString("base64url");
  return `${corpo}.${assinar(corpo, segredo)}`;
}

export function sessaoValida(valor, segredo, agora = Date.now()) {
  const [corpo, assinatura] = String(valor ?? "").split(".");
  if (!corpo || !assinatura || !segredo) return false;
  const esperado = Buffer.from(assinar(corpo, segredo));
  const recebido = Buffer.from(assinatura);
  if (esperado.length !== recebido.length || !timingSafeEqual(esperado, recebido)) return false;
  try { return JSON.parse(Buffer.from(corpo, "base64url").toString()).exp > agora / 1000; } catch { return false; }
}

export function lerCookie(cabecalho, nome) {
  for (const parte of String(cabecalho ?? "").split(";")) {
    const [k, ...v] = parte.trim().split("=");
    if (k === nome) return v.join("=");
  }
  return null;
}

export const cookieDeSessao = (valor, seguro) =>
  `${NOME_COOKIE}=${valor}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${DURACAO_S}${seguro ? "; Secure" : ""}`;
export const cookieDeSaida = (seguro) => `${NOME_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${seguro ? "; Secure" : ""}`;
