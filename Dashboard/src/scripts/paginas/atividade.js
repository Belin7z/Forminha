/* PÁGINA — atividade: quem mudou o quê no painel (só administrador) */
import { html, montar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { dataHora } from "/src/scripts/base/formatacao.js";
import { api } from "../nucleo/api.js";
import { PAPEIS } from "../nucleo/permissoes.js";
import { cabecalhoPagina, carregandoPagina, erroPagina, vazio } from "../componentes/pagina.js";

const TABELAS = {
  produtos: "Produto", categorias: "Categoria", cupons: "Cupom", zonas_entrega: "Faixa de entrega", configuracoes: "Configuração",
  datas_bloqueadas: "Data bloqueada", pagamentos_pedido: "Pagamento", perfis: "Acesso",
  ingredientes: "Ingrediente", receitas: "Receita", estoque_config: "Estoque",
};
const SECOES = {
  loja: "dados da loja", textos: "textos do site", horarios: "horários", pedidos: "regras de pedido", entrega: "entrega", pagamento: "pagamento (PIX)",
  sinal: "sinal", agenda: "agenda", galeria: "galeria de fotos", faq: "perguntas frequentes", legal: "textos legais",
};
const CAMPOS = {
  nome: "nome", preco: "preço", ativo: "ativo", ativa: "ativa", destaque: "destaque", descricao: "descrição", valor: "valor", tipo: "tipo", minimo: "mínimo",
  validade: "validade", limite_uso: "limite de usos", categoria_id: "categoria", opcoes: "opções", imagem: "foto", papel: "papel", taxa: "taxa", ate_km: "até (km)",
  prazo_min: "prazo", motivo: "motivo", alergenos: "alérgenos", galeria: "fotos extras", limite_diario: "limite por dia", tag: "selo", ordem: "ordem",
  unidade: "medida", embalagem_qtd: "quantidade da embalagem", embalagem_nome: "embalagem", embalagem_preco: "preço da embalagem", fornecedor: "fornecedor",
  rendimento: "rendimento", revisao: "versão da receita", baixa_automatica: "baixa automática", dias_previsao: "período da previsão",
  fardo_nome: "fardo", fardo_qtd: "embalagens por fardo", fardo_preco: "preço do fardo", local: "local guardado",
};
const VERBO = { criou: "criou", alterou: "alterou", removeu: "removeu" };

const valorTexto = (campo, v) => {
  if (v === "" || v == null) return "vazio";
  if (campo === "papel") return PAPEIS[v] ?? "cliente";
  if (v === "true") return "sim";
  if (v === "false") return "não";
  return v.length > 40 ? `${v.slice(0, 40)}…` : v;
};

function detalhe(a) {
  const campos = Object.entries(a.detalhes ?? {});
  if (a.tabela === "configuracoes") return ""; // os valores são longos: o nome da seção já diz o que mudou
  if (!campos.length) return "";
  const linhas = campos.slice(0, 3).map(([c, m]) => `${CAMPOS[c] ?? c}: ${valorTexto(c, m.de)} → ${valorTexto(c, m.para)}`);
  return linhas.join(" · ") + (campos.length > 3 ? ` · +${campos.length - 3}` : "");
}

const alvo = (a) => (a.tabela === "configuracoes" ? `de ${SECOES[a.resumo] ?? a.resumo}` : a.resumo);

export async function atividade(ctx) {
  montar(ctx.raiz, carregandoPagina);
  let itens;
  try { itens = (await api.get("/auditoria?limite=200")).itens; }
  catch (erro) { montar(ctx.raiz, erroPagina(erro.message)); return; }
  if (!ctx.ativo()) return;

  montar(ctx.raiz, html`
    ${cabecalhoPagina({ titulo: "Atividade", descricao: "Quem mudou o quê no painel (produtos, cupons, configurações, pagamentos e acessos). Mostra as 200 mudanças mais recentes." })}
    ${itens.length ? html`<div class="cartao cartao--sem-margem"><div class="tabela-rolagem"><table class="tabela">
      <thead><tr><th>Quando</th><th>Quem</th><th>O que foi feito</th><th>Detalhes</th></tr></thead>
      <tbody>${itens.map((a) => html`<tr>
        <td class="nowrap"><small>${dataHora(a.quando)}</small></td>
        <td><strong>${a.usuario || "—"}</strong></td>
        <td>${VERBO[a.operacao]} <span class="badge badge--neutro">${TABELAS[a.tabela] ?? a.tabela}</span> ${alvo(a)}</td>
        <td><small class="texto-suave">${detalhe(a)}</small></td></tr>`)}</tbody></table></div></div>`
      : vazio("relogio", "Nada registrado ainda", "Quando alguém mudar produtos, cupons, configurações ou acessos, aparece aqui.")}`);
}
