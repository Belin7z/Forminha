/* ==========================================================
   COFRE — criptografia dos dados das clientes da Forminha.
   • AES-256-GCM (padrão usado por bancos): cada valor cifrado leva um
     número aleatório próprio (IV) e um selo de autenticidade — se alguém
     alterar um byte no banco, a leitura falha em vez de mostrar lixo.
   • "Contexto" (AAD): um valor cifrado como "cliente" não pode ser
     copiado para outro campo/registro e lido como se fosse dele.
   • Índice cego (HMAC-SHA256): permite achar a cliente pelo e-mail e
     impedir duplicado sem guardar o e-mail aberto no banco.
   A chave (CHAVE_CRIPTOGRAFIA, 32 bytes em base64) fica SÓ nas variáveis
   secretas da Vercel. Sem ela os dados não abrem — nem para quem copiar
   o banco inteiro.
   ========================================================== */
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";

const VERSAO = "v1";

export class ErroCofre extends Error {}

/** Lê e confere a chave mestra; deriva chaves separadas para cifrar e para o índice. */
export function criarCofre(chaveBase64) {
  const mestra = Buffer.from(String(chaveBase64 ?? ""), "base64");
  if (mestra.length !== 32) throw new ErroCofre("CHAVE_CRIPTOGRAFIA ausente ou inválida (precisa de 32 bytes em base64).");
  const derivar = (uso) => Buffer.from(hkdfSync("sha256", mestra, Buffer.from("forminha"), Buffer.from(uso), 32));
  const chaveDados = derivar("dados-v1");
  const chaveIndice = derivar("indice-v1");

  return {
    /** Cifra um texto ou objeto. `contexto` amarra o valor ao lugar onde ele fica (ex.: "cliente:<id>"). */
    cifrar(valor, contexto) {
      const texto = typeof valor === "string" ? valor : JSON.stringify(valor);
      const iv = randomBytes(12);
      const c = createCipheriv("aes-256-gcm", chaveDados, iv);
      c.setAAD(Buffer.from(String(contexto)));
      const cifrado = Buffer.concat([c.update(texto, "utf8"), c.final()]);
      return `${VERSAO}.${Buffer.concat([iv, cifrado, c.getAuthTag()]).toString("base64url")}`;
    },
    /** Decifra; `json: true` devolve o objeto. Qualquer adulteração ou contexto errado -> ErroCofre. */
    decifrar(pacote, contexto, { json = false } = {}) {
      const [versao, corpo] = String(pacote ?? "").split(".");
      if (versao !== VERSAO || !corpo) throw new ErroCofre("Dado cifrado em formato desconhecido.");
      const bytes = Buffer.from(corpo, "base64url");
      if (bytes.length < 12 + 16) throw new ErroCofre("Dado cifrado incompleto.");
      try {
        const d = createDecipheriv("aes-256-gcm", chaveDados, bytes.subarray(0, 12));
        d.setAAD(Buffer.from(String(contexto)));
        d.setAuthTag(bytes.subarray(bytes.length - 16));
        const texto = Buffer.concat([d.update(bytes.subarray(12, bytes.length - 16)), d.final()]).toString("utf8");
        return json ? JSON.parse(texto) : texto;
      } catch {
        throw new ErroCofre("Não foi possível abrir o dado (chave errada ou dado alterado).");
      }
    },
    /** Índice cego: o mesmo e-mail sempre gera o mesmo código, mas o código não revela o e-mail. */
    indice(texto) {
      return createHmac("sha256", chaveIndice).update(String(texto ?? "").trim().toLowerCase()).digest("hex");
    },
  };
}

/** Nova chave mestra aleatória (usada pelo "npm run configurar"). */
export const novaChave = () => randomBytes(32).toString("base64");

/** Esconde parte do e-mail para mostrar em telas públicas: "ana.souza@gmail.com" -> "an•••@gmail.com". */
export function mascararEmail(email) {
  const [u, d] = String(email ?? "").split("@");
  if (!d) return "";
  return `${u.slice(0, 2)}${"•".repeat(3)}@${d}`;
}
