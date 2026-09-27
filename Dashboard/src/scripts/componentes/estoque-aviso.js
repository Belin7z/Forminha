/* ==========================================================
   ESTOQUE — aviso automático por WhatsApp para a dona: quando
   algo vai faltar, fica abaixo do mínimo ou está para vencer.
   Manda no máximo um resumo por dia (e um novo se surgir outro
   problema), dentro do horário escolhido. Funciona com o
   Dashboard aberto em algum aparelho.
   ========================================================== */
import { html, montar } from "/src/scripts/base/html.js";
import { ocupado, toast } from "/src/scripts/base/ui.js";
import { ativarCampos, campo, dadosDe, interruptor, mostrarErros } from "/src/scripts/base/formularios.js";
import { dataHora, telefone } from "/src/scripts/base/formatacao.js";
import { api } from "../nucleo/api.js";

const horas = (de, ate) => Array.from({ length: ate - de + 1 }, (_, i) => de + i).map((h) => ({ valor: h, texto: `${String(h % 24).padStart(2, "0")}h` }));

export async function montarAviso(alvo) {
  let c;
  try { c = await api.get("/estoque/aviso"); } catch { alvo.hidden = true; return; }

  function desenhar() {
    montar(alvo, html`
      <div class="cartao__cab"><div><h2>Aviso de estoque no seu WhatsApp</h2><small class="texto-suave">Receba o resumo do que vai faltar sem precisar abrir o Dashboard.</small></div></div>
      <form id="form-aviso" novalidate>
        <div class="form-erro" data-erro-geral hidden></div>
        ${interruptor({ nome: "aviso_ativo", rotulo: "Avisar por WhatsApp", marcado: c.aviso_ativo,
          ajuda: "Um resumo por dia, e outro só se aparecer um problema novo. Precisa da conta do WhatsApp oficial (Meta) configurada: veja Configurações → Integrações." })}
        <div class="grade-campos grade-campos--3">
          ${campo({ nome: "aviso_telefone", rotulo: "Seu WhatsApp", valor: c.aviso_telefone ? telefone(c.aviso_telefone) : "", mascara: "telefone", atributos: 'autocomplete="tel"', placeholder: "(11) 91234-5678" })}
          ${campo({ nome: "aviso_das", rotulo: "Avisar a partir das", tipo: "select", valor: c.aviso_das, opcoes: horas(0, 23) })}
          ${campo({ nome: "aviso_ate", rotulo: "Até as", tipo: "select", valor: c.aviso_ate, opcoes: horas(1, 24) })}
        </div>
        <details class="integ-modelos">
          <summary>Modelo de mensagem (Meta)</summary>
          ${campo({ nome: "aviso_modelo", rotulo: "Nome do modelo aprovado", valor: c.aviso_modelo, atributos: 'maxlength="100"', ajuda: "Precisa ter 2 variáveis no texto: {{1}} seu nome e {{2}} o resumo. Sugestão: “Oi, {{1}}! Alerta de estoque: {{2}}.” O passo a passo está no guia INTEGRACOES.md." })}
        </details>
        <div class="cartao__rodape"><button type="submit" class="btn btn--primario">Salvar aviso</button></div>
      </form>
      ${c.avisos.length > 0 && html`<h3 class="est-editor__titulo">Últimos avisos</h3>
        <ul class="avisos-lista">${c.avisos.map((a) => html`<li><span class="badge ${a.estado === "enviado" ? "badge--sucesso" : "badge--perigo"}">${a.estado === "enviado" ? "Enviado" : "Falhou"}</span>
          <small class="texto-suave">${dataHora(a.quando)}</small> <span>${a.estado === "enviado" ? a.resumo : a.detalhe}</span></li>`)}</ul>`}`);
    ativarCampos(alvo);
  }

  alvo.addEventListener("submit", async (ev) => {
    if (ev.target.id !== "form-aviso") return;
    ev.preventDefault();
    const d = dadosDe(ev.target);
    await ocupado(ev.target.querySelector("[type=submit]"), async () => {
      try {
        c = await api.put("/estoque/aviso", { ...d, aviso_das: Number(d.aviso_das), aviso_ate: Number(d.aviso_ate) });
        toast(c.aviso_ativo ? "Aviso ligado!" : "Aviso desligado.");
        desenhar();
      } catch (erro) { mostrarErros(ev.target, erro, (msg) => toast(msg, "erro")); }
    });
  });
  desenhar();
}
