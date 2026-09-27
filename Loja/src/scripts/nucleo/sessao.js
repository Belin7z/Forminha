/* NÚCLEO — sessão do cliente (login, cadastro, logout) e favoritos */
import { toast } from "/src/scripts/base/ui.js";
import { api, supabase } from "./api.js";
import { emitir, estado } from "./estado.js";

// o cliente abriu o link "redefinir senha" recebido por e-mail: leva direto à tela da nova senha
supabase.auth.onAuthStateChange((evento) => {
  if (evento === "PASSWORD_RECOVERY") location.hash = "#/redefinir";
});

/** Link de e-mail vencido/já usado: o Supabase devolve o erro no endereço; troca por uma mensagem clara. */
export function tratarLinkDoEmail() {
  if (!/^#(?!\/)/.test(location.hash) || !/error(_code|_description)?=/.test(location.hash)) return;
  const expirou = /otp_expired|expired/i.test(location.hash);
  history.replaceState(null, "", "#/recuperar");
  toast(expirou ? "Este link expirou ou já foi usado. Peça um novo abaixo." : "Não foi possível validar o link do e-mail.", "erro");
}

export async function carregarSessao() {
  const { usuario } = await api.get("/auth/eu");
  estado.usuario = usuario;
  emitir("usuario");
}

async function abrir(caminho, dados) {
  const { usuario } = await api.post(caminho, dados);
  estado.usuario = usuario;
  emitir("usuario");
  return usuario;
}

export const entrar = (dados) => abrir("/auth/entrar", dados);
/** Devolve o usuário logado — ou null quando o Supabase exige confirmar o e-mail antes do primeiro acesso. */
export const cadastrar = (dados) => abrir("/auth/cadastro", dados);

export const recuperarSenha = (email) => api.post("/auth/recuperar", { email });
export const redefinirSenha = (senha) => api.post("/auth/redefinir", { senha });

export async function sair() {
  await api.post("/auth/sair");
  estado.usuario = null;
  estado.favoritos = new Set();
  emitir("usuario");
  emitir("favoritos");
}

/**
 * Garante que há cliente logado. Se não houver, leva ao login e volta
 * para a página de origem depois. Devolve true se pode continuar.
 */
export function exigirLogin(ctx, mensagem) {
  if (estado.usuario) return true;
  if (mensagem) toast(mensagem, "info");
  ctx.ir(`/entrar?voltar=${encodeURIComponent(location.hash.slice(1))}`);
  return false;
}

/** Favorita/desfavorita um produto (atualiza a tela na hora e desfaz se o servidor recusar). */
export async function alternarFavorito(produtoId, ctx) {
  if (!estado.usuario) {
    toast("Entre na sua conta para salvar seus favoritos.", "info");
    ctx.ir(`/entrar?voltar=${encodeURIComponent(location.hash.slice(1))}`);
    return;
  }
  const ja = estado.favoritos.has(produtoId);
  ja ? estado.favoritos.delete(produtoId) : estado.favoritos.add(produtoId);
  emitir("favoritos");
  try {
    await (ja ? api.delete(`/favoritos/${produtoId}`) : api.put(`/favoritos/${produtoId}`));
  } catch (erro) {
    ja ? estado.favoritos.add(produtoId) : estado.favoritos.delete(produtoId);
    emitir("favoritos");
    toast(erro.message, "erro");
  }
}
