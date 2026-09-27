/* ==========================================================
   COMPONENTE — configurações › Integrações.
   PIX automático (Mercado Pago) e avisos por WhatsApp (Meta).
   As chaves dos serviços NUNCA passam por aqui: ficam nos
   "Secrets" das funções do Supabase (veja docs/INTEGRACOES.md).
   ========================================================== */
import { html } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { abrirModal, confirmar, copiar, ocupado, toast } from "/src/scripts/base/ui.js";
import { ativarCampos, dadosDe, interruptor, mostrarErros } from "/src/scripts/base/formularios.js";
import { api } from "../nucleo/api.js";

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

const urlWebhook = () => `${String(window.CONFIG_APP?.supabaseUrl ?? "").replace(/\/+$/, "")}/functions/v1/pix-webhook`;

export function paginaIntegracoes({ gateway, avisos }) {
  const situacao = gateway.ativo ? ["badge--sucesso", "Ligado"] : gateway.tem_chave ? ["badge--neutro", "Desligado"] : ["badge--aviso", "Falta gerar a chave"];
  return html`
    <section class="cartao" id="integ-pix">
      <div class="cartao__cab"><div><h2>PIX automático <small class="texto-suave">— Mercado Pago</small></h2>
        <small class="texto-suave">O cliente paga lendo um QR Code e o pedido muda para “pago” sozinho, sem você conferir o extrato.</small></div>
        <span class="badge ${situacao[0]}">${situacao[1]}</span></div>
      <ol class="integ-passos">
        <li>Crie a conta no <strong>Mercado Pago</strong> e uma aplicação de pagamentos; copie o <strong>Access Token</strong>.</li>
        <li>No <strong>Supabase → Edge Functions → Secrets</strong>, cadastre <code>MP_ACCESS_TOKEN</code> (o token) e <code>SEGREDO_GATEWAY</code> (a chave gerada abaixo).</li>
        <li>No <strong>Mercado Pago → Webhooks</strong>, informe o endereço abaixo e marque o evento <em>Pagamentos</em>.</li>
        <li>Volte aqui, ligue o PIX automático e faça um pedido de teste de valor baixo.</li>
      </ol>
      <div class="integ-linha"><div class="campo"><label>Endereço do webhook (cole no Mercado Pago)</label>
        <input class="entrada" readonly value="${urlWebhook()}" aria-label="Endereço do webhook"></div>
        <button type="button" class="btn btn--suave btn--pequeno" data-copiar-webhook>${icone("copiar", { tamanho: 15 })} Copiar</button></div>
      <div class="integ-acoes">
        <button type="button" class="btn btn--contorno" data-gerar-chave>${icone("cadeado", { tamanho: 16 })} ${gateway.tem_chave ? "Gerar nova chave de integração" : "Gerar chave de integração"}</button>
        <form id="f-gateway" novalidate>${interruptor({ nome: "ativo", rotulo: "Ligar o PIX automático", marcado: gateway.ativo, ajuda: gateway.tem_chave ? "Antes de ligar, cadastre as chaves nos Secrets do Supabase." : "Gere a chave de integração primeiro." })}</form>
      </div>
      <p class="texto-suave">Mantenha também a chave PIX da loja em <em>Pagamento</em>: ela serve de alternativa se o Mercado Pago estiver fora do ar. Guia completo: <code>docs/INTEGRACOES.md</code>.</p>
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

  ctx.raiz.querySelector("[data-copiar-webhook]")?.addEventListener("click", () => copiar(urlWebhook()));

  ctx.raiz.querySelector("[data-gerar-chave]")?.addEventListener("click", async (ev) => {
    if (dados.gateway.tem_chave && !(await confirmar({
      titulo: "Gerar nova chave", rotulo: "Gerar nova chave", perigo: true,
      mensagem: "A chave atual deixa de valer e o PIX automático é desligado até você atualizar o Secret SEGREDO_GATEWAY no Supabase e ligar de novo. Continuar?",
    }))) return;
    await ocupado(ev.currentTarget, async () => {
      try {
        const { segredo } = await api.post("/gateway/segredo");
        const m = abrirModal({
          titulo: "Sua chave de integração", largura: 520, aoFechar: recarregar,
          corpo: html`<p class="texto-suave">Copie agora e cole no Supabase, em <strong>Edge Functions → Secrets</strong>, com o nome <code>SEGREDO_GATEWAY</code>.
            <strong>Ela não será mostrada de novo</strong> (o sistema guarda só uma impressão digital, não a chave).</p>
            <code class="pix__codigo" id="chave-gerada">${segredo}</code>`,
          rodape: html`<button type="button" class="btn btn--primario" data-copiar-chave>${icone("copiar", { tamanho: 16 })} Copiar chave</button>
            <button type="button" class="btn btn--suave" data-fechar>Já copiei</button>`,
        });
        m.el.querySelector("[data-copiar-chave]").addEventListener("click", () => copiar(segredo));
      } catch (erro) { toast(erro.message, "erro"); }
    });
  });

  const interruptorGateway = ctx.raiz.querySelector('#f-gateway [name="ativo"]');
  interruptorGateway?.addEventListener("change", async (ev) => {
    try {
      await api.put("/gateway", { ativo: ev.target.checked });
      toast(ev.target.checked ? "PIX automático ligado." : "PIX automático desligado.", "info");
      recarregar();
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
