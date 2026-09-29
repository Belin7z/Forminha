/* ==========================================================
   FUNÇÕES DAS LOJAS — as funções do servidor que rodam no Supabase
   de cada loja (PIX automático, cartão online, aviso de pagamento e
   WhatsApp). A fonte é Dashboard/supabase/functions (cópia em
   sql/funcoes, pelo "npm run copiar-sql").
   Cada função vira UM arquivo só (as peças comuns entram junto),
   para a instalação pela API do Supabase não depender de pastas.
   ========================================================== */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const FUNCOES = ["pix-criar", "pix-webhook", "cartao-criar", "whatsapp-avisar"];
const PASTA = new URL("../sql/funcoes/", import.meta.url);

const ler = (caminho) => readFileSync(new URL(caminho, PASTA), "utf8");
// tira os "import … from './…'" (a peça já está no mesmo arquivo) e os "export { x }" que só repassavam nomes
const semLigacoesLocais = (texto) => texto
  .replace(/^import\s+[^;]+?\s+from\s+"\.{1,2}\/[^"]+";[ \t]*\r?\n/gm, "")
  .replace(/^export\s*\{[^}]*\};[ \t]*\r?\n/gm, "");

/** O código completo de uma função, pronto para instalar. */
export function montarFuncao(nome) {
  if (!FUNCOES.includes(nome)) throw new Error(`função desconhecida: ${nome}`);
  return [
    `// ${nome} — montada pela Central da Forminha. Não edite aqui: a fonte é Dashboard/supabase/functions.`,
    semLigacoesLocais(ler("_shared/comum.js")),
    semLigacoesLocais(ler(`${nome}/logica.js`)),
    semLigacoesLocais(ler(`${nome}/index.ts`)),
  ].join("\n\n");
}

/** Uma impressão digital de todas as funções: muda quando qualquer uma muda (para saber se a loja está atualizada). */
export const versaoDasFuncoes = () => createHash("sha256").update(FUNCOES.map(montarFuncao).join("\n")).digest("hex").slice(0, 12);
