/* ==========================================================
   COMPONENTE — foto para envio.
   • prepararFoto: reduz o tamanho e converte (fotos de celular têm vários MB).
   • escolherFoto: abre o assistente — enquadrar (arrastar e dar zoom) na
     proporção certa de cada lugar do site, com avisos ao vivo de foto
     pequena, escura, estourada de luz ou desfocada.
   ========================================================== */
import { html } from "/src/scripts/base/html.js";
import { abrirModal } from "/src/scripts/base/ui.js";
import { corDoTema } from "/src/scripts/base/tema.js";


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
  hero:     { titulo: "Foto de destaque",        proporcao: 4 / 5,   ladoMin: 900, lado: 1600, formato: "image/jpeg", dica: "Foto vertical (4:5). É a maior da página inicial: use a sua melhor foto." },
  sobre:    { titulo: "Foto da seção Nossa história",     proporcao: 4 / 5,   ladoMin: 700, lado: 1400, formato: "image/jpeg", dica: "Foto vertical (4:5), com o rosto ou as mãos trabalhando." },
  galeria:  { titulo: "Foto da galeria",         proporcao: 1,       ladoMin: 700, lado: 1400, formato: "image/jpeg", dica: "Foto quadrada (1:1)." },
  produto:  { titulo: "Foto do produto",         proporcao: 5 / 4,   ladoMin: 800, lado: 1400, formato: "image/jpeg", dica: "Foto na horizontal (5:4). O doce deve ocupar bem o quadro." },
  extra:    { titulo: "Foto extra do produto",   proporcao: 16 / 10, ladoMin: 900, lado: 1600, formato: "image/jpeg", dica: "Foto na horizontal (16:10), aparece na janela do produto." },
};

function carregarImagem(arquivo) {
  return new Promise((ok, falhar) => {
    if (!/^image\/(png|jpe?g|webp)$/.test(arquivo.type)) return falhar(new Error("Envie uma imagem PNG, JPG ou WEBP."));
    const url = URL.createObjectURL(arquivo);
    const img = new Image();
    img.onload = () => ok({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); falhar(new Error("A imagem parece estar corrompida.")); };
    img.src = url;
  });
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
 * Abre o assistente para `arquivo`. Devolve o data URL pronto para enviar, ou null se a pessoa cancelar.
 * `tipo`: uma chave de FOTOS.
 */
export async function escolherFoto(arquivo, tipo) {
  const cfg = FOTOS[tipo];
  const { img, url } = await carregarImagem(arquivo);
  const { luz, nitidez } = analisarImagem(img);
  const w = img.naturalWidth, h = img.naturalHeight;
  const recorta = cfg.proporcao != null;
  // quadro de visualização
  const largMax = Math.min(400, Math.max(260, (window.innerWidth || 400) - 96));
  const proporcao = cfg.proporcao ?? Math.min(2, Math.max(0.6, w / h));
  const VW = proporcao >= 1 ? largMax : Math.round(largMax * proporcao * 1.1);
  const VH = Math.round(VW / proporcao);

  return new Promise((resolver) => {
    let concluido = false;
    let zoom = 1, ox = 0, oy = 0;
    const cobrir = recorta ? Math.max(VW / w, VH / h) : Math.min(VW / w, VH / h);
    const escala = () => cobrir * zoom;
    const limitar = () => {
      const iw = w * escala(), ih = h * escala();
      ox = iw <= VW ? (VW - iw) / 2 : Math.min(0, Math.max(VW - iw, ox));
      oy = ih <= VH ? (VH - ih) / 2 : Math.min(0, Math.max(VH - ih, oy));
    };

    const m = abrirModal({
      titulo: cfg.titulo, largura: VW + 64, classe: "modal-recorte",
      corpo: html`
        <div class="recorte">
          <div class="recorte__quadro ${!recorta && "recorte__quadro--logo"}" style="width:${VW}px;height:${VH}px" tabindex="0" aria-label="Enquadramento da foto: arraste ou use as setas">
            <canvas width="${VW}" height="${VH}" data-recorte></canvas>
          </div>
          ${recorta && html`<label class="recorte__zoom">Zoom <input type="range" min="100" max="300" value="100" data-zoom aria-label="Zoom"></label>`}
          <p class="texto-suave recorte__dica">${recorta ? "Arraste a foto para escolher o que aparece. " : ""}${cfg.dica}</p>
          <ul class="recorte__avisos" data-avisos aria-live="polite"></ul>
        </div>`,
      rodape: html`<button type="button" class="btn btn--suave" data-fechar>Cancelar</button>
        <button type="button" class="btn btn--primario" data-usar>Usar esta foto</button>`,
      aoFechar: () => { URL.revokeObjectURL(url); if (!concluido) resolver(null); },
    });

    const tela = m.el.querySelector("[data-recorte]");
    const g = tela.getContext("2d");
    const quadro = m.el.querySelector(".recorte__quadro");

    function desenhar() {
      limitar();
      g.clearRect(0, 0, VW, VH);
      if (!recorta) { g.fillStyle = corDoTema("--marca-100", "#fbe9ef"); g.fillRect(0, 0, VW, VH); }
      const s = escala();
      g.drawImage(img, ox, oy, w * s, h * s);
      const pixelsUteis = Math.min(w, VW / s);
      const avisos = avisosDaFoto({ pixelsUteis: recorta ? pixelsUteis : w, ladoMin: cfg.ladoMin, luz, nitidez, analisarLuz: recorta });
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
    m.el.querySelector("[data-zoom]")?.addEventListener("input", (ev) => {
      const antes = escala();
      const cx = (VW / 2 - ox) / antes, cy = (VH / 2 - oy) / antes;
      zoom = Number(ev.target.value) / 100;
      ox = VW / 2 - cx * escala(); oy = VH / 2 - cy * escala();
      desenhar();
    });

    m.el.querySelector("[data-usar]").addEventListener("click", () => {
      limitar();
      const s = escala();
      const sx = recorta ? -ox / s : 0, sy = recorta ? -oy / s : 0;
      const sw = recorta ? VW / s : w, sh = recorta ? VH / s : h;
      const saidaW = Math.max(1, Math.round(Math.min(cfg.lado, sw)));
      const saidaH = Math.max(1, Math.round(saidaW * (sh / sw)));
      const saida = document.createElement("canvas");
      saida.width = saidaW; saida.height = saidaH;
      const c = saida.getContext("2d");
      if (cfg.formato === "image/jpeg") { c.fillStyle = "#fff"; c.fillRect(0, 0, saidaW, saidaH); }
      c.drawImage(img, sx, sy, sw, sh, 0, 0, saidaW, saidaH);
      concluido = true;
      resolver(saida.toDataURL(cfg.formato, 0.88));
      m.fechar();
    });

    desenhar();
    quadro.focus();
  });
}
