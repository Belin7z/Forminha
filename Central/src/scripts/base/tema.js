/* ==========================================================
   TEMA — transforma a aparência escolhida pela loja (3 cores + estilo
   de letra) em todas as variáveis de cor que o site usa.
   A dona escolhe só: a cor da marca, uma cor escura (títulos e botões)
   e a cor dos detalhes. O resto (tons claros, bordas, textos, rodapé)
   é calculado aqui, sempre com contraste suficiente para leitura —
   mesmo que ela escolha uma cor clara demais para texto.
   Serve no navegador e no Node (o build usa para gravar o tema no site).
   ========================================================== */

/* ---------- cores: hex <-> OKLCH (espaço de cor "perceptual") ---------- */
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gam = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export const corValida = (v) => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v.trim());

function hexParaLinear(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => lin(v / 255));
}

export function hexParaOklch(hex) {
  const [r, g, b] = hexParaLinear(hex);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { L, C: Math.hypot(A, B), H: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
}

function oklchParaLinear(L, C, H) {
  const a = C * Math.cos((H * Math.PI) / 180), b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}

const cabe = (rgb) => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

/** OKLCH -> hex. Se a cor não existir na tela, reduz a intensidade (croma) até caber, sem mudar tom nem claridade. */
export function oklchParaHex(L, C, H) {
  L = Math.min(1, Math.max(0, L));
  let rgb = oklchParaLinear(L, C, H);
  if (!cabe(rgb)) {
    let baixo = 0, alto = C;
    for (let i = 0; i < 24; i++) { const meio = (baixo + alto) / 2; if (cabe(oklchParaLinear(L, meio, H))) baixo = meio; else alto = meio; }
    rgb = oklchParaLinear(L, baixo, H);
  }
  return "#" + rgb.map((v) => Math.round(Math.min(1, Math.max(0, gam(Math.min(1, Math.max(0, v))))) * 255).toString(16).padStart(2, "0")).join("");
}

const luminancia = (hex) => { const [r, g, b] = hexParaLinear(hex); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };

/** Contraste WCAG entre duas cores (1 a 21). Texto normal precisa de 4,5 ou mais. */
export function contraste(a, b) {
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Escurece (passo < 0) ou clareia (passo > 0) até atingir o contraste mínimo contra TODOS os fundos. */
function comContraste(L, C, H, fundos, minimo, passo = -0.01) {
  let hex = oklchParaHex(L, C, H);
  for (let i = 0; i < 100 && fundos.some((f) => contraste(hex, f) < minimo); i++) {
    L += passo;
    if (L <= 0 || L >= 1) break;
    hex = oklchParaHex(L, C, H);
  }
  return hex;
}

const rgbDe = (hex) => { const n = parseInt(hex.slice(1), 16); return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`; };
const limitar = (v, min, max) => Math.min(max, Math.max(min, v));

/* ---------- estilos de letra ---------- */
const GOOGLE = "https://fonts.googleapis.com/css2?";
export const FONTES = {
  elegante: {
    nome: "Elegante", descricao: "Serifada fina e sofisticada",
    titulo: '"Cormorant Garamond", "Playfair Display", Georgia, serif', corpo: '"Jost", system-ui, -apple-system, "Segoe UI", sans-serif',
    url: GOOGLE + "family=Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,500;1,600&family=Jost:wght@300;400;500;600&display=swap",
    script: "italic", ajusteTitulo: "none", ajusteCorpo: "none",
  },
  classico: {
    nome: "Clássico", descricao: "Serifada marcante, tradicional",
    titulo: '"Playfair Display", Georgia, serif', corpo: '"Source Sans 3", system-ui, -apple-system, "Segoe UI", sans-serif',
    url: GOOGLE + "family=Playfair+Display:ital,wght@0,500;0,600;0,700;1,500;1,600&family=Source+Sans+3:wght@300;400;500;600&display=swap",
    // Source Sans é mais estreita que a Jost: no tamanho natural fica equivalente
    script: "italic", ajusteTitulo: "0.42", ajusteCorpo: "none",
  },
  moderno: {
    nome: "Moderno", descricao: "Sem serifa, limpo e direto",
    titulo: '"Poppins", system-ui, -apple-system, "Segoe UI", sans-serif', corpo: '"Poppins", system-ui, -apple-system, "Segoe UI", sans-serif',
    url: GOOGLE + "family=Poppins:ital,wght@0,300;0,400;0,500;0,600;1,500;1,600&display=swap",
    script: "italic", ajusteTitulo: "0.40", ajusteCorpo: "0.47",
  },
  delicado: {
    nome: "Delicado", descricao: "Arredondado, fofo e acolhedor",
    titulo: '"Fredoka", system-ui, -apple-system, "Segoe UI", sans-serif', corpo: '"Nunito", system-ui, -apple-system, "Segoe UI", sans-serif',
    url: GOOGLE + "family=Fredoka:wght@400;500;600&family=Nunito:wght@300;400;500;600;700&display=swap",
    script: "normal", ajusteTitulo: "0.42", ajusteCorpo: "0.47",
  },
};

/* ---------- temas prontos ---------- */
// "exato": paleta desenhada à mão que não passa pelo gerador (o Rosa e dourado clássico).
const ROSA_DOURADO = {
  "--marca-25": "#fffcfd", "--marca-50": "#fef7f9", "--marca-100": "#fcedf2", "--marca-200": "#f9dde7", "--marca-300": "#f4c9d9",
  "--marca-400": "#ebaac4", "--marca-500": "#df88a8", "--marca-destaque": "#b4527a", "--marca-texto": "#96395f",
  "--escura": "#4f2436", "--escura-hover": "#3d1a29", "--escura-brilho": "#5d2b41", "--profunda": "#2e1a24", "--profunda-hover": "#1f1018",
  // texto-suave: o original (#82707a) ficava com contraste 4,46 sobre o fundo; este é imperceptivelmente diferente e passa de 4,5
  "--texto": "#4a3540", "--texto-suave": "#816d74", "--texto-apagado": "#b8a3ad",
  "--creme": "#fdf8f4", "--borda": "#efe0e7", "--borda-forte": "#e6d3db", "--neutro-bg": "#f3ecef", "--fundo": "#fffaf9",
  "--detalhe": "#b08a58", "--detalhe-claro": "#ead9bd",
  "--sobre-profunda": "#e9d6de", "--sobre-profunda-suave": "#d9c4cd", "--sobre-profunda-apagado": "#b89aa8",
};

export const TEMAS = [
  { id: "neutro", nome: "Neutro", descricao: "Areia e café, discreto e elegante", cores: { marca: "#e3d8cc", escura: "#2f2925", detalhe: "#a8895f" }, fonte: "moderno" },
  { id: "rosa-dourado", nome: "Rosa e dourado", descricao: "Rosa bebê, vinho e champanhe", cores: { marca: "#f4c9d9", escura: "#4f2436", detalhe: "#b08a58" }, fonte: "elegante", exato: ROSA_DOURADO },
  { id: "chocolate", nome: "Chocolate", descricao: "Caramelo e cacau", cores: { marca: "#e8cdb4", escura: "#3d2217", detalhe: "#b0874f" }, fonte: "classico" },
  { id: "pistache", nome: "Pistache", descricao: "Verde suave e dourado", cores: { marca: "#cfe0bf", escura: "#2c4127", detalhe: "#b08a58" }, fonte: "elegante" },
  { id: "lavanda", nome: "Lavanda", descricao: "Lilás delicado", cores: { marca: "#dcd0f0", escura: "#362a55", detalhe: "#a88d62" }, fonte: "delicado" },
  { id: "pessego", nome: "Pêssego", descricao: "Pêssego e terracota", cores: { marca: "#f8cfb8", escura: "#5a2a1e", detalhe: "#c0874a" }, fonte: "delicado" },
  { id: "menta", nome: "Menta", descricao: "Verde-água refrescante", cores: { marca: "#c5e6dd", escura: "#1d4640", detalhe: "#b08a58" }, fonte: "moderno" },
  { id: "cereja", nome: "Cereja", descricao: "Vermelho doce e clássico", cores: { marca: "#f3c5c5", escura: "#5c1620", detalhe: "#b8914f" }, fonte: "classico" },
];
export const TEMA_PADRAO = "neutro";
export const temaPorId = (id) => TEMAS.find((t) => t.id === id);

/** Aceita qualquer coisa vinda do banco e devolve uma aparência completa e válida. */
export function normalizarAparencia(a) {
  const base = temaPorId(a?.tema) ?? (a?.tema === "personalizado" ? null : temaPorId(TEMA_PADRAO));
  const padrao = temaPorId(TEMA_PADRAO);
  const cores = {};
  for (const k of ["marca", "escura", "detalhe"]) {
    const v = a?.cores?.[k];
    cores[k] = base ? base.cores[k] : corValida(v) ? v.trim().toLowerCase() : padrao.cores[k];
  }
  const fonte = FONTES[a?.fonte] ? a.fonte : (base ?? padrao).fonte;
  return { tema: base ? base.id : "personalizado", cores, fonte };
}

/* ---------- gerador ---------- */
// Proporções medidas na paleta original (claridade e intensidade de cada tom).
const RAMPA = [[25, 0.994, 0.003], [50, 0.982, 0.008], [100, 0.959, 0.017], [200, 0.923, 0.033], [300, 0.878, 0.053], [400, 0.806, 0.083], [500, 0.727, 0.113]];

/** As 3 cores escolhidas -> todas as variáveis de cor, com contraste garantido. */
export function gerarPaleta({ marca, escura, detalhe }) {
  const M = hexParaOklch(marca), E = hexParaOklch(escura), D = hexParaOklch(detalhe);
  const k = limitar(M.C / 0.053, 0, 1.6);           // intensidade da cor da marca
  const t = {};
  for (const [passo, L, C] of RAMPA) t[`--marca-${passo}`] = oklchParaHex(L, C * k, M.H);
  t["--fundo"] = oklchParaHex(0.989, 0.006 * Math.min(k, 1), M.H);
  t["--creme"] = oklchParaHex(0.982, 0.008, D.H);
  t["--borda"] = oklchParaHex(0.921, 0.019 * Math.min(k, 1.2), M.H);
  t["--borda-forte"] = oklchParaHex(0.885, 0.024 * Math.min(k, 1.2), M.H);
  t["--neutro-bg"] = oklchParaHex(0.949, 0.008 * Math.min(k, 1.2), M.H);

  const claros = ["#ffffff", t["--fundo"]];
  const cDest = limitar(0.134 * k, 0.03, 0.16);
  t["--marca-destaque"] = comContraste(0.573, cDest, M.H, claros, 4.5);
  t["--marca-texto"] = comContraste(0.485, cDest, M.H, [...claros, t["--marca-100"]], 6);

  const cE = Math.min(E.C, 0.1);
  const lE = limitar(E.L, 0.22, 0.36);
  t["--escura"] = comContraste(lE, cE, E.H, claros, 9);
  const lEsc = hexParaOklch(t["--escura"]).L;
  t["--escura-hover"] = oklchParaHex(lEsc - 0.052, cE * 0.84, E.H);
  t["--escura-brilho"] = oklchParaHex(lEsc + 0.038, cE * 1.13, E.H);
  t["--profunda"] = oklchParaHex(Math.max(0.16, lEsc - 0.078), cE * 0.52, E.H);
  t["--profunda-hover"] = oklchParaHex(Math.max(0.12, lEsc - 0.128), cE * 0.42, E.H);

  const cT = Math.min(cE * 0.5, 0.04);
  t["--texto"] = comContraste(0.357, cT, E.H, claros, 9);
  t["--texto-suave"] = comContraste(0.565, Math.min(cE * 0.39, 0.03), E.H, claros, 4.5);
  t["--texto-apagado"] = oklchParaHex(0.737, Math.min(cE * 0.4, 0.03), E.H);

  const escuros = [t["--profunda"], t["--escura"]];
  const cS = Math.min(cE * 0.36, 0.03);
  t["--sobre-profunda"] = comContraste(0.894, cS, E.H, escuros, 9, 0.01);
  t["--sobre-profunda-suave"] = comContraste(0.84, cS * 1.1, E.H, escuros, 7, 0.01);
  t["--sobre-profunda-apagado"] = comContraste(0.717, Math.min(cE * 0.58, 0.045), E.H, [t["--profunda"]], 4.5, 0.01);

  const cD = Math.min(D.C, 0.14);
  t["--detalhe"] = comContraste(limitar(D.L, 0.5, 0.72), cD, D.H, ["#ffffff"], 3);
  t["--detalhe-claro"] = oklchParaHex(0.892, Math.min(cD * 0.52, 0.06), D.H);
  return t;
}

/** Aparência (do banco) -> todas as variáveis CSS: cores, versões "r g b" para transparência e letras. */
export function gerarTokens(aparencia) {
  const a = normalizarAparencia(aparencia);
  const tema = temaPorId(a.tema);
  const t = { ...(tema?.exato ?? gerarPaleta(a.cores)) };
  for (const nome of ["--escura", "--profunda", "--detalhe", "--detalhe-claro", "--fundo", "--marca-300"]) t[`${nome}-rgb`] = rgbDe(t[nome]);
  const f = FONTES[a.fonte];
  t["--f-titulo"] = f.titulo;
  t["--f-corpo"] = f.corpo;
  t["--f-script-estilo"] = f.script;
  t["--f-titulo-ajuste"] = f.ajusteTitulo;
  t["--f-corpo-ajuste"] = f.ajusteCorpo;
  return t;
}

/** Pacote pronto para o navegador aplicar logo na abertura (guardado no config.js e no aparelho do visitante). */
export const pacoteDoTema = (aparencia) => {
  const a = normalizarAparencia(aparencia);
  return { tokens: gerarTokens(a), fonteUrl: FONTES[a.fonte].url };
};

/* ---------- navegador ---------- */
const CHAVE_CACHE = "forminha:tema";

/** Aplica o tema na página agora (cores, letras e cor da barra do celular) e guarda para a próxima visita. */
export function aplicarAparencia(aparencia, { guardar = true } = {}) {
  const pacote = pacoteDoTema(aparencia);
  const raiz = document.documentElement.style;
  for (const [k, v] of Object.entries(pacote.tokens)) raiz.setProperty(k, v);
  let link = document.getElementById("fonte-tema");
  if (!link) { link = document.createElement("link"); link.id = "fonte-tema"; link.rel = "stylesheet"; document.head.append(link); }
  if (link.getAttribute("href") !== pacote.fonteUrl) link.setAttribute("href", pacote.fonteUrl);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", pacote.tokens["--escura"]);
  if (guardar) { try { localStorage.setItem(CHAVE_CACHE, JSON.stringify(pacote)); } catch { /* aparelho sem espaço ou modo privado */ } }
  return pacote;
}

/** Lê uma cor do tema atual (para o que não é CSS: mapa, canvas…). */
export const corDoTema = (nome, reserva = "#999999") =>
  (typeof document !== "undefined" && getComputedStyle(document.documentElement).getPropertyValue(nome).trim()) || reserva;
