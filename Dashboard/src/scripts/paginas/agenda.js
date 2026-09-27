/* PÁGINA — agenda: calendário do mês, carga de cada dia, datas bloqueadas e limite de pedidos por dia */
import { html, montar, delegar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { abrirModal, ocupado, toast } from "/src/scripts/base/ui.js";
import { ativarCampos, campo, dadosDe, mostrarErros } from "/src/scripts/base/formularios.js";
import { dataPorExtenso, plural } from "/src/scripts/base/formatacao.js";
import { dataISO } from "/src/scripts/base/agendamento.js";
import { api } from "../nucleo/api.js";
import { cabecalhoPagina, carregandoPagina, erroPagina } from "../componentes/pagina.js";

const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const inicial = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const mesDe = (iso) => iso.slice(0, 7);
const somarMes = (mes, n) => {
  const [a, m] = mes.split("-").map(Number);
  const d = new Date(a, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const nomeDoMes = (mes) => {
  const [a, m] = mes.split("-").map(Number);
  return inicial(new Date(a, m - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" }));
};

export async function agenda(ctx) {
  montar(ctx.raiz, carregandoPagina);
  const hoje = dataISO(new Date());
  let mes = /^\d{4}-\d{2}$/.test(ctx.consulta.mes ?? "") ? ctx.consulta.mes : mesDe(hoje);
  let dados, selecionado = null, detalhe = null;

  async function carregar() {
    try { dados = await api.get(`/agenda?mes=${mes}`); }
    catch (erro) { montar(ctx.raiz, erroPagina(erro.message)); return false; }
    return ctx.ativo();
  }
  async function carregarDetalhe() {
    detalhe = null;
    if (!selecionado) return;
    try { detalhe = await api.get(`/producao?data=${selecionado}`); } catch { detalhe = { pedidos: [], itens: [] }; }
  }

  function celula(d) {
    const numero = Number(d.data.slice(8));
    const cheio = dados.max_pedidos_dia > 0 && d.pedidos >= dados.max_pedidos_dia;
    const classes = ["cal__dia", d.data === hoje && "cal__dia--hoje", d.data === selecionado && "cal__dia--ativo",
      d.bloqueada && "cal__dia--bloqueado", cheio && "cal__dia--cheio", d.data < hoje && "cal__dia--passado"].filter(Boolean).join(" ");
    return html`<button type="button" class="${classes}" data-acao="dia" data-data="${d.data}" aria-label="${dataPorExtenso(d.data)}${d.bloqueada ? ", bloqueado" : ""}, ${plural(d.pedidos, "pedido")}" aria-pressed="${String(d.data === selecionado)}">
      <span class="cal__num">${numero}</span>
      ${d.bloqueada ? html`<span class="cal__tag cal__tag--fechado">${icone("cadeado", { tamanho: 12 })} ${d.motivo || "Fechado"}</span>`
        : d.pedidos > 0 ? html`<span class="cal__tag ${cheio ? "cal__tag--cheio" : ""}">${dados.max_pedidos_dia > 0 ? `${d.pedidos}/${dados.max_pedidos_dia}` : d.pedidos}<span class="cal__tag-txt">&nbsp;${d.pedidos === 1 ? "pedido" : "pedidos"}</span></span>` : ""}
    </button>`;
  }

  function painelDia() {
    if (!selecionado) {
      return html`<aside class="cartao cal__lateral"><div class="vazio vazio--compacto"><span class="vazio__ico">${icone("calendario", { tamanho: 30 })}</span>
        <h3>Escolha um dia</h3><p>Toque em uma data para ver os pedidos, bloquear ou liberar a agenda.</p></div></aside>`;
    }
    const d = dados.dias.find((x) => x.data === selecionado);
    const lista = detalhe?.pedidos ?? [];
    return html`<aside class="cartao cal__lateral" aria-live="polite">
      <h2 class="cal__titulo-dia">${inicial(dataPorExtenso(selecionado))}</h2>
      ${d?.bloqueada ? html`<p class="aviso aviso--aviso">${icone("cadeado", { tamanho: 16 })}<span><strong>Dia bloqueado</strong>${d.motivo ? ` — ${d.motivo}` : ""}. Os clientes não conseguem agendar para esta data.</span></p>` : ""}
      <div class="cal__acoes">
        <a class="btn btn--contorno btn--pequeno" href="#/producao/${selecionado}">${icone("lista", { tamanho: 15 })} Ver produção</a>
        <button type="button" class="btn btn--suave btn--pequeno" data-acao="bloquear">${icone("cadeado", { tamanho: 15 })} ${d?.bloqueada ? "Liberar dia" : "Bloquear dia"}</button>
      </div>
      ${lista.length ? html`<ul class="cal__pedidos">${lista.map((p) => html`<li>
          <a href="#/pedidos?abrir=${p.id}" class="cal__pedido"><strong>${p.hora}</strong>
            <span><b>${p.cliente}</b><small>${p.itens.map((i) => `${i.qtd}× ${i.nome}`).join(", ")}</small></span>
            <span class="badge badge--neutro">${p.tipo === "entrega" ? "Entrega" : "Retirada"}</span></a></li>`)}</ul>`
        : html`<p class="texto-suave">Nenhum pedido para este dia.</p>`}
    </aside>`;
  }

  function desenhar() {
    const primeiro = new Date(Number(mes.slice(0, 4)), Number(mes.slice(5)) - 1, 1).getDay();
    const total = dados.dias.reduce((s, d) => s + d.pedidos, 0);
    montar(ctx.raiz, html`
      ${cabecalhoPagina({
        titulo: "Agenda", descricao: "Veja a carga de cada dia, bloqueie datas (feriados, férias) e limite quantos pedidos aceita por dia.",
        acoes: html`<button type="button" class="btn btn--contorno" data-acao="limite">${icone("ajustes", { tamanho: 17 })} Limite por dia${dados.max_pedidos_dia ? `: ${dados.max_pedidos_dia}` : ""}</button>`,
      })}
      <div class="cal__grade">
        <section class="cartao cartao--sem-margem cal">
          <header class="cal__topo">
            <button type="button" class="btn-icone" data-acao="mes-anterior" aria-label="Mês anterior">${icone("voltar", { tamanho: 18 })}</button>
            <div class="cal__mes"><strong>${nomeDoMes(mes)}</strong><small class="texto-suave">${plural(total, "pedido")} no mês</small></div>
            <button type="button" class="btn-icone" data-acao="mes-seguinte" aria-label="Próximo mês">${icone("direita", { tamanho: 18 })}</button>
            ${mes !== mesDe(hoje) ? html`<button type="button" class="btn btn--suave btn--pequeno" data-acao="hoje">Hoje</button>` : ""}
          </header>
          <div class="cal__semana" aria-hidden="true">${SEMANA.map((s) => html`<span>${s}</span>`)}</div>
          <div class="cal__dias">${Array.from({ length: primeiro }, () => html`<span class="cal__vazio"></span>`)}${dados.dias.map(celula)}</div>
          <footer class="cal__legenda"><span><i class="cal__lg cal__lg--hoje"></i> Hoje</span><span><i class="cal__lg cal__lg--cheio"></i> Agenda cheia</span><span><i class="cal__lg cal__lg--fechado"></i> Bloqueado</span></footer>
        </section>
        ${painelDia()}
      </div>`);
  }

  async function irParaMes(novo) {
    mes = novo; selecionado = null; detalhe = null;
    if (await carregar()) desenhar();
  }

  function formLimite() {
    const m = abrirModal({
      titulo: "Limite de pedidos por dia", largura: 460,
      corpo: html`<form id="form-limite" novalidate>
        <div class="form-erro" data-erro-geral hidden></div>
        ${campo({ nome: "max_pedidos_dia", rotulo: "Máximo de pedidos por dia", tipo: "number", valor: dados.max_pedidos_dia, atributos: 'min="0" max="500" autofocus',
          ajuda: "Quando o dia atinge esse número, ele aparece como “Lotado” na loja. Use 0 para não limitar. Pedidos cancelados não contam." })}
      </form>`,
      rodape: html`<button type="button" class="btn btn--suave" data-fechar>Cancelar</button>
        <button type="submit" form="form-limite" class="btn btn--primario" data-salvar>Salvar</button>`,
    });
    const form = m.el.querySelector("form");
    ativarCampos(form);
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      await ocupado(m.el.querySelector("[data-salvar]"), async () => {
        try {
          await api.put("/configuracoes/agenda", { max_pedidos_dia: Number(dadosDe(form).max_pedidos_dia) || 0 });
          toast("Limite salvo!");
          m.fechar();
          if (await carregar()) desenhar();
        } catch (erro) { mostrarErros(form, erro, (msg) => toast(msg, "erro")); }
      });
    });
  }

  function formBloqueio(dia) {
    const m = abrirModal({
      titulo: `Bloquear ${inicial(dataPorExtenso(dia))}`, largura: 460,
      corpo: html`<form id="form-bloqueio" novalidate>
        <div class="form-erro" data-erro-geral hidden></div>
        ${campo({ nome: "motivo", rotulo: "Motivo (opcional)", valor: "", atributos: 'maxlength="80" autofocus placeholder="Ex.: Feriado, viagem, evento" ',
          ajuda: "O motivo é só para você; o cliente vê apenas “Fechado”." })}
        <p class="texto-suave">Pedidos já feitos para este dia continuam valendo — só novas encomendas serão recusadas.</p>
      </form>`,
      rodape: html`<button type="button" class="btn btn--suave" data-fechar>Cancelar</button>
        <button type="submit" form="form-bloqueio" class="btn btn--primario" data-salvar>Bloquear</button>`,
    });
    const form = m.el.querySelector("form");
    ativarCampos(form);
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      await ocupado(m.el.querySelector("[data-salvar]"), async () => {
        try {
          await api.put("/agenda/data", { data: dia, bloquear: true, motivo: dadosDe(form).motivo ?? "" });
          toast("Dia bloqueado.");
          m.fechar();
          if (await carregar()) desenhar();
        } catch (erro) { mostrarErros(form, erro, (msg) => toast(msg, "erro")); }
      });
    });
  }

  delegar(ctx.raiz, {
    "mes-anterior": () => irParaMes(somarMes(mes, -1)),
    "mes-seguinte": () => irParaMes(somarMes(mes, 1)),
    hoje: () => irParaMes(mesDe(hoje)),
    limite: () => formLimite(),
    dia: async (el) => {
      selecionado = el.dataset.data;
      await carregarDetalhe();
      if (ctx.ativo()) desenhar();
    },
    bloquear: async () => {
      const d = dados.dias.find((x) => x.data === selecionado);
      if (!d?.bloqueada) { formBloqueio(selecionado); return; }
      try {
        await api.put("/agenda/data", { data: selecionado, bloquear: false });
        toast("Dia liberado.");
        if (await carregar()) desenhar();
      } catch (erro) { toast(erro.message, "erro"); }
    },
  });

  if (await carregar()) desenhar();
}
