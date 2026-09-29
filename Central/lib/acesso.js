/* ==========================================================
   ACESSO — a conta que entra na Central: e-mail (ou usuário) + senha.
   • Nasce no "npm run configurar" (CENTRAL_EMAIL e CENTRAL_SENHA_HASH,
     nas variáveis secretas da Vercel — nunca no código).
   • Pelo painel (Configurações) dá para trocar a senha, o e-mail e
     criar um nome de usuário: fica no banco da Central, e da senha só
     o resumo (scrypt).
   • Rodar o configurar de novo (opção 7) sempre vale mais: é o
     caminho de volta para quem esqueceu a senha.
   • Cada troca de senha muda a "versão": quem estava logado em outro
     aparelho sai na hora.
   ========================================================== */
import { createHash, randomBytes } from "node:crypto";
import { SENHA_MINIMA, conferirSenha, resumirSenha } from "./sessao.js";
import { ErroHttp } from "./erros.js";
import { lerUsuario } from "./equipe.js";

export { SENHA_MINIMA };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const USUARIO = /^[a-z0-9._-]{3,30}$/;
const limpar = (t) => String(t ?? "").trim().toLowerCase();

// marca de qual senha do configurar estava valendo quando o painel mudou algo
const marca = (hashInicial) => createHash("sha256").update(String(hashInicial ?? "")).digest("hex").slice(0, 16);

export function criarAcesso({ banco = null, preparar = async () => {}, hashInicial, emailInicial = "" }) {
  /** O que foi mudado pelo painel e ainda vale (o configurar rodou depois? deixa de valer). */
  async function registro() {
    if (!banco) return null;
    await preparar();
    const [linha] = await banco.consultar("select valor from configuracoes where chave = 'acesso'");
    const v = linha?.valor;
    return v && v.base === marca(hashInicial) ? v : null;
  }
  async function ler() {
    try { return await registro(); } catch (e) { console.error("[acesso]", e.message); throw new ErroHttp(503, "Não foi possível conferir o acesso agora. Tente de novo em instantes."); }
  }
  async function gravar(v) {
    await banco.consultar("insert into configuracoes (chave, valor) values ('acesso', $1::jsonb) on conflict (chave) do update set valor = excluded.valor", [JSON.stringify(v)]);
  }
  const contaDe = (r) => ({ nome: r?.nome ?? "", email: r?.email ?? limpar(emailInicial), usuario: r?.usuario ?? "" });
  const senhaCerta = async (r, senha) => conferirSenha(String(senha ?? ""), r?.hash ?? hashInicial);

  /** Login: e-mail ou usuário + senha. Sem conta cadastrada (instalação antiga), vale só a senha. */
  async function entrar(identificador, senha) {
    const r = await ler();
    const { email, usuario } = contaDe(r);
    const id = limpar(identificador);
    const senhaOk = await senhaCerta(r, senha); // sempre confere a senha: a resposta demora igual nos dois casos
    if (!email && !usuario) return senhaOk;
    return senhaOk && (id === email || (usuario !== "" && id === usuario));
  }

  /** Versão da senha, gravada no cookie. Banco fora do ar: não derruba quem já está logado. */
  async function versao() {
    try { return (await registro())?.versao ?? 0; } catch (e) { console.error("[acesso]", e.message); return null; }
  }

  const conta = async () => contaDe(await ler());

  function exigirBanco() {
    if (!banco) throw new ErroHttp(503, "Para mudar o acesso pelo painel, ligue o banco da Central (veja Conexões).");
  }

  async function trocarSenha({ atual, nova, repita }) {
    exigirBanco();
    const r = await ler();
    const campos = {};
    if (!(await senhaCerta(r, atual))) campos.atual = "Senha atual incorreta.";
    if (String(nova ?? "").length < SENHA_MINIMA) campos.nova = `Use ${SENHA_MINIMA} caracteres ou mais.`;
    else if (String(nova).length > 200) campos.nova = "Senha longa demais.";
    else if (nova !== repita) campos.repita = "As duas não conferem.";
    if (Object.keys(campos).length) throw new ErroHttp(422, Object.values(campos)[0], campos);
    const v = { ...r, hash: await resumirSenha(nova), base: marca(hashInicial), versao: (r?.versao ?? 0) + 1, trocada_em: new Date().toISOString() };
    await gravar(v);
    return v.versao;
  }

  /** Nome (opcional, aparece no perfil), e-mail (obrigatório) e usuário (opcional); pede a senha para confirmar. */
  async function salvarConta({ senha, nome, email, usuario }) {
    exigirBanco();
    const r = await ler();
    const novo = { nome: String(nome ?? "").replace(/\s+/g, " ").trim(), email: limpar(email), usuario: limpar(usuario) };
    const campos = {};
    if (novo.nome.length > 60) campos.nome = "Nome: até 60 letras.";
    if (!(await senhaCerta(r, senha))) campos.senha = "Senha incorreta.";
    if (!EMAIL.test(novo.email) || novo.email.length > 120) campos.email = "E-mail inválido.";
    if (novo.usuario && !USUARIO.test(novo.usuario)) campos.usuario = "De 3 a 30 letras, números, ponto, traço ou sublinhado (sem espaço e sem @).";
    else if (lerUsuario(novo.usuario)) campos.usuario = "Esse formato (FM + letra + número) é reservado para a equipe.";
    if (Object.keys(campos).length) throw new ErroHttp(422, Object.values(campos)[0], campos);
    await gravar({ ...r, ...novo, base: marca(hashInicial), versao: r?.versao ?? 0 });
    return novo;
  }

  /** Só o nome que aparece no perfil (não é dado de acesso: não pede senha). */
  async function salvarNome(nome) {
    exigirBanco();
    const n = String(nome ?? "").replace(/\s+/g, " ").trim();
    if (n.length < 2 || n.length > 60) throw new ErroHttp(422, "Nome: de 2 a 60 letras.", { nome: "Nome: de 2 a 60 letras." });
    const r = await ler();
    await gravar({ ...r, nome: n, base: marca(hashInicial), versao: r?.versao ?? 0 });
    return contaDe({ ...r, nome: n });
  }

  /** Só confere a senha (para ações sensíveis, como desligar a verificação em duas etapas). */
  const conferirSenhaDono = async (senha) => senhaCerta(await ler(), senha);

  /* ---------- esqueci a senha (link por e-mail, uso único, 30 minutos) ---------- */
  const resumoDoLink = (t) => createHash("sha256").update(String(t)).digest("hex");

  /** Devolve o código do link se o e-mail for o da conta (senão null — quem pede não fica sabendo). */
  async function pedirRecuperacao(email) {
    exigirBanco();
    const r = await ler();
    const { email: daConta } = contaDe(r);
    if (!daConta || limpar(email) !== daConta) return null;
    const token = randomBytes(32).toString("base64url");
    await gravar({ ...r, base: marca(hashInicial), versao: r?.versao ?? 0, recuperacao: { resumo: resumoDoLink(token), expira: Date.now() + 30 * 60_000 } });
    return token;
  }

  /** Senha nova pelo link: confere o link (uma vez só) e derruba as sessões abertas. */
  async function recuperar({ token, nova, repita }) {
    exigirBanco();
    const r = await ler();
    const rec = r?.recuperacao;
    const valido = rec && rec.expira > Date.now() && rec.resumo === resumoDoLink(token);
    if (!valido) throw new ErroHttp(410, "Este link venceu ou já foi usado. Peça outro em “Esqueci a senha”.");
    const campos = {};
    if (String(nova ?? "").length < SENHA_MINIMA) campos.nova = `Use ${SENHA_MINIMA} caracteres ou mais.`;
    else if (String(nova).length > 200) campos.nova = "Senha longa demais.";
    else if (nova !== repita) campos.repita = "As duas não conferem.";
    if (Object.keys(campos).length) throw new ErroHttp(422, Object.values(campos)[0], campos);
    const { recuperacao: _usado, ...resto } = r;
    await gravar({ ...resto, hash: await resumirSenha(nova), base: marca(hashInicial), versao: (r?.versao ?? 0) + 1, trocada_em: new Date().toISOString() });
    return { ok: true };
  }

  return { entrar, versao, conta, trocarSenha, salvarConta, salvarNome, conferirSenhaDono, pedirRecuperacao, recuperar, marca: marca(hashInicial) };
}
