/* ==========================================================
   O SINO — avisos na hora: pagamento caiu, loja pronta, criação
   parou, cliente nova. Pergunta à Central a cada 20 s (1 min com a
   aba escondida). Aviso novo: o número no sino, um toast e, se a
   pessoa deixar, a notificação do computador. Abrir o sino marca
   tudo como visto. Um estado só para todas as telas (o topo é
   redesenhado a cada troca de tela).
   ========================================================== */
import { html, montar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { toast } from "/src/scripts/base/ui.js";
import { api, quandoCurto } from "./nucleo.js";

const ICONES = { pagamento: "dinheiro", loja_pronta: "checkCirculo", parada: "alerta", cadastro: "usuario", indicacao: "usuarios", erro: "alerta", backup: "baixar" };
const estado = { avisos: [], naoVistos: 0, ultimo: 0, conhecido: null, relogio: null, conteiner: null, aberto: false, aoAbrirCliente: null };

const podeNotificar = () => typeof Notification !== "undefined" && Notification.permission === "granted";
const podePedirNotificacao = () => typeof Notification !== "undefined" && Notification.permission === "default";

function desenhar() {
  const c = estado.conteiner;
  if (!c?.isConnected) return;
  const n = estado.naoVistos;
  montar(c, html`
    <button type="button" class="btn-icone sino__botao" data-sino="abrir" aria-haspopup="true" aria-expanded="${String(estado.aberto)}"
      aria-label="${n ? `Avisos: ${n} ${n === 1 ? "novo" : "novos"}` : "Avisos"}" title="Avisos">
      ${icone("sino", { tamanho: 19 })}${n > 0 && html`<span class="sino__n">${n > 9 ? "9+" : n}</span>`}
    </button>
    <div class="sino__painel" role="dialog" aria-label="Avisos" ${!estado.aberto && "hidden"}>
      <div class="sino__cab"><strong>Avisos</strong>
        ${podePedirNotificacao() && html`<button type="button" class="link sino__permitir" data-sino="permitir">Avisar também no computador</button>`}</div>
      ${estado.avisos.length ? html`<ul class="sino__lista">${estado.avisos.map((a) => html`
        <li><button type="button" class="sino__item ${a.novo && "sino__item--novo"}" data-sino="item" data-cliente="${a.cliente_id ?? ""}" data-tipo="${a.tipo}">
          <span class="sino__ico sino__ico--${a.tipo}">${icone(ICONES[a.tipo] ?? "sino", { tamanho: 16 })}</span>
          <span class="sino__texto"><strong>${a.titulo}</strong>${a.texto && html`<small>${a.texto}</small>`}<time>${quandoCurto(a.em)}</time></span>
        </button></li>`)}</ul>`
      : html`<p class="sino__vazio">Nada novo por aqui. Pagamentos, lojas prontas e problemas aparecem na hora.</p>`}
    </div>`);
}

function notificarNovos(novos) {
  if (!novos.length) return;
  if (novos.length === 1) toast(novos[0].titulo, novos[0].tipo === "parada" ? "erro" : "sucesso", 6000);
  else toast(`${novos.length} avisos novos`, "info", 6000);
  if (podeNotificar() && document.visibilityState !== "visible") {
    for (const a of novos.slice(0, 3)) { try { new Notification(a.titulo, { body: a.texto, tag: `forminha-${a.id}`, icon: "/src/imagens/favicon.svg" }); } catch { /* sem suporte */ } }
  }
}

async function buscar() {
  if (!estado.conteiner?.isConnected) return; // saiu da área logada
  let r;
  try { r = await api("GET", "avisos"); } catch { return; }
  const primeira = estado.conhecido === null;
  const novos = primeira ? [] : r.avisos.filter((a) => a.id > estado.conhecido);
  estado.avisos = r.avisos;
  estado.naoVistos = r.nao_vistos;
  estado.ultimo = r.ultimo;
  estado.conhecido = Math.max(estado.conhecido ?? 0, r.ultimo);
  desenhar();
  notificarNovos(novos);
}

function agendar() {
  clearTimeout(estado.relogio);
  estado.relogio = setTimeout(async () => {
    if (!estado.conteiner?.isConnected) { estado.relogio = null; estado.conhecido = null; return; } // saiu: para de perguntar
    await buscar();
    agendar();
  }, document.visibilityState === "visible" ? 20_000 : 60_000);
}

async function abrir() {
  estado.aberto = !estado.aberto;
  if (estado.aberto) estado.naoVistos = 0; // abriu = viu (os novos continuam destacados até fechar)
  desenhar();
  if (!estado.aberto) return;
  estado.conteiner.querySelector(".sino__item")?.focus();
  await api("POST", "avisos/vistos", { ate: estado.ultimo }).catch(() => {});
}

function fechar() {
  if (!estado.aberto) return;
  estado.aberto = false;
  estado.avisos = estado.avisos.map((a) => ({ ...a, novo: false }));
  desenhar();
}

/** Liga o sino no topo (chamado a cada tela). `aoAbrirCliente(id)`: abre a ficha da cliente do aviso. */
export function ligarSino(conteiner, { aoAbrirCliente }) {
  estado.conteiner = conteiner;
  estado.aoAbrirCliente = aoAbrirCliente;
  estado.aberto = false;
  desenhar();
  if (estado.conhecido === null || !estado.relogio) buscar().then(agendar);
}

document.addEventListener("click", async (ev) => {
  const c = estado.conteiner;
  if (!c?.isConnected) return;
  const alvo = ev.target.closest("[data-sino]");
  if (!alvo || !c.contains(alvo)) { if (!ev.target.closest(".sino__painel")) fechar(); return; }
  const acao = alvo.dataset.sino;
  if (acao === "abrir") return abrir();
  if (acao === "permitir") {
    const r = await Notification.requestPermission().catch(() => "denied");
    toast(r === "granted" ? "Pronto: os avisos também aparecem no computador." : "Tudo bem: os avisos continuam aparecendo aqui.", "info");
    return desenhar();
  }
  if (acao === "item") {
    fechar();
    if (alvo.dataset.cliente) estado.aoAbrirCliente?.(alvo.dataset.cliente);
    else if (alvo.dataset.tipo === "backup") location.hash = "#/configuracoes";
  }
});
document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") fechar(); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && estado.conteiner?.isConnected) buscar().then(agendar); });
