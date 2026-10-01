/* ==========================================================
   COMPONENTE — foto para envio.
   • prepararFoto: reduz o tamanho e converte (fotos de celular têm vários MB).
   • escolherFoto: abre o assistente — enquadrar (arrastar e dar zoom) na
     proporção certa de cada lugar do site, girar, centralizar e clarear,
     com avisos ao vivo de foto pequena, escura, estourada de luz ou
     desfocada. Serve para foto nova (arquivo) e para reajustar uma foto
     que já está no site (endereço).
   As contas ficam em base/imagem.js (testadas).
   ========================================================== */
import { html } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { abrirModal } from "/src/scripts/base/ui.js";
import { corDoTema } from "/src/scripts/base/tema.js";
import { ajustarBrilho, areaDoRecorte, brilhoSugerido, centralizar, escalaBase, limitarPosicao, medidaGirada } from "/src/scripts/base/imagem.js";


/**
 * Reduz a imagem para no máximo `lado` px. Devolve um data URL.
 * `formato`: "image/jpeg" (padrão, mais leve) ou "image/png" (mantém o fundo transparente, ideal para logo).
 */
export function prepararFoto(arquivo, { lado = 1200, qualidade = 0.86, formato = "image/jpeg" } = {}) {
  return new Promise((ok, falhar) => {
    if (!/^image\/(png|jpe?g|webp)$/.test(arquivo.type)) return falhar(new Error("Envie uma imagem PNG, JPG ou WEBP."));
    const leitor = new FileReader();
    leitor.onerror = () => falhar(new Error("Não foi possível ler a imagem."));
    leitor.onload = () => {
      const img = new Image();
      img.onerror = () => falhar(new Error("A imagem parece estar corrompida."));
      img.onload = () => {
        const escala = Math.min(1, lado / Math.max(img.width, img.height));
        const tela = document.createElement("canvas");
        tela.width = Math.round(img.width * escala);
        tela.height = Math.round(img.height * escala);
        const c = tela.getContext("2d");
        if (formato === "image/jpeg") { c.fillStyle = "#fff"; c.fillRect(0, 0, tela.width, tela.height); } // PNG transparente vira fundo branco no JPEG
        c.drawImage(img, 0, 0, tela.width, tela.height);
        ok(tela.toDataURL(formato, qualidade));
      };
      img.src = leitor.result;
    };
    leitor.readAsDataURL(arquivo);
  });
}

/* ---------- Assistente de foto ---------- */
/** Medidas recomendadas por lugar do site (proporcao = largura/altura; null = sem recorte, como a logo). */
export const FOTOS = {
  logo:     { titulo: "Logo",                    proporcao: null,    ladoMin: 300, lado: 700,  formato: "image/png",  dica: "PNG com fundo transparente fica melhor. Mínimo recomendado: 300 px de largura." },
  hero:     { titulo: "Foto de destaque",        proporcao: 1,       ladoMin: 900, lado: 1600, formato: "image/jpeg", dica: "Foto quadrada (1:1). É a maior da página inicial: use a sua melhor foto, com o principal no centro." },
  sobre:    { titulo: "Foto da seção Sobre nós", proporcao: 4 / 5,   ladoMin: 700, lado: 1400, formato: "image/jpeg", dica: "Foto vertical (4:5), com o rosto ou as mãos trabalhando." },
  galeria:  { titulo: "Foto da galeria",         proporcao: 1,       ladoMin: 700, lado: 1400, formato: "image/jpeg", dica: "Foto quadrada (1:1)." },
  produto:  { titulo: "Foto do produto",         proporcao: 5 / 4,   ladoMin: 800, lado: 1400, formato: "image/jpeg", dica: "Foto na horizontal (5:4). O doce deve ocupar bem o quadro." },
  extra:    { titulo: "Foto extra do produto",   proporcao: 16 / 10, ladoMin: 900, lado: 1600, formato: "image/jpeg", dica: "Foto na horizontal (16:10), aparece na janela do produto." },
};

/** Arquivo escolhido agora ou endereço de uma foto que já está no site. */
function carregarImagem(origem) {
  return new Promise((ok, falhar) => {
    const img = new Image();
    if (typeof origem === "string") {
      // foto já enviada: pede com CORS (para poder recortar) e sem o cache da miniatura, que veio sem CORS
      img.crossOrigin = "anonymous";
      img.onload = () => ok({ img, url: null });
      img.onerror = () => falhar(new Error("Não foi possível abrir esta foto para ajustar. Envie a foto de novo."));
      img.src = `${origem}${origem.includes("?") ? "&" : "?"}ajuste=${Date.now()}`;
      return;
    }
    if (!/^image\/(png|jpe?g|webp)$/.test(origem.type)) return falhar(new Error("Envie uma imagem PNG, JPG ou WEBP."));
    const url = URL.createObjectURL(origem);
    img.onload = () => ok({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); falhar(new Error("A imagem parece estar corrompida.")); };
    img.src = url;
  });
}

/** A foto girada (90°, 180° ou 270°) num canvas, para recortar como se fosse a original. */
function girarImagem(img, graus) {
  const w0 = img.naturalWidth, h0 = img.naturalHeight;
  const { w, h } = medidaGirada(w0, h0, graus);
  const tela = document.createElement("canvas");
  tela.width = w; tela.height = h;
  const g = tela.getContext("2d");
  g.translate(w / 2, h / 2);
  g.rotate((graus * Math.PI) / 180);
  g.drawImage(img, -w0 / 2, -h0 / 2);
  return tela;
}

/** Luz média (0–255) e nitidez (variância do laplaciano) — só para avisar, nunca bloqueia. */
export function analisarImagem(img) {
  const t = 96;
  const tela = document.createElement("canvas");
  tela.width = tela.height = t;
  const g = tela.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0, t, t);
  const d = g.getImageData(0, 0, t, t).data;
  const cinza = new Float32Array(t * t);
  let soma = 0;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) { cinza[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; soma += cinza[p]; }
  let s1 = 0, s2 = 0, n = 0;
  for (let y = 1; y < t - 1; y++) for (let x = 1; x < t - 1; x++) {
    const i = y * t + x;
    const l = 4 * cinza[i] - cinza[i - 1] - cinza[i + 1] - cinza[i - t] - cinza[i + t];
    s1 += l; s2 += l * l; n++;
  }
  return { luz: soma / (t * t), nitidez: s2 / n - (s1 / n) ** 2 };
}

/** Avisos sobre a foto. `pixelsUteis` = largura, em pixels da foto original, que ficou dentro do quadro. */
export function avisosDaFoto({ pixelsUteis, ladoMin, luz, nitidez, analisarLuz = true }) {
  const avisos = [];
  if (pixelsUteis < ladoMin) avisos.push(`A foto ficou pequena (${Math.round(pixelsUteis)} px de largura no quadro) e pode aparecer embaçada. O ideal é a partir de ${ladoMin} px: tire a foto mais perto ou diminua o zoom.`);
  if (analisarLuz) {
    if (luz < 55) avisos.push("A foto está bem escura. Tente fotografar perto de uma janela, com luz do dia.");
    else if (luz > 225) avisos.push("A foto está com muita luz (estourada). Fotografe longe do sol direto ou de flash.");
    if (nitidez < 8) avisos.push("A foto parece desfocada. Limpe a lente, apoie o celular e toque na tela para focar no doce.");
  }
  return avisos;
}

/**
 * Abre o assistente. `origem`: o arquivo escolhido agora ou o endereço de uma foto que já está no site.
 * Devolve o data URL pronto para enviar, ou null se a pessoa cancelar. `tipo`: uma chave de FOTOS.
 */
export async function escolherFoto(origem, tipo) {
  const cfg = FOTOS[tipo];
  const { img, url } = await carregarImagem(origem);
  let luz, nitidez;
  try { ({ luz, nitidez } = analisarImagem(img)); }
  catch { throw new Error("Não foi possível abrir esta foto para ajustar. Envie a foto de novo."); } // servidor sem CORS
  const recorta = cfg.proporcao != null;
  // quadro de visualização
  const largMax = Math.min(400, Math.max(260, (window.innerWidth || 400) - 96));
  const proporcao = cfg.proporcao ?? Math.min(2, Math.max(0.6, img.naturalWidth / img.naturalHeight));
  const VW = proporcao >= 1 ? largMax : Math.round(largMax * proporcao * 1.1);
  const VH = Math.round(VW / proporcao);

  return new Promise((resolver) => {
    let concluido = false;
    let fonte = img, giro = 0, w = img.naturalWidth, h = img.naturalHeight;
    let zoom = 1, brilho = 1, ox = 0, oy = 0;
    const escala = () => escalaBase({ w, h, VW, VH, recorta }) * zoom;
    const limitar = () => ({ ox, oy } = limitarPosicao({ w, h, VW, VH, escala: escala(), ox, oy }));
    const centrar = () => ({ ox, oy } = centralizar({ w, h, VW, VH, escala: escala() }));
    const escura = luz < 55;

    const m = abrirModal({
      titulo: cfg.titulo, largura: VW + 64, classe: "modal-recorte",
      corpo: html`
        <div class="recorte">
          <div class="recorte__quadro ${!recorta && "recorte__quadro--logo"}" style="width:${VW}px;height:${VH}px" tabindex="0" aria-label="Enquadramento da foto: arraste ou use as setas">
            <canvas width="${VW}" height="${VH}" data-recorte></canvas>
          </div>
          <div class="recorte__botoes">
            <button type="button" class="btn btn--suave btn--pequeno" data-girar>${icone("atualizar", { tamanho: 15 })} Girar</button>
            ${recorta && html`<button type="button" class="btn btn--suave btn--pequeno" data-centralizar>Centralizar</button>`}
            ${escura && html`<button type="button" class="btn btn--suave btn--pequeno" data-clarear>Clarear automático</button>`}
          </div>
          ${recorta && html`<label class="recorte__zoom">Zoom <input type="range" min="100" max="300" value="100" data-zoom aria-label="Zoom"></label>`}
          <label class="recorte__zoom">Luz <input type="range" min="60" max="160" value="100" data-luz aria-label="Luz da foto"></label>
          <p class="texto-suave recorte__dica">${recorta ? "Arraste a foto para escolher o que aparece. " : ""}${cfg.dica}</p>
          <ul class="recorte__avisos" data-avisos aria-live="polite"></ul>
        </div>`,
      rodape: html`<button type="button" class="btn btn--suave" data-fechar>Cancelar</button>
        <button type="button" class="btn btn--primario" data-usar>Usar esta foto</button>`,
      aoFechar: () => { if (url) URL.revokeObjectURL(url); if (!concluido) resolver(null); },
    });

    const tela = m.el.querySelector("[data-recorte]");
    const g = tela.getContext("2d");
    const quadro = m.el.querySelector(".recorte__quadro");
    const barraZoom = m.el.querySelector("[data-zoom]");
    const barraLuz = m.el.querySelector("[data-luz]");

    function desenhar() {
      limitar();
      g.clearRect(0, 0, VW, VH);
      if (!recorta) { g.fillStyle = corDoTema("--marca-100", "#fbe9ef"); g.fillRect(0, 0, VW, VH); }
      const s = escala();
      g.drawImage(fonte, ox, oy, w * s, h * s);
      tela.style.filter = brilho === 1 ? "" : `brightness(${brilho})`; // a prévia; a foto salva é clareada pixel a pixel
      const pixelsUteis = Math.min(w, VW / s);
      const avisos = avisosDaFoto({ pixelsUteis: recorta ? pixelsUteis : w, ladoMin: cfg.ladoMin, luz: luz * brilho, nitidez, analisarLuz: recorta });
      m.el.querySelector("[data-avisos]").innerHTML = avisos.length
        ? avisos.map((a) => `<li class="recorte__aviso">${a.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</li>`).join("")
        : '<li class="recorte__ok">Tudo certo com esta foto.</li>';
    }

    // arrastar
    let arraste = null;
    quadro.addEventListener("pointerdown", (ev) => { arraste = { x: ev.clientX, y: ev.clientY, ox, oy }; quadro.setPointerCapture(ev.pointerId); });
    quadro.addEventListener("pointermove", (ev) => { if (!arraste) return; ox = arraste.ox + (ev.clientX - arraste.x); oy = arraste.oy + (ev.clientY - arraste.y); desenhar(); });
    const soltar = () => { arraste = null; };
    quadro.addEventListener("pointerup", soltar);
    quadro.addEventListener("pointercancel", soltar);
    quadro.addEventListener("keydown", (ev) => {
      const passo = { ArrowLeft: [24, 0], ArrowRight: [-24, 0], ArrowUp: [0, 24], ArrowDown: [0, -24] }[ev.key];
      if (!passo) return;
      ev.preventDefault(); ox += passo[0]; oy += passo[1]; desenhar();
    });
    // zoom (mantém o centro do quadro no mesmo ponto da foto)
    barraZoom?.addEventListener("input", (ev) => {
      const antes = escala();
      const cx = (VW / 2 - ox) / antes, cy = (VH / 2 - oy) / antes;
      zoom = Number(ev.target.value) / 100;
      ox = VW / 2 - cx * escala(); oy = VH / 2 - cy * escala();
      desenhar();
    });
    barraLuz.addEventListener("input", (ev) => { brilho = Number(ev.target.value) / 100; desenhar(); });
    m.el.querySelector("[data-girar]").addEventListener("click", () => {
      giro = (giro + 90) % 360;
      fonte = giro ? girarImagem(img, giro) : img;
      ({ w, h } = medidaGirada(img.naturalWidth, img.naturalHeight, giro));
      zoom = 1;
      if (barraZoom) barraZoom.value = "100";
      centrar(); desenhar();
    });
    m.el.querySelector("[data-centralizar]")?.addEventListener("click", () => { centrar(); desenhar(); quadro.focus(); });
    m.el.querySelector("[data-clarear]")?.addEventListener("click", () => {
      brilho = brilhoSugerido(luz);
      barraLuz.value = String(Math.round(brilho * 100));
      desenhar();
    });

    m.el.querySelector("[data-usar]").addEventListener("click", () => {
      limitar();
      const a = areaDoRecorte({ w, h, VW, VH, escala: escala(), ox, oy, recorta, lado: cfg.lado });
      const saida = document.createElement("canvas");
      saida.width = a.largura; saida.height = a.altura;
      const c = saida.getContext("2d", { willReadFrequently: brilho !== 1 });
      if (cfg.formato === "image/jpeg") { c.fillStyle = "#fff"; c.fillRect(0, 0, a.largura, a.altura); }
      c.drawImage(fonte, a.sx, a.sy, a.sw, a.sh, 0, 0, a.largura, a.altura);
      if (brilho !== 1) {
        const pixels = c.getImageData(0, 0, a.largura, a.altura);
        ajustarBrilho(pixels.data, brilho);
        c.putImageData(pixels, 0, 0);
      }
      concluido = true;
      resolver(saida.toDataURL(cfg.formato, 0.88));
      m.fechar();
    });

    centrar();
    desenhar();
    quadro.focus();
  });
}
