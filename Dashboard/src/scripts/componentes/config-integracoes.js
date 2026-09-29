/* ==========================================================
   COMPONENTE — configurações › Integrações.
   Pagamento online (PIX automático + cartão, Mercado Pago) e avisos
   por WhatsApp (Meta). A dona cola o Access Token do Mercado Pago e a
   Central instala e liga tudo: a chave vai direto para os segredos das
   funções da loja e nunca fica no navegador nem no banco.
   ========================================================== */
import { html } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { ocupado, toast } from "/src/scripts/base/ui.js";
import { ativarCampos, campo, dadosDe, interruptor, mostrarErros } from "/src/scripts/base/formularios.js";
import { dataBR } from "/src/scripts/base/formatacao.js";
import { api } from "../nucleo/api.js";
import { chamarCentral, temCentral } from "../nucleo/central.js";

const EVENTOS = [
  ["confirmado", "Pedido confirmado"], ["em_preparo", "Em preparo"], ["pronto", "Pronto (ou pronto para retirada)"],
  ["saiu_entrega", "Saiu para entrega"], ["entregue", "Entregue ou retirado"], ["cancelado", "Cancelado"],
];

/** Textos prontos para copiar no Meta. Cada modelo usa EXATAMENTE 4 variáveis, nesta ordem: {{1}} nome, {{2}} código, {{3}} quando, {{4}} link. */
export const MODELOS_SUGERIDOS = {
  confirmado: "Olá, {{1}}! Seu pedido {{2}} foi confirmado para {{3}}. Acompanhe por aqui: {{4}} Qualquer dúvida, é só responder esta mensagem.",
  em_preparo: "Olá, {{1}}! Seu pedido {{2}} está em preparo, com todo o carinho, para {{3}}. Acompanhe por aqui: {{4}} Qualquer dúvida, é só responder esta mensagem.",
  pronto: "Olá, {{1}}! Seu pedido {{2}} está pronto ({{3}}). Veja os detalhes: {{4}} Qualquer dúvida, é só responder esta mensagem.",
  saiu_entrega: "Olá, {{1}}! Seu pedido {{2}} saiu para entrega e chega em breve ({{3}}). Acompanhe por aqui: {{4}} Qualquer dúvida, é só responder esta mensagem.",
  entregue: "Olá, {{1}}! Seu pedido {{2}}, previsto para {{3}}, foi entregue. Obrigada pela preferência! Conte como foi: {{4}} Volte sempre!",
  cancelado: "Olá, {{1}}. Infelizmente o pedido {{2}}, previsto para {{3}}, foi cancelado. Veja os detalhes: {{4}} Se precisar, é só responder esta mensagem.",
};

const LINK_CREDENCIAIS = "https://www.mercadopago.com.br/developers/panel/app";

/** Colar o Access Token e conectar (a Central instala as funções e liga PIX e cartão). */
const formConectar = () => html`
  <form id="f-conectar" class="integ-conectar" novalidate>
    <div class="form-erro" data-erro-geral hidden></div>
    ${campo({ nome: "token", rotulo: "Access Token do Mercado Pago", tipo: "password", obrigatorio: true, placeholder: "APP_USR-…", atributos: 'autocomplete="off" spellcheck="false"' })}
    <p class="texto-suave integ-dica">No Mercado Pago: <a class="link" href="${LINK_CREDENCIAIS}" target="_blank" rel="noopener">Suas integrações</a> → sua aplicação → <strong>Credenciais de produção</strong> → Access Token.</p>
    <button type="submit" class="btn btn--primario">Conectar</button>
  </form>`;

export function paginaIntegracoes({ gateway, avisos }) {
  const conectado = gateway.tem_chave;
  return html`
    <section class="cartao" id="integ-pagamento">
      <div class="cartao__cab"><div><h2>Pagamento online <small class="texto-suave">— Mercado Pago</small></h2>
        <small class="texto-suave">PIX automático e cartão de crédito ou débito. O pedido fica “pago” sozinho.</small></div>
        <span class="badge ${conectado ? "badge--sucesso" : "badge--aviso"}">${conectado ? "Conectado" : "Não conectado"}</span></div>
      ${conectado ? html`
        <dl class="integ-conta">
          <div><dt>Conta</dt><dd>${gateway.conta || "Mercado Pago"}</dd></div>
          ${gateway.conectado_em && html`<div><dt>Desde</dt><dd>${dataBR(String(gateway.conectado_em).slice(0, 10))}</dd></div>`}
        </dl>
        <form id="f-gateway" class="integ-opcoes" novalidate>
          ${interruptor({ nome: "ativo", rotulo: "PIX automático", marcado: gateway.ativo })}
          ${interruptor({ nome: "cartao", rotulo: "Cartão de crédito e débito", marcado: gateway.cartao })}
        </form>
        ${temCentral() && html`<details class="integ-trocar"><summary>Trocar a conta do Mercado Pago</summary>${formConectar()}</details>`}`
      : temCentral() ? formConectar()
      : html`<p class="texto-suave">Peça à Forminha para ligar o pagamento online da sua loja.</p>`}
      <p class="texto-suave integ-dica">A chave PIX da loja (em <em>Pagamento</em>) continua como alternativa se o Mercado Pago estiver fora do ar.</p>
    </section>

    <form class="cartao" id="f-avisos" novalidate>
      <div class="cartao__cab"><div><h2>Avisos por WhatsApp <small class="texto-suave">— Meta (oficial)</small></h2>
        <small class="texto-suave">O cliente recebe uma mensagem quando o pedido muda de situação. Cada aviso usa um <strong>modelo aprovado pela Meta</strong>.</small></div></div>
      <div class="form-erro" data-erro-geral hidden></div>
      ${interruptor({ nome: "whatsapp_ativo", rotulo: "Enviar avisos automáticos pelo WhatsApp", marcado: avisos.whatsapp_ativo, ajuda: "Precisa dos Secrets WHATSAPP_TOKEN, WHATSAPP_PHONE_ID e URL_LOJA no Supabase e dos modelos aprovados no Meta." })}
      <div class="integ-avisos">
        ${EVENTOS.map(([id, nome]) => html`<div class="integ-avisos__linha">
          <label class="opcao-mini"><input type="checkbox" name="ev_${id}" ${avisos.eventos[id] && "checked"}> <strong>${nome}</strong></label>
          <input class="entrada" name="modelo_${id}" value="${avisos.modelos[id]}" maxlength="100" aria-label="Nome do modelo — ${nome}" placeholder="nome_do_modelo">
        </div>`)}
      </div>
      <small class="texto-suave">A segunda coluna é o <strong>nome do modelo</strong> exatamente como você cadastrou no Meta (letras minúsculas, números e “_”).</small>
      <details class="integ-modelos"><summary>Textos sugeridos para cadastrar os modelos no Meta</summary>
        <p class="texto-suave">Categoria <strong>Utilitário</strong>, idioma <strong>Português (Brasil)</strong>. Use as 4 variáveis nesta ordem: <code>{{1}}</code> primeiro nome, <code>{{2}}</code> código do pedido, <code>{{3}}</code> dia e hora, <code>{{4}}</code> link para acompanhar.</p>
        <ul>${EVENTOS.map(([id, nome]) => html`<li><strong>${nome}</strong> — <code>${avisos.modelos[id]}</code><br><span class="integ-modelos__texto">${MODELOS_SUGERIDOS[id]}</span></li>`)}</ul>
      </details>
      <div class="cartao__rodape"><button type="submit" class="btn btn--primario">Salvar avisos</button></div>
    </form>`;
}

export function ligarIntegracoes(ctx, dados) {
  const recarregar = () => ctx.ir("/configuracoes/integracoes");

  // conectar (ou trocar) a conta do Mercado Pago: quem instala e guarda a chave é a Central
  const formConectar = ctx.raiz.querySelector("#f-conectar");
  if (formConectar) {
    ativarCampos(formConectar);
    formConectar.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      await ocupado(formConectar.querySelector("[type=submit]"), async () => {
        try {
          const r = await chamarCentral("POST", "pagamento", { token: dadosDe(formConectar).token });
          toast(`Pagamento online ligado${r.conta ? ` (${r.conta})` : ""}! PIX automático e cartão já aparecem na loja.`);
          recarregar();
        } catch (erro) { mostrarErros(formConectar, erro, (msg) => toast(msg, "erro")); }
      });
    });
  }

  const formGateway = ctx.raiz.querySelector("#f-gateway");
  formGateway?.addEventListener("change", async (ev) => {
    const d = dadosDe(formGateway);
    try {
      await api.put("/gateway", { ativo: d.ativo, cartao: d.cartao });
      toast(ev.target.name === "cartao" ? (d.cartao ? "Cartão ligado." : "Cartão desligado.") : (d.ativo ? "PIX automático ligado." : "PIX automático desligado."), "info");
    } catch (erro) { ev.target.checked = !ev.target.checked; toast(erro.message, "erro"); }
  });

  const form = ctx.raiz.querySelector("#f-avisos");
  ativarCampos(form);
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const d = dadosDe(form);
    const corpo = { whatsapp_ativo: d.whatsapp_ativo, eventos: {}, modelos: {} };
    for (const [id] of EVENTOS) { corpo.eventos[id] = d[`ev_${id}`]; corpo.modelos[id] = String(d[`modelo_${id}`] ?? "").trim(); }
    await ocupado(form.querySelector("[type=submit]"), async () => {
      try { await api.put("/avisos", corpo); toast("Avisos salvos!"); }
      catch (erro) { mostrarErros(form, erro, (msg) => toast(msg, "erro")); }
    });
  });
}
