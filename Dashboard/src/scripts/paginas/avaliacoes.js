/* PÁGINA — avaliações: aprovar para aparecer na loja, ocultar e responder */
import { html, montar, delegar } from "/src/scripts/base/html.js";
import { abrirModal, ocupado, toast } from "/src/scripts/base/ui.js";
import { dataHora, plural } from "/src/scripts/base/formatacao.js";
import { api } from "../nucleo/api.js";
import { cabecalhoPagina, carregandoPagina, erroPagina, vazio } from "../componentes/pagina.js";

const estrelas = (n) => "★".repeat(n) + "☆".repeat(5 - n);

export async function avaliacoes(ctx) {
  montar(ctx.raiz, carregandoPagina);
  let dados;
  try { dados = await api.get("/avaliacoes"); }
  catch (erro) { montar(ctx.raiz, erroPagina(erro.message)); return; }
  if (!ctx.ativo()) return;
  let filtro = "todas";

  function desenhar() {
    const lista = dados.avaliacoes.filter((a) => filtro === "todas" || (filtro === "pendentes" ? !a.aprovada : a.aprovada));
    const pendentes = dados.avaliacoes.filter((a) => !a.aprovada).length;
    montar(ctx.raiz, html`
      ${cabecalhoPagina({
        titulo: "Avaliações", descricao: "Só aparecem na loja as que você aprovar.",
        acoes: dados.total > 0 && html`<span class="nota-geral"><strong>${String(dados.media).replace(".", ",")}</strong><span class="estrelas-texto">${estrelas(Math.round(dados.media))}</span><small>${plural(dados.total, "avaliação", "avaliações")}</small></span>`,
      })}
      <div class="segmentos segmentos--solto" role="group" aria-label="Filtro">
        ${[["todas", "Todas"], ["pendentes", `Pendentes (${pendentes})`], ["aprovadas", "Aprovadas"]].map(([id, texto]) => html`
          <button type="button" class="segmento ${filtro === id && "segmento--ativo"}" data-acao="filtro" data-id="${id}" aria-pressed="${String(filtro === id)}">${texto}</button>`)}
      </div>
      ${lista.length ? html`<div class="avaliacoes-lista">${lista.map((a) => html`
        <article class="avaliacao-card ${!a.aprovada && "avaliacao-card--pendente"}">
          <header><span class="estrelas-texto" aria-label="${a.nota} de 5">${estrelas(a.nota)}</span>
            <span class="badge ${a.aprovada ? "badge--sucesso" : "badge--aviso"}">${a.aprovada ? "Visível na loja" : "Aguardando aprovação"}</span></header>
          ${a.comentario ? html`<blockquote>${a.comentario}</blockquote>` : html`<p class="texto-suave"><em>Sem comentário — só a nota.</em></p>`}
          <small class="texto-suave">${a.cliente} · pedido ${a.pedido} · ${dataHora(a.criado_em)}</small>
          ${a.resposta && html`<p class="depoimento__resposta"><strong>Sua resposta:</strong> ${a.resposta}</p>`}
          <div class="linha-flex">
            <button type="button" class="btn ${a.aprovada ? "btn--suave" : "btn--primario"} btn--pequeno" data-acao="aprovar" data-id="${a.id}">${a.aprovada ? "Ocultar da loja" : "Aprovar e exibir"}</button>
            <button type="button" class="btn btn--suave btn--pequeno" data-acao="responder" data-id="${a.id}">${a.resposta ? "Editar resposta" : "Responder"}</button>
          </div>
        </article>`)}</div>`
      : vazio("email", "Nenhuma avaliação aqui", "Depois que os pedidos são entregues, os clientes podem avaliar.")}`);
  }

  const achar = (el) => dados.avaliacoes.find((a) => a.id === Number(el.dataset.id));
  const aplicar = (nova) => { dados.avaliacoes = dados.avaliacoes.map((a) => (a.id === nova.id ? nova : a)); desenhar(); };

  delegar(ctx.raiz, {
    filtro: (el) => { filtro = el.dataset.id; desenhar(); },
    aprovar: async (el) => {
      const a = achar(el);
      try { aplicar((await api.patch(`/avaliacoes/${a.id}`, { aprovada: !a.aprovada })).avaliacao); toast(a.aprovada ? "Avaliação ocultada." : "Avaliação aprovada!", "info"); }
      catch (erro) { toast(erro.message, "erro"); }
    },
    responder: (el) => {
      const a = achar(el);
      const m = abrirModal({
        titulo: "Responder avaliação", largura: 480,
        corpo: html`<blockquote class="citacao">${a.comentario || "(sem comentário)"}</blockquote>
          <div class="campo"><label for="resposta">Sua resposta (aparece junto da avaliação)</label>
          <textarea id="resposta" class="entrada" rows="4" maxlength="300" autofocus>${a.resposta ?? ""}</textarea></div>`,
        rodape: html`<button type="button" class="btn btn--suave" data-fechar>Cancelar</button><button type="button" class="btn btn--primario" data-enviar>Salvar resposta</button>`,
      });
      m.rodape.querySelector("[data-enviar]").addEventListener("click", (ev) => ocupado(ev.currentTarget, async () => {
        try { aplicar((await api.patch(`/avaliacoes/${a.id}`, { resposta: m.corpo.querySelector("#resposta").value })).avaliacao); toast("Resposta salva."); m.fechar(); }
        catch (erro) { toast(erro.message, "erro"); }
      }));
    },
  });
  desenhar();
}
