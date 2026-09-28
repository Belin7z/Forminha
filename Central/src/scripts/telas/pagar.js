/* ==========================================================
   TELA PÚBLICA — pagamento da loja (#/pagar/<link único>).
   A cliente vê só o necessário: nome da loja, valor, QR Code e o
   PIX copia e cola. Depois de pagar, a página acompanha a criação
   da loja e avisa que o acesso foi para o e-mail dela.
   ========================================================== */
import { bruto, html, montar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { copiar, toast } from "/src/scripts/base/ui.js";
import { api, marca, raiz, reais } from "../nucleo.js";
import { botaoTema } from "../claro-escuro.js";

let bibliotecaQr = null;
/** Gerador de QR Code (MIT, em src/vendor) — só carrega nesta página. */
function carregarQr() {
  bibliotecaQr ??= new Promise((ok, falhar) => {
    if (window.qrcode) return ok(window.qrcode);
    const s = document.createElement("script");
    s.src = "/src/vendor/qrcode.js";
    s.onload = () => ok(window.qrcode);
    s.onerror = falhar;
    document.head.append(s);
  });
  return bibliotecaQr;
}

async function desenharQr(alvo, dados) {
  if (dados.qr_base64) { montar(alvo, html`<img src="data:image/png;base64,${dados.qr_base64}" alt="QR Code do PIX" width="220" height="220">`); return; }
  try {
    const qrcode = await carregarQr();
    const qr = qrcode(0, "M");
    qr.addData(dados.pix);
    qr.make();
    montar(alvo, bruto(qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true })));
    alvo.querySelector("svg")?.setAttribute("aria-label", "QR Code do PIX");
  } catch { montar(alvo, ""); }
}

export async function telaPagar(token) {
  document.title = "Pagamento — Forminha";
  montar(raiz, html`
    <main class="pagar">
      <header class="pagar__topo">${marca}${botaoTema()}</header>
      <section class="pagar__cartao" data-cartao><div class="carregando-pagina"><div class="spinner"></div></div></section>
      <p class="pagar__rodape">${icone("cadeado", { tamanho: 13 })} Pagamento por PIX · Forminha</p>
    </main>`);
  const cartao = raiz.querySelector("[data-cartao]");
  let ultimo = null;
  let parar = false;

  function desenhar(d) {
    const chave = `${d.situacao}|${d.loja_pronta}|${Math.round(d.progresso * 10)}`;
    if (chave === ultimo) return;
    const primeira = ultimo === null;
    ultimo = chave;
    if (d.situacao === "cancelado") {
      montar(cartao, html`<div class="pagar__estado">${icone("alerta", { tamanho: 34 })}<h1>Esta cobrança não vale mais</h1>
        <p class="texto-suave">Foi substituída ou cancelada. Fale com quem te enviou o link.</p></div>`);
      parar = true;
      return;
    }
    if (d.situacao === "pago") {
      montar(cartao, html`
        <div class="pagar__estado pagar__estado--ok">
          <span class="pagar__check">${icone("check", { tamanho: 30 })}</span>
          <h1>${d.loja_pronta ? "Tudo pronto!" : "Pagamento confirmado"}</h1>
          <p class="pagar__loja">${d.nome_loja}</p>
          ${d.loja_pronta
            ? html`<p>Enviamos o link de acesso à sua loja para <strong>${d.email}</strong>.</p><p class="texto-suave">Não chegou? Olhe a caixa de spam ou fale com a gente.</p>`
            : html`<p class="texto-suave">Estamos criando a sua loja. Leva poucos minutos — pode fechar esta página: o acesso chega no seu e-mail (<strong>${d.email}</strong>).</p>
              <div class="pagar__barra" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(d.progresso * 100)}"><span style="width:${Math.max(6, Math.round(d.progresso * 100))}%"></span></div>`}
        </div>`);
      if (d.loja_pronta) parar = true;
      return;
    }
    if (!primeira) return; // pendente: não redesenha (o QR e o código ficam como estão)
    montar(cartao, html`
      <p class="pagar__sobre">Pagamento da loja</p>
      <h1 class="pagar__loja-titulo">${d.nome_loja}</h1>
      <p class="pagar__valor">${reais(d.valor_centavos)}</p>
      <div class="pagar__qr" data-qr></div>
      <ol class="pagar__passos"><li>Abra o app do seu banco e escolha <strong>PIX</strong>.</li><li>Leia o QR Code ou use o código abaixo.</li><li>Pronto: o acesso chega no seu e-mail.</li></ol>
      <div class="pagar__codigo"><code>${d.pix}</code></div>
      <button type="button" class="btn btn--primario btn--grande btn--bloco" data-copiar-pix>${icone("copiar", { tamanho: 17 })} Copiar código PIX</button>
      <p class="pagar__espera"><span class="spinner spinner--pequeno"></span> Aguardando o pagamento…${d.automatico ? "" : " (a confirmação pode levar alguns minutos)"}</p>`);
    desenharQr(cartao.querySelector("[data-qr]"), d);
    cartao.querySelector("[data-copiar-pix]").addEventListener("click", async () => { await copiar(d.pix); toast("Código PIX copiado."); });
  }

  async function atualizar() {
    try { desenhar(await api("GET", `publico/pagamento/${token}`)); }
    catch (erro) {
      if (erro.status === 404) {
        montar(cartao, html`<div class="pagar__estado">${icone("alerta", { tamanho: 34 })}<h1>Link não encontrado</h1><p class="texto-suave">Confira se o link foi copiado inteiro.</p></div>`);
        parar = true;
      }
    }
  }
  await atualizar();
  while (!parar) {
    await new Promise((ok) => setTimeout(ok, 5000));
    if (document.visibilityState === "visible" || Math.random() < 0.3) await atualizar();
  }
}
