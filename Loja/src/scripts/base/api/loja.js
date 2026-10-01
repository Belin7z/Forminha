/* ==========================================================
   API DA LOJA — traduz as chamadas da loja para o Supabase.
   Cada linha: [método, caminho, função]. Os nomes cliente_* e
   loja_* são funções do banco (supabase/migrations).
   ========================================================== */
import { ErroApi } from "../http.js";
import { criarApi, erroDeAuth, invocarFuncao, perfilAtual, trocarSenha, validarSenha } from "./nucleo.js";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function validarCadastro({ nome, email, telefone, senha }) {
  const campos = {};
  const n = String(nome ?? "").replace(/\s+/g, " ").trim();
  if (n.length < 2) campos.nome = "Nome: mínimo de 2 caracteres.";
  else if (n.length > 80) campos.nome = "Nome: máximo de 80 caracteres.";
  const e = String(email ?? "").trim().toLowerCase();
  if (!EMAIL.test(e) || e.length > 120) campos.email = "Informe um e-mail válido.";
  let t = String(telefone ?? "").replace(/\D/g, "");
  if (/^55\d{10,11}$/.test(t)) t = t.slice(2);
  if (t.length < 10 || t.length > 11) campos.telefone = "Informe um telefone com DDD.";
  try { validarSenha(senha); } catch (erro) { campos.senha = erro.message; }
  if (Object.keys(campos).length) throw new ErroApi(422, Object.values(campos)[0], campos);
  return { nome: n, email: e, telefone: t, senha: String(senha) };
}

async function cadastrar({ supabase, rpc, corpo, contexto }) {
  const d = validarCadastro(corpo);
  // banco com várias lojas: o cadastro diz em qual loja a pessoa se cadastrou (o perfil nasce nela)
  const dados = { nome: d.nome, telefone: d.telefone, aceite: corpo.aceite === true, ...(contexto.loja && { loja: contexto.loja }) };
  const { data, error } = await supabase.auth.signUp({ email: d.email, password: d.senha, options: { data: dados } });
  if (error) {
    const erro = erroDeAuth(error);
    // o mesmo login serve em todas as docerias do sistema: quem já comprou em outra entra com a mesma senha
    if (contexto.loja && erro.status === 409) {
      const msg = "Este e-mail já tem cadastro. Toque em Entrar e use a sua senha (se você já comprou em outra doceria que usa este sistema, é a mesma senha).";
      throw new ErroApi(409, msg, { email: msg });
    }
    throw erro;
  }
  // com "Confirmar e-mail" ligado no Supabase, não há sessão até o cliente clicar no link
  if (!data.session) return { usuario: null, confirmar_email: true };
  return { usuario: await rpc("perfil_atual") };
}

async function entrar({ supabase, rpc, corpo }) {
  const email = String(corpo.email ?? "").trim().toLowerCase();
  if (!EMAIL.test(email)) throw new ErroApi(422, "Informe um e-mail válido.", { email: "Informe um e-mail válido." });
  const { error } = await supabase.auth.signInWithPassword({ email, password: String(corpo.senha ?? "") });
  if (error) throw erroDeAuth(error);
  const usuario = await rpc("perfil_atual");
  if (!usuario || !usuario.ativo) {
    await supabase.auth.signOut({ scope: "local" });
    throw new ErroApi(401, "Esta conta está desativada. Fale com a loja.");
  }
  return { usuario };
}

/** LGPD: exclui a conta depois de conferir a senha (entrando de novo), e encerra a sessão neste aparelho. */
async function excluirConta({ supabase, rpc, corpo }) {
  const { data } = await supabase.auth.getSession();
  if (!data?.session) throw new ErroApi(401, "Faça login para continuar.");
  const conferencia = await supabase.auth.signInWithPassword({ email: data.session.user.email, password: String(corpo.senha ?? "") });
  if (conferencia.error) throw new ErroApi(422, "A senha está incorreta.", { senha: "A senha está incorreta." });
  await rpc("cliente_excluir_conta");
  await supabase.auth.signOut({ scope: "local" });
  return { ok: true };
}

async function sair({ supabase }) {
  await supabase.auth.signOut({ scope: "local" });
  return { ok: true };
}

/** Envia o e-mail de "esqueci a senha". Responde sempre igual, para não revelar quem tem conta. */
async function recuperar({ supabase, corpo, contexto }) {
  const email = String(corpo.email ?? "").trim().toLowerCase();
  if (!EMAIL.test(email)) throw new ErroApi(422, "Informe um e-mail válido.", { email: "Informe um e-mail válido." });
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: contexto.urlRecuperacao });
  if (error && ["over_request_rate_limit", "over_email_send_rate_limit"].includes(error.code)) throw erroDeAuth(error);
  return { ok: true };
}

/** Define a nova senha depois de o cliente abrir o link recebido por e-mail. */
async function redefinir({ supabase, corpo }) {
  const senha = validarSenha(corpo.senha);
  const { error } = await supabase.auth.updateUser({ password: senha });
  if (error) throw erroDeAuth(error);
  return { ok: true };
}

export const rotasLoja = [
  // vitrine pública
  ["GET", "/config", ({ rpc }) => rpc("loja_config")],
  ["GET", "/catalogo", ({ rpc }) => rpc("loja_catalogo")],
  ["GET", "/agenda", ({ rpc }) => rpc("loja_agenda")],
  ["GET", "/avaliacoes", ({ rpc }) => rpc("loja_avaliacoes")],

  // sessão
  ["GET", "/auth/eu", async (c) => {
    const usuario = await perfilAtual(c);
    if (usuario && !usuario.ativo) { await c.supabase.auth.signOut({ scope: "local" }); return { usuario: null }; }
    return { usuario };
  }],
  ["POST", "/auth/cadastro", cadastrar],
  ["POST", "/auth/entrar", entrar],
  ["POST", "/auth/sair", sair],
  ["POST", "/auth/recuperar", recuperar],
  ["POST", "/auth/redefinir", redefinir],

  // conta
  ["PUT", "/conta", ({ rpc, corpo }) => rpc("cliente_atualizar_perfil", corpo)],
  ["PUT", "/conta/senha", trocarSenha],
  ["GET", "/conta/dados", ({ rpc }) => rpc("cliente_exportar_dados")],
  ["POST", "/conta/excluir", excluirConta],
  // PIX automático: a função do servidor gera o QR Code no Mercado Pago (o valor vem do pedido, no banco)
  ["POST", "/pix/gerar", ({ supabase, corpo }) => invocarFuncao(supabase, "pix-criar", { codigo: corpo.codigo })],
  // cartão online: a função abre o checkout do Mercado Pago (valor do pedido, no banco) e devolve o endereço
  ["POST", "/cartao/pagar", ({ supabase, corpo }) => invocarFuncao(supabase, "cartao-criar", { codigo: corpo.codigo, voltar: corpo.voltar })],
  ["PUT", "/conta/preferencias", ({ rpc, corpo }) => rpc("cliente_preferencias", corpo)],
  ["GET", "/enderecos", ({ rpc }) => rpc("cliente_enderecos")],
  ["POST", "/enderecos", ({ rpc, corpo }) => rpc("cliente_salvar_endereco", { ...corpo, id: undefined })],
  ["PUT", "/enderecos/:id", ({ rpc, corpo, params }) => rpc("cliente_salvar_endereco", { ...corpo, id: Number(params.id) })],
  ["DELETE", "/enderecos/:id", ({ rpc, params }) => rpc("cliente_excluir_endereco", { id: Number(params.id) })],
  ["PUT", "/favoritos/:id", ({ rpc, params }) => rpc("cliente_favorito", { produto_id: Number(params.id), ligado: true })],
  ["DELETE", "/favoritos/:id", ({ rpc, params }) => rpc("cliente_favorito", { produto_id: Number(params.id), ligado: false })],

  // pedidos
  ["POST", "/pedidos/orcamento", ({ rpc, corpo }) => rpc("cliente_orcar_pedido", corpo)],
  ["POST", "/pedidos", ({ rpc, corpo }) => rpc("cliente_criar_pedido", corpo)],
  ["GET", "/pedidos", ({ rpc }) => rpc("cliente_pedidos")],
  ["GET", "/pedidos/:codigo", ({ rpc, params }) => rpc("cliente_pedido", { codigo: params.codigo })],
  ["POST", "/pedidos/:codigo/cancelar", ({ rpc, params, corpo }) => rpc("cliente_cancelar_pedido", { codigo: params.codigo, motivo: corpo.motivo })],
  ["POST", "/pedidos/:codigo/avaliar", ({ rpc, params, corpo }) => rpc("cliente_avaliar_pedido", { codigo: params.codigo, nota: corpo.nota, comentario: corpo.comentario })],

  // encomenda por orçamento: o cliente pede, a loja responde, o cliente aceita (vira pedido)
  ["POST", "/orcamentos", ({ rpc, corpo }) => rpc("cliente_pedir_orcamento", corpo)],
  ["GET", "/orcamentos", ({ rpc }) => rpc("cliente_orcamentos")],
  ["POST", "/orcamentos/:id/aceitar", ({ rpc, params, corpo }) => rpc("cliente_aceitar_orcamento", { ...corpo, id: Number(params.id) })],
  ["POST", "/orcamentos/:id/cancelar", ({ rpc, params }) => rpc("cliente_cancelar_orcamento", { id: Number(params.id) })],
];

/** contexto: { urlRecuperacao } — para onde o link do e-mail "esqueci a senha" leva. */
export const criarApiLoja = (supabase, contexto = {}) => criarApi({ supabase, rotas: rotasLoja, contexto });
