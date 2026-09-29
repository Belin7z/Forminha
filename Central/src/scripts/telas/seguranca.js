/* ==========================================================
   JANELA — Segurança da conta (qualquer pessoa, a própria conta):
   verificação em duas etapas. Ligar = ler o QR Code no aplicativo
   (Google Authenticator, Microsoft Authenticator, Authy…), digitar
   o primeiro código e guardar os 8 códigos de reserva.
   ========================================================== */
import { html, montar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { abrirModal, ocupado, toast } from "/src/scripts/base/ui.js";
import { ativarCampos, campo, dadosDe, mostrarErros } from "/src/scripts/base/formularios.js";
import { api, aviso, dia } from "../nucleo.js";

export async function abrirSeguranca() {
  const modal = abrirModal({ titulo: "Segurança da conta", largura: 520, corpo: html`<div class="carregando-pagina"><div class="spinner"></div></div>` });
  const corpo = modal.corpo;

  async function inicio() {
    let e;
    try { e = (await api("GET", "seguranca")).duas_etapas; }
    catch (erro) { montar(corpo, aviso("perigo", erro.message)); return; }
    if (!e) { montar(corpo, aviso("aviso", "A verificação em duas etapas precisa do banco e da criptografia da Central ligados.")); return; }
    if (!e.ligada) {
      montar(corpo, html`
        <div class="seguranca">
          <p class="seguranca__estado">${icone("cadeado", { tamanho: 18 })} Verificação em duas etapas <span class="selo selo--neutro">Desligada</span></p>
          <p class="texto-suave">Além da senha, a Central pede o código de 6 números do aplicativo de autenticação do seu celular. Mesmo que alguém descubra a senha, não entra sem o celular.</p>
          <button type="button" class="btn btn--primario" data-ligar>${icone("cadeado", { tamanho: 16 })} Ligar</button>
        </div>`);
      corpo.querySelector("[data-ligar]").addEventListener("click", (ev) => ocupado(ev.currentTarget, ligar));
      return;
    }
    montar(corpo, html`
      <div class="seguranca">
        <p class="seguranca__estado">${icone("cadeado", { tamanho: 18 })} Verificação em duas etapas <span class="selo selo--sucesso">Ligada</span></p>
        <p class="texto-suave">Desde ${dia(e.desde)} · ${e.reservas} ${e.reservas === 1 ? "código de reserva restante" : "códigos de reserva restantes"}.</p>
        ${e.reservas <= 2 && aviso("aviso", "Poucos códigos de reserva. Para ter novos, desligue e ligue de novo.")}
        <details class="seguranca__desligar"><summary>Desligar</summary>
          <form id="form-desligar" class="form-empilhado" novalidate>
            <div class="form-erro" data-erro-geral hidden></div>
            ${campo({ nome: "senha", rotulo: "Sua senha", tipo: "password", obrigatorio: true, atributos: 'autocomplete="current-password"' })}
            ${campo({ nome: "codigo", rotulo: "Código do aplicativo (ou de reserva)", obrigatorio: true, atributos: 'inputmode="numeric" autocomplete="one-time-code" spellcheck="false"' })}
            <button type="submit" class="btn btn--perigo-suave">Desligar a verificação</button>
          </form>
        </details>
      </div>`);
    const form = corpo.querySelector("#form-desligar");
    ativarCampos(form);
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      await ocupado(form.querySelector("[type=submit]"), async () => {
        try { await api("POST", "seguranca/duas-etapas/desligar", dadosDe(form)); toast("Verificação em duas etapas desligada.", "info"); inicio(); }
        catch (erro) { mostrarErros(form, erro); }
      });
    });
  }

  async function ligar() {
    let r;
    try { r = await api("POST", "seguranca/duas-etapas/iniciar", {}); }
    catch (erro) { toast(erro.message, "erro"); return; }
    montar(corpo, html`
      <div class="seguranca">
        <ol class="seguranca__passos">
          <li>Instale um aplicativo de autenticação no celular (Google Authenticator, Microsoft Authenticator ou Authy).</li>
          <li>No aplicativo, toque em <strong>+</strong> e leia este QR Code:</li>
        </ol>
        <img class="seguranca__qr" src="${r.qr}" alt="QR Code para o aplicativo de autenticação" width="200" height="200">
        <details class="seguranca__manual"><summary>Não consegue ler? Digite a chave</summary><code class="seguranca__chave">${r.segredo}</code></details>
        <form id="form-ativar" class="form-empilhado" novalidate>
          <div class="form-erro" data-erro-geral hidden></div>
          ${campo({ nome: "codigo", rotulo: "3. Digite o código que aparece no aplicativo", obrigatorio: true, placeholder: "000 000",
            atributos: 'inputmode="numeric" autocomplete="one-time-code" maxlength="7" autofocus spellcheck="false"' })}
          <button type="submit" class="btn btn--primario">Confirmar e ligar</button>
        </form>
      </div>`);
    const form = corpo.querySelector("#form-ativar");
    ativarCampos(form);
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      await ocupado(form.querySelector("[type=submit]"), async () => {
        try { mostrarReservas((await api("POST", "seguranca/duas-etapas/ativar", dadosDe(form))).codigos); }
        catch (erro) { mostrarErros(form, erro); }
      });
    });
  }

  function mostrarReservas(codigos) {
    const texto = `Forminha — códigos de reserva (cada um vale uma vez)\n\n${codigos.join("\n")}\n`;
    montar(corpo, html`
      <div class="seguranca">
        ${aviso("sucesso", "Pronto: a verificação em duas etapas está ligada.")}
        <p><strong>Guarde estes códigos de reserva</strong> num lugar seguro (fora do celular). Se perder o celular, cada um deixa você entrar uma vez. Eles não aparecem de novo.</p>
        <ul class="seguranca__reservas">${codigos.map((c) => html`<li><code>${c}</code></li>`)}</ul>
        <div class="convite-pronto__botoes">
          <button type="button" class="btn btn--suave btn--pequeno" data-copiar="${codigos.join(" ")}">${icone("copiar", { tamanho: 15 })} Copiar</button>
          <button type="button" class="btn btn--suave btn--pequeno" data-baixar>${icone("baixar", { tamanho: 15 })} Baixar arquivo</button>
          <button type="button" class="btn btn--primario btn--pequeno" data-fechar>Guardei, fechar</button>
        </div>
      </div>`);
    corpo.querySelector("[data-baixar]").addEventListener("click", () => {
      const url = URL.createObjectURL(new Blob([texto], { type: "text/plain;charset=utf-8" }));
      const a = Object.assign(document.createElement("a"), { href: url, download: "forminha-codigos-de-reserva.txt" });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    });
  }

  inicio();
}
