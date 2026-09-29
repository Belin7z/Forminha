/* ==========================================================
   TEMA — o gerador de cores e a personalização do build.
     - qualquer combinação de cores gera texto legível (contraste WCAG);
     - o tema "Rosa e dourado" reproduz a paleta original;
     - o que vem do banco é sempre normalizado (nada quebra o site);
     - o build troca título, descrição, cores e ícone pelos da loja.
   ========================================================== */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FONTES, TEMAS, TEMA_PADRAO, contraste, gerarPaleta, gerarTokens, hexParaOklch, normalizarAparencia, oklchParaHex, pacoteDoTema,
} from "../../src/scripts/base/tema.js";
import {
  faviconDaLoja, iniciaisDaLoja, manifestoDaLoja, manifestoDoPainel, personalizarHtmlLoja, personalizarHtmlPainel, textosDaLoja,
} from "../../build/personalizar.mjs";
import { readFileSync } from "node:fs";

// Regras de leitura: [cor do texto, fundo, contraste mínimo]
const REGRAS = [
  ["--marca-destaque", "#ffffff", 4.5], ["--marca-destaque", "--fundo", 4.5], ["--marca-texto", "--marca-100", 4.5],
  ["--escura", "#ffffff", 9], ["--texto", "--fundo", 9], ["--texto-suave", "--fundo", 4.5], ["--texto-suave", "#ffffff", 4.5],
  ["--sobre-profunda", "--profunda", 9], ["--sobre-profunda-suave", "--profunda", 7], ["--sobre-profunda-apagado", "--profunda", 4.5],
  ["--detalhe", "#ffffff", 3],
];
const confereLeitura = (t, onde) => {
  for (const [a, b, min] of REGRAS) {
    const r = contraste(t[a], b.startsWith("#") ? b : t[b]);
    assert.ok(r >= min, `${onde}: ${a} sobre ${b} tem contraste ${r.toFixed(2)} (mínimo ${min})`);
  }
};
const HEX = /^#[0-9a-f]{6}$/;
// sorteio reproduzível (sempre os mesmos números)
let semente = 20260927;
const sorteio = () => ((semente = (semente * 1103515245 + 12345) % 2147483648) / 2147483648);
const corQualquer = () => "#" + Array.from({ length: 3 }, () => Math.floor(sorteio() * 256).toString(16).padStart(2, "0")).join("");

describe("cores", () => {
  it("hex -> OKLCH -> hex devolve a mesma cor", () => {
    for (let i = 0; i < 300; i++) {
      const c = corQualquer();
      const { L, C, H } = hexParaOklch(c);
      assert.equal(oklchParaHex(L, C, H), c);
    }
  });

  it("todos os temas prontos são legíveis e só têm cores válidas", () => {
    for (const t of TEMAS) {
      const tokens = gerarTokens({ tema: t.id });
      confereLeitura(tokens, `tema ${t.id}`);
      for (const [k, v] of Object.entries(tokens)) if (!k.startsWith("--f-") && !k.endsWith("-rgb")) assert.match(v, HEX, `${t.id} ${k}`);
    }
  });

  it("QUALQUER combinação de 3 cores gera um tema legível (400 sorteios + casos extremos)", () => {
    const extremos = [["#ffffff", "#ffffff", "#ffffff"], ["#000000", "#000000", "#000000"], ["#ffff00", "#ffff00", "#ffff00"], ["#00ff00", "#ff00ff", "#00ffff"], ["#808080", "#c0c0c0", "#404040"]];
    const casos = [...extremos, ...Array.from({ length: 400 }, () => [corQualquer(), corQualquer(), corQualquer()])];
    for (const [marca, escura, detalhe] of casos) confereLeitura(gerarPaleta({ marca, escura, detalhe }), `${marca} ${escura} ${detalhe}`);
  });

  it("o gerador, a partir das 3 cores da paleta original, chega imperceptivelmente perto dela", () => {
    const original = TEMAS.find((t) => t.id === "rosa-dourado");
    const gerada = gerarPaleta(original.cores);
    const dist = (a, b) => { const x = hexParaOklch(a), y = hexParaOklch(b); const r = Math.PI / 180;
      return Math.hypot(x.L - y.L, x.C * Math.cos(x.H * r) - y.C * Math.cos(y.H * r), x.C * Math.sin(x.H * r) - y.C * Math.sin(y.H * r)) * 100; };
    for (const k of Object.keys(original.exato)) assert.ok(dist(original.exato[k], gerada[k]) < 2, `${k}: ${original.exato[k]} x ${gerada[k]}`);
  });

  it("o tema Rosa e dourado usa exatamente a paleta desenhada à mão", () => {
    const t = gerarTokens({ tema: "rosa-dourado" });
    assert.equal(t["--escura"], "#4f2436");
    assert.equal(t["--marca-300"], "#f4c9d9");
    assert.equal(t["--detalhe"], "#b08a58");
    assert.equal(t["--escura-rgb"], "79 36 54");
    assert.equal(t["--f-titulo"], FONTES.elegante.titulo);
  });

  it("o tokens.css (visual padrão, antes do tema carregar) é o próprio tema Neutro", () => {
    const css = readFileSync(new URL("../../src/estilos/base/tokens.css", import.meta.url), "utf8");
    const neutro = gerarTokens({ tema: TEMA_PADRAO });
    for (const [k, v] of Object.entries(neutro)) {
      if (k.startsWith("--f-")) continue;
      const m = new RegExp(`${k}:\\s*([^;]+);`).exec(css);
      assert.ok(m, `tokens.css não define ${k}`);
      assert.equal(m[1].trim(), v, `tokens.css ${k}`);
    }
  });
});

describe("aparência vinda do banco", () => {
  it("vazia ou estranha vira o tema padrão; tema pronto ignora cores soltas", () => {
    assert.deepEqual(normalizarAparencia(undefined), { tema: "neutro", cores: TEMAS[0].cores, fonte: "elegante" });
    assert.equal(normalizarAparencia({ tema: "nao-existe" }).tema, "neutro");
    const pronto = normalizarAparencia({ tema: "menta", cores: { marca: "#ff0000" } });
    assert.equal(pronto.cores.marca, TEMAS.find((t) => t.id === "menta").cores.marca);
    assert.equal(pronto.fonte, "moderno", "sem escolha, usa a letra do próprio tema");
  });

  it("personalizado: usa as cores dela; cor inválida cai no padrão em vez de quebrar", () => {
    const a = normalizarAparencia({ tema: "personalizado", cores: { marca: "#AABBCC", escura: "vermelho", detalhe: "#123" }, fonte: "delicado" });
    assert.equal(a.cores.marca, "#aabbcc");
    assert.equal(a.cores.escura, TEMAS[0].cores.escura);
    assert.equal(a.cores.detalhe, TEMAS[0].cores.detalhe);
    assert.equal(a.fonte, "delicado");
    assert.equal(normalizarAparencia({ tema: "personalizado", fonte: "comic-sans" }).fonte, "elegante");
  });

  it("o pacote do navegador leva as cores e o endereço da fonte certa", () => {
    const p = pacoteDoTema({ tema: "lavanda" });
    assert.equal(p.fonteUrl, FONTES.delicado.url);
    assert.match(p.tokens["--escura"], HEX);
  });
});

describe("build personalizado", () => {
  const HTML = readFileSync(new URL("../../../Loja/index.html", import.meta.url), "utf8");
  const dados = {
    loja: { nome: "Doce da Ana", slogan: "Brigadeiros & bolos", logo: "https://x.supabase.co/storage/v1/object/public/site/logo.png" },
    textos: { hero_subtitulo: 'Doces "gourmet" <feitos> à mão' },
    aparencia: { tema: "pistache" },
  };

  it("título, descrição, imagem e cor da barra saem com os dados da loja (e escapados)", () => {
    const h = personalizarHtmlLoja(HTML, dados);
    assert.match(h, /<title>Doce da Ana — Brigadeiros &amp; bolos<\/title>/);
    assert.match(h, /<meta property="og:site_name" content="Doce da Ana">/);
    assert.match(h, /<meta name="description" content="Doces &quot;gourmet&quot; &lt;feitos&gt; à mão">/);
    assert.match(h, /<meta property="og:image" content="https:\/\/x\.supabase\.co\/storage\/v1\/object\/public\/site\/logo\.png">/);
    assert.match(h, new RegExp(`<meta name="theme-color" content="${gerarTokens({ tema: "pistache" })["--escura"]}">`));
    assert.doesNotMatch(h, /Loja de doces/, "nada do texto genérico sobra");
  });

  it("o Dashboard leva o nome da loja no título", () => {
    const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
    assert.match(personalizarHtmlPainel(html, dados), /<title>Painel — Doce da Ana<\/title>/);
  });

  it("aplicativo instalável com nome curto e cores do tema", () => {
    const m = manifestoDaLoja({ name: "x", short_name: "x", icons: [1] }, { ...dados, loja: { nome: "Confeitaria Bela Vista do Sul" } });
    assert.equal(m.name, "Confeitaria Bela Vista do Sul");
    assert.ok(m.short_name.length <= 12);
    assert.deepEqual(m.icons, [1], "mantém os ícones");
    assert.equal(m.theme_color, gerarTokens({ tema: "pistache" })["--escura"]);
  });

  it("o painel também vira aplicativo: nome da loja, cores do tema, atalhos e ícones mantidos", () => {
    const base = JSON.parse(readFileSync(new URL("../../manifest.webmanifest", import.meta.url), "utf8"));
    const m = manifestoDoPainel(base, dados);
    assert.equal(m.name, "Painel — Doce da Ana");
    assert.equal(m.short_name, "Painel");
    assert.equal(m.theme_color, gerarTokens(dados.aparencia)["--escura"]);
    assert.deepEqual(m.shortcuts.map((s) => s.url), ["/#/pedidos", "/#/agenda"]);
    assert.ok(m.icons.some((i) => i.sizes === "512x512" && i.purpose === "maskable"), "ícone que se adapta ao formato do celular");
    assert.equal(m.display, "standalone");
  });

  it("ícone da aba com as iniciais da loja", () => {
    assert.equal(iniciaisDaLoja("Doce da Ana"), "DA");
    assert.equal(iniciaisDaLoja("Brigaderia"), "BR");
    assert.equal(iniciaisDaLoja("Ateliê de Doces Érica"), "AE");
    assert.match(faviconDaLoja(dados), />DA<\/text><\/svg>$/);
  });

  it("sem nome, usa um texto genérico (nunca fica vazio)", () => {
    assert.equal(textosDaLoja({ loja: {}, textos: {} }).titulo, "Loja de doces");
  });
});
