/* ==========================================================
   API DO PAINEL — traduz as chamadas do painel para o Supabase.
   As funções admin_* do banco só respondem a administradores;
   fotos vão para o Storage (bucket "produtos").
   ========================================================== */
import { ErroApi } from "../http.js";
import { criarApi, erroDeAuth, invocarFuncao, perfilAtual, trocarSenha, validarSenha } from "./nucleo.js";

const LIMITE_FOTO = 4 * 1024 * 1024;
const EQUIPE = ["admin", "atendente"]; // quem pode entrar no painel
const BUCKET = "produtos";

/* ---------- Fotos ---------- */
async function enviarFoto(supabase, dataUrl, bucket = BUCKET) {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl));
  if (!m) throw new ErroApi(422, "Envie uma imagem PNG, JPG ou WEBP.");
  const texto = atob(m[2]);
  const bytes = new Uint8Array(texto.length);
  for (let i = 0; i < texto.length; i++) bytes[i] = texto.charCodeAt(i);
  if (bytes.length === 0 || bytes.length > LIMITE_FOTO) throw new ErroApi(422, `A imagem deve ter até ${LIMITE_FOTO / 1024 / 1024} MB.`);

  const ext = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[m[1]];
  const sufixo = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, "0")).join("");
  const caminho = `${Date.now().toString(36)}-${sufixo}.${ext}`;
  const { error } = await supabase.storage.from(bucket).upload(caminho, new Blob([bytes], { type: m[1] }), { contentType: m[1], cacheControl: "31536000" });
  if (error) throw new ErroApi(422, "Não foi possível enviar a foto. Tente uma imagem menor.");
  return supabase.storage.from(bucket).getPublicUrl(caminho).data.publicUrl;
}

async function apagarFoto(supabase, url, bucket = BUCKET) {
  const marca = `/object/public/${bucket}/`;
  const i = String(url ?? "").indexOf(marca);
  if (i < 0) return;
  await supabase.storage.from(bucket).remove([url.slice(i + marca.length)]).catch(() => {}); // melhor esforço
}

async function salvarProduto({ rpc, supabase, corpo, params }) {
  const dados = { ...corpo };
  const enviadas = []; // fotos que subiram agora (apagadas se o banco recusar o produto)
  if (dados.imagem_nova) { dados.imagem = await enviarFoto(supabase, dados.imagem_nova); enviadas.push(dados.imagem); }
  delete dados.imagem_nova;
  // fotos extras: o que é "data:" é foto nova (sobe agora); o resto já são endereços do Storage
  if (Array.isArray(dados.galeria)) {
    dados.galeria = await Promise.all(dados.galeria.map(async (g) => {
      if (!String(g).startsWith("data:")) return g;
      const url = await enviarFoto(supabase, g);
      enviadas.push(url);
      return url;
    }));
  }
  dados.id = params?.id ? Number(params.id) : undefined;
  let r;
  try { r = await rpc("admin_salvar_produto", dados); }
  catch (e) { await Promise.all(enviadas.map((u) => apagarFoto(supabase, u))); throw e; }
  await Promise.all([r.imagem_removida, ...(r.galeria_removida ?? [])].filter(Boolean).map((u) => apagarFoto(supabase, u)));
  return { produto: r.produto };
}

/* ---------- Sessão do administrador ---------- */
async function entrar({ supabase, rpc, corpo }) {
  const email = String(corpo.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new ErroApi(422, "Informe um e-mail válido.", { email: "Informe um e-mail válido." });
  const { error } = await supabase.auth.signInWithPassword({ email, password: String(corpo.senha ?? "") });
  if (error) throw erroDeAuth(error);
  const usuario = await rpc("perfil_atual");
  if (!usuario || !usuario.ativo || !EQUIPE.includes(usuario.papel)) {
    await supabase.auth.signOut({ scope: "local" });
    throw new ErroApi(403, "Este acesso é restrito à equipe.");
  }
  return { usuario };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Convite de primeiro acesso: cria a conta (ou entra numa que já existe) e vira administradora da loja.
    Se o convite for recusado (vencido, já usado, de outro e-mail), sai da conta: nada fica pela metade. */
async function usarConvite({ supabase, rpc, corpo }) {
  const email = String(corpo.email ?? "").trim().toLowerCase();
  const campos = {};
  if (!EMAIL.test(email)) campos.email = "Informe um e-mail válido.";
  const nome = String(corpo.nome ?? "").replace(/\s+/g, " ").trim();
  if (corpo.criar) {
    if (nome.length < 2) campos.nome = "Nome: mínimo de 2 caracteres.";
    else if (nome.length > 80) campos.nome = "Nome: máximo de 80 caracteres.";
    try { validarSenha(corpo.senha); } catch (erro) { campos.senha = erro.message; }
  }
  if (Object.keys(campos).length) throw new ErroApi(422, Object.values(campos)[0], campos);

  if (corpo.criar) {
    const { data, error } = await supabase.auth.signUp({ email, password: String(corpo.senha), options: { data: { nome } } });
    if (error) throw erroDeAuth(error);
    // com "Confirmar e-mail" ligado no Supabase: ela confirma e depois volta ao mesmo link para entrar
    if (!data.session) return { confirmar_email: true };
  } else {
    const { error } = await supabase.auth.signInWithPassword({ email, password: String(corpo.senha ?? "") });
    if (error) throw erroDeAuth(error);
  }
  try { await rpc("convite_aceitar", { codigo: String(corpo.codigo ?? "") }); }
  catch (erro) { await supabase.auth.signOut({ scope: "local" }); throw erro; }
  return { usuario: await rpc("perfil_atual") };
}

export const rotasPainel = [
  // sessão e conta
  ["POST", "/auth/entrar", entrar],
  // convite de primeiro acesso (antes do login)
  ["GET", "/convite/:codigo", ({ rpc, params }) => rpc("convite_consultar", { codigo: params.codigo })],
  ["POST", "/convite/usar", usarConvite],
  ["POST", "/auth/sair", async ({ supabase }) => { await supabase.auth.signOut({ scope: "local" }); return { ok: true }; }],
  ["GET", "/auth/eu", async (c) => {
    const usuario = await perfilAtual(c);
    return { usuario: usuario && usuario.ativo && EQUIPE.includes(usuario.papel) ? usuario : null };
  }],
  ["PUT", "/conta", ({ rpc, corpo }) => rpc("admin_atualizar_perfil", corpo)],
  ["PUT", "/conta/senha", trocarSenha],

  // imagens do site (logo, foto de destaque, galeria)
  ["POST", "/site/imagem", async ({ supabase, corpo }) => ({ url: await enviarFoto(supabase, corpo.imagem, "site") })],
  ["POST", "/site/imagem/apagar", async ({ supabase, corpo }) => { await apagarFoto(supabase, corpo.url, "site"); return { ok: true }; }],

  // visão geral e pedidos (rotas fixas antes de "/pedidos/:id")
  ["GET", "/resumo", ({ rpc, consulta }) => rpc("admin_resumo", consulta)],
  // mensalidade da Forminha (a Central escreve; a dona só vê e paga pelo link)
  ["GET", "/assinatura", ({ rpc }) => rpc("admin_assinatura")],
  // relatório de vendas: ?de=AAAA-MM-DD&ate=AAAA-MM-DD&base=pedido|entrega[&agrupar=hora|dia|mes|ano]
  ["GET", "/relatorios/vendas", ({ rpc, consulta }) => rpc("admin_relatorio_vendas", consulta)],
  ["GET", "/pedidos/contagem", ({ rpc }) => rpc("admin_pedidos_contagem")],
  ["GET", "/pedidos/novos", ({ rpc, consulta }) => rpc("admin_pedidos_novos", consulta)],
  ["GET", "/pedidos", ({ rpc, consulta }) => rpc("admin_pedidos", consulta)],
  ["POST", "/pedidos", ({ rpc, corpo }) => rpc("admin_criar_pedido", corpo)],
  ["POST", "/pedidos/:id/pagamentos", ({ rpc, params, corpo }) => rpc("admin_registrar_pagamento", { ...corpo, id: Number(params.id) })],
  ["DELETE", "/pagamentos/:id", ({ rpc, params }) => rpc("admin_excluir_pagamento", { id: Number(params.id) })],
  ["GET", "/pedidos/:id", ({ rpc, params }) => rpc("admin_pedido", { id: Number(params.id) })],
  ["PATCH", "/pedidos/:id/status", ({ rpc, params, corpo }) => rpc("admin_mudar_status", { id: Number(params.id), status: corpo.status, nota: corpo.nota })],

  // cardápio
  ["GET", "/categorias", ({ rpc }) => rpc("admin_categorias")],
  ["POST", "/categorias", ({ rpc, corpo }) => rpc("admin_salvar_categoria", { ...corpo, id: undefined })],
  ["PUT", "/categorias/ordem", ({ rpc, corpo }) => rpc("admin_ordenar_categorias", { ids: corpo.ids })],
  ["PUT", "/categorias/:id", ({ rpc, params, corpo }) => rpc("admin_salvar_categoria", { ...corpo, id: Number(params.id) })],
  ["DELETE", "/categorias/:id", ({ rpc, params }) => rpc("admin_excluir_categoria", { id: Number(params.id) })],
  ["GET", "/produtos", ({ rpc }) => rpc("admin_produtos")],
  ["POST", "/produtos", salvarProduto],
  ["PUT", "/produtos/:id", salvarProduto],
  ["PATCH", "/produtos/:id", ({ rpc, params, corpo }) => {
    const campo = ["ativo", "destaque"].find((c) => c in corpo);
    return rpc("admin_alternar_produto", { id: Number(params.id), campo, valor: campo ? corpo[campo] : undefined });
  }],
  ["DELETE", "/produtos/:id", async ({ rpc, supabase, params }) => {
    const r = await rpc("admin_excluir_produto", { id: Number(params.id) });
    await Promise.all([r.imagem_removida, ...(r.galeria_removida ?? [])].filter(Boolean).map((u) => apagarFoto(supabase, u)));
    return { ok: true };
  }],

  // clientes e equipe
  ["GET", "/clientes", ({ rpc, consulta }) => rpc("admin_clientes", consulta)],
  ["GET", "/clientes/:id", ({ rpc, params }) => rpc("admin_cliente", { id: params.id })],
  ["PATCH", "/clientes/:id", ({ rpc, params, corpo }) => rpc("admin_cliente_ativo", { id: params.id, ativo: corpo.ativo })],
  // o cliente recebe o e-mail do Supabase com o link para criar uma nova senha
  ["POST", "/clientes/:id/senha", async ({ supabase, corpo, contexto }) => {
    const { error } = await supabase.auth.resetPasswordForEmail(String(corpo.email ?? ""), { redirectTo: contexto.urlLoja });
    if (error) throw erroDeAuth(error);
    return { ok: true };
  }],
  ["GET", "/equipe", ({ rpc }) => rpc("admin_equipe")],
  ["POST", "/equipe", ({ rpc, corpo }) => rpc("admin_equipe_papel", { email: corpo.email, papel: corpo.papel ?? "admin" })],
  ["PATCH", "/equipe/:id", ({ rpc, params, corpo }) => rpc("admin_equipe_ativo", { id: params.id, ativo: corpo.ativo })],

  // marketing e reputação
  ["GET", "/cupons", ({ rpc }) => rpc("admin_cupons")],
  ["POST", "/cupons", ({ rpc, corpo }) => rpc("admin_salvar_cupom", { ...corpo, id: undefined })],
  ["PUT", "/cupons/:id", ({ rpc, params, corpo }) => rpc("admin_salvar_cupom", { ...corpo, id: Number(params.id) })],
  ["DELETE", "/cupons/:id", ({ rpc, params }) => rpc("admin_excluir_cupom", { id: Number(params.id) })],
  ["GET", "/avaliacoes", ({ rpc }) => rpc("admin_avaliacoes")],
  ["PATCH", "/avaliacoes/:id", ({ rpc, params, corpo }) => rpc("admin_moderar_avaliacao", { ...corpo, id: Number(params.id) })],
  ["GET", "/favoritos", ({ rpc }) => rpc("admin_favoritos")],

  // atividade e primeiros passos
  ["GET", "/auditoria", ({ rpc, consulta }) => rpc("admin_auditoria", consulta)],
  ["GET", "/checklist", ({ rpc }) => rpc("admin_checklist")],

  // integrações: PIX automático e avisos por WhatsApp
  ["GET", "/gateway", ({ rpc }) => rpc("admin_gateway")],
  ["PUT", "/gateway", ({ rpc, corpo }) => rpc("admin_salvar_gateway", corpo)],
  ["POST", "/gateway/segredo", ({ rpc }) => rpc("admin_gerar_segredo_gateway", {})],
  ["GET", "/avisos", ({ rpc }) => rpc("admin_avisos")],
  ["PUT", "/avisos", ({ rpc, corpo }) => rpc("admin_salvar_avisos", corpo)],
  ["POST", "/avisos/enviar", ({ supabase, corpo }) => invocarFuncao(supabase, "whatsapp-avisar", corpo)],
  ["GET", "/pedidos/:id/avisos", ({ rpc, params }) => rpc("admin_avisos_pedido", { id: params.id })],

  // estoque: ingredientes, receitas e previsão de compras
  ["GET", "/ingredientes", ({ rpc }) => rpc("admin_ingredientes")],
  ["POST", "/ingredientes", ({ rpc, corpo }) => rpc("admin_salvar_ingrediente", { ...corpo, id: undefined })],
  ["PUT", "/ingredientes/:id", ({ rpc, params, corpo }) => rpc("admin_salvar_ingrediente", { ...corpo, id: Number(params.id) })],
  ["DELETE", "/ingredientes/:id", ({ rpc, params }) => rpc("admin_excluir_ingrediente", { id: Number(params.id) })],
  ["POST", "/estoque/movimentos", ({ rpc, corpo }) => rpc("admin_estoque_movimentar", corpo)],
  ["GET", "/estoque/movimentos", ({ rpc, consulta }) => rpc("admin_estoque_historico", consulta)],
  ["PUT", "/estoque/config", ({ rpc, corpo }) => rpc("admin_estoque_configurar", corpo)],
  ["GET", "/estoque/previsao", ({ rpc, consulta }) => rpc("admin_estoque_previsao", consulta)],
  ["POST", "/estoque/compra", ({ rpc, corpo }) => rpc("admin_estoque_receber_compra", corpo)],
  ["POST", "/estoque/contagem", ({ rpc, corpo }) => rpc("admin_estoque_contagem", corpo)],
  ["POST", "/estoque/simular", ({ rpc, corpo }) => rpc("admin_estoque_simular", corpo)],
  ["GET", "/estoque/custos", ({ rpc }) => rpc("admin_estoque_custos")],
  ["PUT", "/estoque/custos", ({ rpc, corpo }) => rpc("admin_estoque_custos_configurar", corpo)],
  ["GET", "/estoque/precos/:id", ({ rpc, params }) => rpc("admin_ingrediente_precos", { ingrediente_id: Number(params.id) })],
  ["PUT", "/estoque/preco-produto/:id", ({ rpc, params, corpo }) => rpc("admin_ajustar_preco_produto", { ...corpo, id: Number(params.id) })],
  ["GET", "/estoque/lucro", ({ rpc, consulta }) => rpc("admin_estoque_lucro", consulta)],
  ["GET", "/estoque/aviso", ({ rpc }) => rpc("admin_estoque_aviso_config", {})],
  ["PUT", "/estoque/aviso", ({ rpc, corpo }) => rpc("admin_estoque_aviso_config", corpo)],
  ["GET", "/estoque/lotes", ({ rpc, consulta }) => rpc("admin_estoque_lotes", consulta)],
  ["DELETE", "/estoque/lotes/:id", ({ rpc, params }) => rpc("admin_estoque_descartar_lote", { id: Number(params.id) })],
  ["GET", "/preparos", ({ rpc }) => rpc("admin_preparos")],
  ["POST", "/preparos", ({ rpc, corpo }) => rpc("admin_salvar_preparo", { ...corpo, id: undefined })],
  ["PUT", "/preparos/:id", ({ rpc, params, corpo }) => rpc("admin_salvar_preparo", { ...corpo, id: Number(params.id) })],
  ["DELETE", "/preparos/:id", ({ rpc, params }) => rpc("admin_excluir_preparo", { id: Number(params.id) })],
  ["GET", "/receitas", ({ rpc }) => rpc("admin_receitas")],
  ["GET", "/receitas/:id", ({ rpc, params }) => rpc("admin_receita", { produto_id: Number(params.id) })],
  ["PUT", "/receitas/:id", ({ rpc, params, corpo }) => rpc("admin_salvar_receita", { ...corpo, produto_id: Number(params.id) })],

  // planilhas
  ["GET", "/exportar/pedidos", ({ rpc, consulta }) => rpc("admin_exportar_pedidos", consulta)],
  ["GET", "/exportar/clientes", ({ rpc }) => rpc("admin_exportar_clientes")],

  // agenda e produção
  ["GET", "/agenda", ({ rpc, consulta }) => rpc("admin_agenda", consulta)],
  ["PUT", "/agenda/data", ({ rpc, corpo }) => rpc("admin_bloquear_data", corpo)],
  ["GET", "/producao", ({ rpc, consulta }) => rpc("admin_producao", consulta)],

  // loja: configurações e entrega
  ["GET", "/configuracoes", ({ rpc }) => rpc("admin_config")],
  // nome, logo e aparência da loja: públicos, para a tela de login já sair com a cara da loja
  ["GET", "/loja/publico", ({ rpc }) => rpc("loja_config")],
  ["PUT", "/configuracoes/agenda", ({ rpc, corpo }) => rpc("admin_salvar_agenda", corpo)],
  ["PUT", "/configuracoes/sinal", ({ rpc, corpo }) => rpc("admin_salvar_sinal", corpo)],
  ["PUT", "/configuracoes/aparencia", ({ rpc, corpo }) => rpc("admin_salvar_aparencia", corpo)],
  ["PUT", "/configuracoes/:secao", ({ rpc, params, corpo }) => rpc("admin_salvar_config", { secao: params.secao, dados: corpo })],
  ["GET", "/zonas", ({ rpc }) => rpc("admin_zonas")],
  ["POST", "/zonas", ({ rpc, corpo }) => rpc("admin_salvar_zona", { ...corpo, id: undefined })],
  ["PUT", "/zonas/:id", ({ rpc, params, corpo }) => rpc("admin_salvar_zona", { ...corpo, id: Number(params.id) })],
  ["DELETE", "/zonas/:id", ({ rpc, params }) => rpc("admin_excluir_zona", { id: Number(params.id) })],
];

/** contexto: { urlLoja } — para onde vai o link do e-mail de redefinição de senha do cliente. */
export const criarApiPainel = (supabase, contexto = {}) => criarApi({ supabase, rotas: rotasPainel, contexto });
