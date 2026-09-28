/* ==========================================================
   BASE — sugestões prontas para quem está começando a loja:
   nomes de categoria, unidades de venda e o ícone de uma
   categoria nova a partir do nome ("Bolos de pote" → bolo).
   ========================================================== */
export const SUGESTOES_CATEGORIA = ["Bolos", "Docinhos", "Tortas", "Cupcakes", "Kits e presentes"];
export const SUGESTOES_UNIDADE = ["unidade", "bolo 1 kg", "fatia", "caixa com 6", "cento"];

const ICONE_POR_PALAVRA = [
  [/bolo/, "bolo"], [/torta/, "torta"], [/cupcake/, "cupcake"], [/macaron/, "macaron"], [/cookie|biscoit/, "cookie"],
  [/chocolate|trufa|bombo|\bovos?\b/, "chocolate"], [/brigadeiro|doce|docinho|beijinho/, "brigadeiro"], [/fatia/, "fatia"],
  [/sorvete|gelad|picol/, "sorvete"], [/rosquinha|donut/, "rosquinha"], [/morango/, "morango"], [/p[aã]o|salgad/, "pao"],
  [/caf[eé]/, "cafe"], [/kit|presente|cesta/, "presente"], [/caixa/, "caixa"], [/festa/, "festa"], [/flor/, "flor"],
];

/** Ícone da lista do banco que combina com o nome da categoria (sem palpite bom: bolo). */
export const iconeDaCategoria = (nome) => ICONE_POR_PALAVRA.find(([r]) => r.test(String(nome ?? "").toLowerCase()))?.[1] ?? "bolo";
