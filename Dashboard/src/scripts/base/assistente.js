/* ==========================================================
   BASE — o que cada passo do assistente de primeiros passos
   salva. Código sem tela: recebe a `api` do painel, para a página
   e os testes usarem exatamente o mesmo caminho.
   ========================================================== */
import { paraCentavos } from "./formatacao.js";
import { normalizarAparencia, temaPorId } from "./tema.js";
import { normalizarChavePix } from "./chave-pix.js";
import { iconeDaCategoria } from "./sugestoes.js";

export const NOME_PADRAO = "Minha Doceria";

/** Erro que o formulário mostra embaixo do campo certo. */
export const erroNoCampo = (nome, mensagem) => Object.assign(new Error(mensagem), { campos: { [nome]: mensagem } });

/** Quais passos já estão feitos, a partir das configurações e da lista de primeiros passos do banco. */
export function passosFeitos(cfg, itens = []) {
  const doBanco = (id) => itens.find((i) => i.id === id)?.feito ?? false;
  return {
    loja: Boolean(cfg.loja?.whatsapp) && Boolean(cfg.loja?.nome) && cfg.loja.nome !== NOME_PADRAO,
    logo: Boolean(cfg.loja?.logo),
    cores: doBanco("aparencia"),
    produto: doBanco("produtos"),
    pix: doBanco("pix"),
  };
}

/** Passo 1: nome, WhatsApp, cidade e UF (o resto dos dados da loja fica como está). */
export async function salvarLoja(api, cfg, d) {
  const nome = String(d.nome ?? "").trim();
  if (nome.length < 2) throw erroNoCampo("nome", "Escreva o nome da loja.");
  if (!String(d.whatsapp ?? "").trim()) throw erroNoCampo("whatsapp", "Informe o WhatsApp da loja.");
  const { configuracoes } = await api.put("/configuracoes/loja", { ...cfg.loja, ...d, nome });
  return configuracoes;
}

/** Passo 2: envia a logo (já enquadrada) e apaga a anterior do Storage. */
export async function salvarLogo(api, cfg, imagem) {
  const antiga = cfg.loja.logo;
  const { url } = await api.post("/site/imagem", { imagem });
  const { configuracoes } = await api.put("/configuracoes/loja", { ...cfg.loja, logo: url });
  if (antiga) await api.post("/site/imagem/apagar", { url: antiga }).catch(() => {});
  return configuracoes;
}

/** Passo 3: tema escolhido. Tema novo leva a letra que combina com ele; o mesmo tema mantém a letra atual. */
export function aparenciaEscolhida(atual, tema) {
  const a = normalizarAparencia(atual);
  if (tema === "personalizado") return { tema, fonte: a.fonte, cores: a.cores };
  return { tema, fonte: tema === a.tema ? a.fonte : (temaPorId(tema)?.fonte ?? a.fonte) };
}

export async function salvarCores(api, cfg, tema) {
  const { configuracoes } = await api.put("/configuracoes/aparencia", aparenciaEscolhida(cfg.aparencia, tema));
  return configuracoes;
}

/**
 * Passo 4: um doce com o básico. A categoria pode ser uma que já existe (pelo nome, sem ligar
 * para maiúsculas) ou nova, criada na hora com o ícone que combina com o nome.
 * Devolve a lista de categorias atualizada.
 */
export async function salvarDoce(api, { categorias, dados: d, foto = null, destaque = false }) {
  const nome = String(d.nome ?? "").trim();
  if (nome.length < 2) throw erroNoCampo("nome", "Escreva o nome do doce.");
  const preco = paraCentavos(d.preco);
  if (!(preco > 0)) throw erroNoCampo("preco", "Informe o preço.");
  const nomeCategoria = String(d.categoria ?? "").trim();
  if (nomeCategoria.length < 2) throw erroNoCampo("categoria", "Escolha ou escreva uma categoria.");
  const achar = (lista) => lista.find((c) => c.nome.trim().toLowerCase() === nomeCategoria.toLowerCase());
  let lista = categorias;
  if (!achar(lista)) {
    try { ({ categorias: lista } = await api.post("/categorias", { nome: nomeCategoria, icone: iconeDaCategoria(nomeCategoria), ativa: true })); }
    catch (erro) { throw erroNoCampo("categoria", erro.message); }
  }
  await api.post("/produtos", {
    nome, descricao: String(d.descricao ?? "").trim(), preco, unidade: String(d.unidade ?? "").trim() || "unidade", min_qtd: 1,
    categoria_id: achar(lista).id, ativo: true, destaque, tag: "", antecedencia_horas: "", limite_diario: "", disponivel_de: "", disponivel_ate: "",
    alergenos: [], galeria: [], opcoes: [], ...(foto && { imagem_nova: foto }),
  });
  return lista;
}

/** Passo 5: liga o PIX com a chave no formato do banco (dinheiro e cartão como ela marcou). */
export async function salvarPix(api, cfg, d) {
  let chave;
  try { chave = normalizarChavePix(d.pix_chave, d.tipo); } catch (erro) { throw erroNoCampo("pix_chave", erro.message); }
  const nome = String(d.pix_nome ?? "").trim();
  const cidade = String(d.pix_cidade ?? "").trim();
  if (!nome) throw erroNoCampo("pix_nome", "Escreva o nome de quem recebe.");
  if (!cidade) throw erroNoCampo("pix_cidade", "Escreva a cidade.");
  const { configuracoes } = await api.put("/configuracoes/pagamento", {
    ...cfg.pagamento, pix_ativo: true, pix_chave: chave, pix_nome: nome, pix_cidade: cidade,
    dinheiro_ativo: Boolean(d.dinheiro_ativo), cartao_ativo: Boolean(d.cartao_ativo),
  });
  return configuracoes;
}
