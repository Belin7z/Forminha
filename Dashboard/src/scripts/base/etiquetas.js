/* ==========================================================
   ETIQUETAS — o que vai em cada etiqueta impressa (sem depender
   da tela; testado). O desenho e a impressão ficam em
   componentes/etiquetas.js.
   Conteúdo: nome (e opções escolhidas), ingredientes, alérgicos,
   "contém glúten", como conservar, fabricação, validade, lote e a
   identificação da loja. Quem confere as exigências da vigilância
   sanitária para o seu caso é a loja (o painel avisa).
   ========================================================== */
import { ALERGENOS } from "./dominio.js";
import { telefone } from "./formatacao.js";
import { opcoesEmTexto } from "./opcoes.js";

export { opcoesEmTexto };

/** Tamanhos de etiqueta: as térmicas (uma por "página") e a folha A4 com 21 (63,5 × 38,1 mm, a mais comum). */
export const TAMANHOS = {
  "60x40": { nome: "Térmica 60 × 40 mm", largura: 60, altura: 40 },
  "100x50": { nome: "Térmica 100 × 50 mm", largura: 100, altura: 50 },
  "a4-21": { nome: "Folha A4 com 21 etiquetas (63,5 × 38,1 mm)", largura: 63.5, altura: 38.1,
    folha: { colunas: 3, linhas: 7, topo: 15.15, esquerda: 7.2, espacoColunas: 2.5 } },
};
export const TAMANHO_PADRAO = "60x40";

const dois = (n) => String(n).padStart(2, "0");
/** "2026-10-01" -> "01/10/2026" */
export const dataBR = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(String(iso)) ? iso.split("-").reverse().join("/") : "");

/** Fabricação + dias de validade -> data de validade ("AAAA-MM-DD"), ou "" se o produto não tem validade cadastrada. */
export function validadeDe(fabricacao, dias) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fabricacao)) || !(Number(dias) >= 1)) return "";
  const [a, m, d] = fabricacao.split("-").map(Number);
  const v = new Date(a, m - 1, d + Number(dias));
  return `${v.getFullYear()}-${dois(v.getMonth() + 1)}-${dois(v.getDate())}`;
}

const listaEmTexto = (itens) => itens.join(", ").replace(/, ([^,]*)$/, " e $1");

/** "ALÉRGICOS: CONTÉM LEITE E OVOS." (os nomes sem a explicação entre parênteses). */
export function textoAlergicos(alergenos = []) {
  const nomes = ALERGENOS.filter(([id]) => alergenos.includes(id)).map(([, nome]) => nome.replace(/\s*\(.*\)$/, ""));
  return nomes.length ? `ALÉRGICOS: CONTÉM ${listaEmTexto(nomes)}.`.toUpperCase() : "";
}

/** A identificação da loja numa linha: "Doce da Bia · Rua X, 10 — Santos/SP · (13) 99999-0000". */
export function identificacaoDaLoja(loja = {}) {
  const endereco = [loja.endereco, loja.cidade && `${loja.cidade}${loja.uf ? `/${loja.uf}` : ""}`].filter(Boolean).join(" — ");
  return [loja.nome, endereco, loja.whatsapp && telefone(loja.whatsapp)].filter(Boolean).join(" · ");
}

/**
 * Os textos de UMA etiqueta.
 * item: { nome, opcoes?, cliente? } · produto: o produto cadastrado (ingredientes, alérgenos, validade…) ou null
 * fabricacao: "AAAA-MM-DD" · lote: texto (ex.: o código do pedido) · extra: linha livre (ex.: CNPJ)
 */
export function dadosDaEtiqueta({ item, produto = null, loja = {}, fabricacao, lote = "", extra = "", mostrarCliente = false }) {
  const alergenos = produto?.alergenos ?? [];
  const validade = validadeDe(fabricacao, produto?.validade_dias);
  return {
    nome: String(item.nome ?? produto?.nome ?? "").trim(),
    detalhe: opcoesEmTexto(item.opcoes),
    cliente: mostrarCliente && item.cliente ? `Para: ${item.cliente}` : "",
    ingredientes: String(produto?.ingredientes ?? "").trim(),
    alergicos: textoAlergicos(alergenos),
    gluten: alergenos.includes("gluten") ? "CONTÉM GLÚTEN." : "",
    conservacao: String(produto?.conservacao ?? "").trim(),
    fabricacao: dataBR(fabricacao),
    validade: dataBR(validade),
    lote: String(lote ?? "").trim(),
    loja: identificacaoDaLoja(loja),
    extra: String(extra ?? "").trim(),
  };
}

/** O que falta no produto para a etiqueta sair completa (para avisar a dona antes de imprimir). */
export function faltandoNaEtiqueta(produto) {
  if (!produto) return ["produto não encontrado no cardápio"];
  return [!String(produto.ingredientes ?? "").trim() && "ingredientes", !(produto.validade_dias >= 1) && "validade"].filter(Boolean);
}

/** Etiquetas -> páginas: cada etiqueta térmica é uma página; na folha A4, 21 por página. */
export function paginar(etiquetas, tamanho) {
  const t = TAMANHOS[tamanho] ?? TAMANHOS[TAMANHO_PADRAO];
  if (!t.folha) return etiquetas.map((e) => [e]);
  const porFolha = t.folha.colunas * t.folha.linhas;
  const paginas = [];
  for (let i = 0; i < etiquetas.length; i += porFolha) paginas.push(etiquetas.slice(i, i + porFolha));
  return paginas;
}
