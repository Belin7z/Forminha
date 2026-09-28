/* ==========================================================
   ACESSO — a senha da Central.
   • Nasce no "npm run configurar" (CENTRAL_SENHA_HASH, na Vercel).
   • Pode ser trocada pelo painel (Configurações → Senha de acesso):
     o resumo novo fica no banco da Central, nunca a senha.
   • Rodar o configurar de novo (opção 7) sempre vale mais: é o
     caminho de volta para quem esqueceu a senha.
   • Cada troca muda a "versão" da senha: quem estava logado em
     outro aparelho sai na hora.
   ========================================================== */
import { createHash } from "node:crypto";
import { conferirSenha, resumirSenha } from "./sessao.js";
import { ErroHttp } from "./erros.js";

export const SENHA_MINIMA = 8;

// marca de qual senha do configurar estava valendo quando a troca pelo painel foi feita
const marca = (hashInicial) => createHash("sha256").update(String(hashInicial ?? "")).digest("hex").slice(0, 16);

export function criarAcesso({ banco = null, preparar = async () => {}, hashInicial }) {
  async function trocada() {
    if (!banco) return null;
    await preparar();
    const [linha] = await banco.consultar("select valor from configuracoes where chave = 'acesso'");
    const v = linha?.valor;
    return v?.hash && v.base === marca(hashInicial) ? v : null; // configurar rodou depois? a do painel deixa de valer
  }

  /** Senha certa? (a trocada pelo painel, se houver; senão a do configurar) */
  async function conferir(senha) {
    let v;
    try { v = await trocada(); } catch (e) { console.error("[acesso]", e.message); throw new ErroHttp(503, "Não foi possível conferir a senha agora. Tente de novo em instantes."); }
    return conferirSenha(senha, v?.hash ?? hashInicial);
  }

  /** Versão da senha, gravada no cookie. Banco fora do ar: não derruba quem já está logado. */
  async function versao() {
    try { return (await trocada())?.versao ?? 0; } catch (e) { console.error("[acesso]", e.message); return null; }
  }

  async function trocar({ atual, nova, repita }) {
    if (!banco) throw new ErroHttp(503, "Para trocar a senha pelo painel, ligue o banco da Central (Configurações).");
    const campos = {};
    if (!(await conferir(String(atual ?? "")))) campos.atual = "Senha atual incorreta.";
    if (String(nova ?? "").length < SENHA_MINIMA) campos.nova = `Use ${SENHA_MINIMA} caracteres ou mais.`;
    else if (String(nova).length > 200) campos.nova = "Senha longa demais.";
    else if (nova !== repita) campos.repita = "As duas não conferem.";
    if (Object.keys(campos).length) throw new ErroHttp(422, Object.values(campos)[0], campos);
    const v = { hash: await resumirSenha(nova), base: marca(hashInicial), versao: ((await versao()) ?? 0) + 1, trocada_em: new Date().toISOString() };
    await banco.consultar("insert into configuracoes (chave, valor) values ('acesso', $1::jsonb) on conflict (chave) do update set valor = excluded.valor", [JSON.stringify(v)]);
    return v.versao;
  }

  return { conferir, versao, trocar };
}
