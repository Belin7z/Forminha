/* COMPONENTE — rodapé com contatos, horários e links */
import { html, montar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { DIAS_SEMANA } from "/src/scripts/base/dominio.js";
import { telefone } from "/src/scripts/base/formatacao.js";
import { estado } from "../nucleo/estado.js";
import { aoMudarInstalacao, instalar, podeInstalar } from "/src/scripts/base/instalar.js";

let ligado = false;

export const linkWhats = (texto = "Olá! Vim pelo site e gostaria de fazer um pedido.") => {
  const numero = estado.config.loja.whatsapp;
  return numero ? `https://wa.me/55${numero}?text=${encodeURIComponent(texto)}` : null;
};

export function desenharRodape() {
  const { loja, horarios } = estado.config;
  const whats = linkWhats();
  const dias = [1, 2, 3, 4, 5, 6, 0];

  montar(document.getElementById("rodape"), html`
    <div class="container rodape__grade">
      <div>
        <p class="rodape__marca">${loja.nome}</p>
        ${loja.slogan && html`<p class="rodape__texto">${loja.slogan}</p>`}
        <div class="rodape__redes">
          ${loja.instagram && html`<a href="https://instagram.com/${loja.instagram}" target="_blank" rel="noopener" class="btn-icone btn-icone--contorno" aria-label="Instagram">${icone("instagram")}</a>`}
          ${whats && html`<a href="${whats}" target="_blank" rel="noopener" class="btn-icone btn-icone--contorno" aria-label="WhatsApp">${icone("mensagem")}</a>`}
        </div>
      </div>
      ${(loja.whatsapp || loja.email || loja.endereco) && html`<div>
        <h3>Atendimento</h3>
        <ul class="rodape__lista">
          ${loja.whatsapp && html`<li>${icone("telefone", { tamanho: 16 })} ${telefone(loja.whatsapp)}</li>`}
          ${loja.email && html`<li>${icone("email", { tamanho: 16 })} ${loja.email}</li>`}
          ${loja.endereco && html`<li>${icone("pino", { tamanho: 16 })} ${loja.endereco}${loja.cidade && ` — ${loja.cidade}/${loja.uf}`}</li>`}
        </ul>
      </div>`}
      <div>
        <h3>Horários</h3>
        <ul class="rodape__horarios">
          ${dias.map((d) => html`<li><span>${DIAS_SEMANA[d]}</span><span>${horarios[d].aberto ? `${horarios[d].abre} às ${horarios[d].fecha}` : "Fechado"}</span></li>`)}
        </ul>
      </div>
      <div>
        <h3>Navegue</h3>
        <ul class="rodape__lista rodape__links">
          <li><a href="#/cardapio">Cardápio</a></li>
          <li><a href="#/favoritos">Favoritos</a></li>
          <li><a href="#/conta/pedidos">Meus pedidos</a></li>
          <li><a href="#/contato">Onde estamos</a></li>
          <li><a href="#/privacidade">Privacidade</a></li>
          <li><a href="#/termos">Termos de uso</a></li>
          ${podeInstalar() && html`<li><button type="button" class="rodape__instalar" data-instalar>${icone("baixar", { tamanho: 16 })} Instalar o app da loja</button></li>`}
        </ul>
      </div>
    </div>
    <div class="container rodape__copy"><span>© ${new Date().getFullYear()} ${loja.nome}. Todos os direitos reservados.</span><span><a href="#/privacidade">Privacidade</a> · <a href="#/termos">Termos de uso</a></span></div>`);
  if (!ligado) {
    ligado = true;
    document.getElementById("rodape").addEventListener("click", (ev) => { if (ev.target.closest("[data-instalar]")) instalar("a loja"); });
    aoMudarInstalacao(desenharRodape); // o navegador liberou (ou o app foi instalado): mostra ou tira o botão
  }
}
