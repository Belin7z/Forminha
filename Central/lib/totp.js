/* ==========================================================
   TOTP — os códigos de 6 dígitos que mudam a cada 30 segundos
   (Google Authenticator, Microsoft Authenticator, Authy…), no
   padrão RFC 6238 (HMAC-SHA1). O segredo é mostrado uma vez como
   QR Code e fica guardado criptografado.
   ========================================================== */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32(bytes) {
  let bits = 0, valor = 0, saida = "";
  for (const b of bytes) {
    valor = (valor << 8) | b; bits += 8;
    while (bits >= 5) { saida += BASE32[(valor >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) saida += BASE32[(valor << (5 - bits)) & 31];
  return saida;
}

export function deBase32(texto) {
  const limpo = String(texto).toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0, valor = 0;
  const bytes = [];
  for (const c of limpo) {
    const i = BASE32.indexOf(c);
    if (i < 0) throw new Error("segredo inválido");
    valor = (valor << 5) | i; bits += 5;
    if (bits >= 8) { bytes.push((valor >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(bytes);
}

/** Segredo novo (160 bits, em base32 — o que o aplicativo lê). */
export const novoSegredo = () => base32(randomBytes(20));

/** O código de um instante (`passo` de 30 s). `digitos` 6 é o que os aplicativos usam. */
export function codigo(segredo, { agora = Date.now(), passo = 30, digitos = 6, deslocamento = 0 } = {}) {
  const contador = Math.floor(agora / 1000 / passo) + deslocamento;
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(contador));
  const h = createHmac("sha1", deBase32(segredo)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** digitos).padStart(digitos, "0");
}

/**
 * Confere aceitando 30 s antes ou depois (relógio do celular um pouco adiantado ou atrasado).
 * Devolve o número do "passo" que bateu (para não aceitar o mesmo código duas vezes) ou null.
 */
export function confere(segredo, digitado, { agora = Date.now(), janela = 1, passo = 30 } = {}) {
  const d = String(digitado ?? "").replace(/\D/g, "");
  if (d.length !== 6) return null;
  for (let k = -janela; k <= janela; k++) {
    const certo = Buffer.from(codigo(segredo, { agora, passo, deslocamento: k }));
    if (timingSafeEqual(certo, Buffer.from(d))) return Math.floor(agora / 1000 / passo) + k;
  }
  return null;
}

/** Link que o aplicativo entende (vai dentro do QR Code). */
export const linkDoAplicativo = ({ segredo, conta, emissor = "Forminha" }) =>
  `otpauth://totp/${encodeURIComponent(emissor)}:${encodeURIComponent(conta)}?secret=${segredo}&issuer=${encodeURIComponent(emissor)}&algorithm=SHA1&digits=6&period=30`;
