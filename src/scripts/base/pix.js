/* PIX — monta o "copia e cola" (BR Code estático com valor) no navegador.
   A chave PIX é pública para quem vai pagar; o banco só devolve os dados. */

const campo = (id, valor) => `${id}${String(valor.length).padStart(2, "0")}${valor}`;

const limparTexto = (t, max) =>
  String(t ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 ]/g, "")
    .toUpperCase()
    .slice(0, max)
    .trim();

/** CRC16-CCITT (polinômio 0x1021, início 0xFFFF) exigido pelo padrão do Banco Central. */
function crc16(texto) {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(texto)) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/** `pix` = { chave, nome, cidade, valor (centavos), identificador } como vem do pedido. */
export function gerarPix({ chave, nome, cidade, valor, identificador }) {
  const conta = campo("00", "br.gov.bcb.pix") + campo("01", chave);
  const txid = String(identificador ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 25) || "***";
  const semCrc =
    campo("00", "01") +
    campo("01", "12") +
    campo("26", conta) +
    campo("52", "0000") +
    campo("53", "986") +
    (valor > 0 ? campo("54", (valor / 100).toFixed(2)) : "") +
    campo("58", "BR") +
    campo("59", limparTexto(nome, 25) || "LOJA") +
    campo("60", limparTexto(cidade, 15) || "BRASIL") +
    campo("62", campo("05", txid)) +
    "6304";
  return semCrc + crc16(semCrc);
}
