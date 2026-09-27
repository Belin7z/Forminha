/* PÁGINA — contato: endereço, mapa com a área de entrega, horários e canais */
import { html, montar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { DIAS_SEMANA } from "/src/scripts/base/dominio.js";
import { brl, km, telefone } from "/src/scripts/base/formatacao.js";
import { abertaAgora } from "/src/scripts/base/agendamento.js";
import { criarMapa } from "/src/scripts/base/mapa.js";
import { estado } from "../nucleo/estado.js";
import { linkWhats } from "../componentes/rodape.js";

export function contato(ctx) {
  const { loja, horarios, zonas, entrega } = estado.config;
  const hoje = new Date().getDay();
  const aberta = abertaAgora(horarios);
  const whats = linkWhats();
  const temMapa = loja.lat != null && loja.lng != null;
  let mapa = null;

  montar(ctx.raiz, html`
    <section class="container pagina-contato">
      <header class="pagina-cab">
        <h1>Onde <span class="script">estamos</span></h1>
        <p class="texto-suave">Retire no ateliê ou receba em casa.</p>
      </header>

      <div class="contato__grade">
        <div class="contato__coluna">
          <section class="cartao-form">
            <h2>Fale com a gente</h2>
            <ul class="info-lista">
              ${loja.whatsapp && html`<li>${icone("telefone")} <div><small>WhatsApp</small><strong>${telefone(loja.whatsapp)}</strong></div></li>`}
              ${loja.instagram && html`<li>${icone("instagram")} <div><small>Instagram</small><a href="https://instagram.com/${loja.instagram}" target="_blank" rel="noopener"><strong>@${loja.instagram}</strong></a></div></li>`}
              ${loja.email && html`<li>${icone("email")} <div><small>E-mail</small><strong>${loja.email}</strong></div></li>`}
              ${loja.endereco && html`<li>${icone("pino")} <div><small>Endereço</small><strong>${loja.endereco}${loja.cidade && ` — ${loja.cidade}/${loja.uf}`}</strong></div></li>`}
            </ul>
            ${whats && html`<a href="${whats}" target="_blank" rel="noopener" class="btn btn--whats btn--bloco">${icone("mensagem", { tamanho: 18 })} Chamar no WhatsApp</a>`}
          </section>

          <section class="cartao-form">
            <div class="cartao-form__cab"><h2>Horários</h2><span class="badge ${aberta ? "badge--sucesso" : "badge--neutro"}">${aberta ? "Aberto agora" : "Fechado agora"}</span></div>
            <ul class="horarios">${[1, 2, 3, 4, 5, 6, 0].map((d) => html`
              <li class="${d === hoje && "horarios__hoje"}"><span>${DIAS_SEMANA[d]}</span><span>${horarios[d].aberto ? `${horarios[d].abre} às ${horarios[d].fecha}` : "Fechado"}</span></li>`)}</ul>
            <p class="texto-suave">Você pode agendar pedidos para qualquer dia de funcionamento.</p>
          </section>
        </div>

        <div class="contato__coluna">
          <section class="cartao-form">
            <h2>Área de entrega</h2>
            ${temMapa ? html`<div class="mapa mapa--grande" data-mapa></div>` : ""}
            ${entrega.entrega_ativa
              ? (zonas.length
                ? html`<table class="tabela-zonas"><thead><tr><th>Faixa</th><th>Distância</th><th>Frete</th><th>Prazo</th></tr></thead>
                    <tbody>${zonas.map((z) => html`<tr><td>${z.nome}</td><td>até ${km(z.ate_km)}</td><td>${z.taxa ? brl(z.taxa) : "Grátis"}</td><td>~${z.prazo_min} min</td></tr>`)}</tbody></table>`
                : html`<p class="texto-suave">Entregamos na região. Frete: ${entrega.taxa_padrao ? brl(entrega.taxa_padrao) : "grátis"}.</p>`)
              : html`<p class="texto-suave">No momento atendemos apenas retirada no ateliê.</p>`}
            ${entrega.gratis_acima > 0 && html`<p class="aviso aviso--rosa">${icone("caminhao", { tamanho: 17 })}<span>Frete grátis em pedidos acima de <strong>${brl(entrega.gratis_acima)}</strong>.</span></p>`}
          </section>
        </div>
      </div>
    </section>`);

  if (temMapa) {
    criarMapa(ctx.raiz.querySelector("[data-mapa]"), { lat: loja.lat, lng: loja.lng, zoom: 13, pino: true })
      .then((m) => {
        if (!ctx.ativo()) return m.destruir();
        mapa = m;
        if (entrega.entrega_ativa && zonas.length) m.circulos({ lat: loja.lat, lng: loja.lng }, zonas.map((z) => z.ate_km));
      })
      .catch(() => ctx.raiz.querySelector("[data-mapa]")?.remove());
  }
  return () => mapa?.destruir();
}
