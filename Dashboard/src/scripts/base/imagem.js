/* ==========================================================
   IMAGEM — as contas do assistente de foto, sem depender da tela
   (dá para testar no Node): enquadramento, giro e luz.
   ========================================================== */

/** Escala para a foto cobrir o quadro (recorte) ou caber inteira nele (logo, sem recorte). */
export const escalaBase = ({ w, h, VW, VH, recorta }) => (recorta ? Math.max(VW / w, VH / h) : Math.min(VW / w, VH / h));

/**
 * Mantém a foto dentro do quadro: com recorte, não deixa aparecer borda vazia;
 * se a foto for menor que o quadro naquele sentido, centraliza.
 */
export function limitarPosicao({ w, h, VW, VH, escala, ox, oy }) {
  const iw = w * escala, ih = h * escala;
  return {
    ox: iw <= VW ? (VW - iw) / 2 : Math.min(0, Math.max(VW - iw, ox)),
    oy: ih <= VH ? (VH - ih) / 2 : Math.min(0, Math.max(VH - ih, oy)),
  };
}

/** Posição que deixa a foto centralizada no quadro. */
export const centralizar = ({ w, h, VW, VH, escala }) => ({ ox: (VW - w * escala) / 2, oy: (VH - h * escala) / 2 });

/**
 * Pedaço da foto original que fica no quadro (sx, sy, sw, sh) e o tamanho final da foto salva,
 * com o lado maior limitado a `lado` (fotos de celular são enormes).
 */
export function areaDoRecorte({ w, h, VW, VH, escala, ox, oy, recorta, lado }) {
  const sx = recorta ? -ox / escala : 0, sy = recorta ? -oy / escala : 0;
  const sw = recorta ? VW / escala : w, sh = recorta ? VH / escala : h;
  const fator = Math.min(1, lado / Math.max(sw, sh));
  return { sx, sy, sw, sh, largura: Math.max(1, Math.round(sw * fator)), altura: Math.max(1, Math.round(sh * fator)) };
}

/** Largura e altura depois de girar `graus` (0, 90, 180 ou 270). */
export const medidaGirada = (w, h, graus) => (graus % 180 === 0 ? { w, h } : { w: h, h: w });

/**
 * Clareia (brilho > 1) ou escurece (< 1) os pixels RGBA no lugar — para navegadores
 * que não aplicam filtro no canvas. A transparência (alfa) não muda.
 */
export function ajustarBrilho(pixels, brilho) {
  if (brilho === 1) return pixels;
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = Math.min(255, Math.round(pixels[i] * brilho));
    pixels[i + 1] = Math.min(255, Math.round(pixels[i + 1] * brilho));
    pixels[i + 2] = Math.min(255, Math.round(pixels[i + 2] * brilho));
  }
  return pixels;
}

/** Brilho que deixaria uma foto com luz média `luz` (0–255) perto do ideal (~130), entre 1 e 1,6. */
export const brilhoSugerido = (luz) => (luz >= 95 ? 1 : Math.min(1.6, Math.max(1, Math.round((130 / Math.max(luz, 1)) * 20) / 20)));
