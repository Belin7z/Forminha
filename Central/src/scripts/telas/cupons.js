/* ==========================================================
   TELA — Cupons e indicação (só o dono).
   Indicação: o desconto de quem chega indicada e o crédito de quem
   indicou (cada cliente que pagou tem o próprio código, na ficha).
   Cupons: desconto em % ou R$, com validade e limite de usos;
   desligue quando quiser; apague só o que nunca foi usado.
   ========================================================== */
import { html, montar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { abrirModal, confirmar, ocupado, toast } from "/src/scripts/base/ui.js";
import { ativarCampos, campo, dadosDe, mostrarErros } from "/src/scripts/base/formularios.js";
import { emReais, paraCentavos } from "/src/scripts/base/formatacao.js";
import { api, aviso, reais } from "../nucleo.js";
import { dataBR } from "../periodo.js";

export async function telaCupons(conteiner) {
  document.title = "Cupons — Forminha";
  let dados = null;
  montar(conteiner, html`
    <div class="central__titulo">
      <div><h1>Cupons e indicação</h1><p class="texto-suave">Descontos para fechar vendas e para quem chega indicada.</p></div>
      <button type="button" class="btn btn--primario" data-acao="novo">${icone("mais", { tamanho: 17 })} Novo cupom</button>
    </div>
    <div data-conteudo-cupons><div class="carregando-pagina"><div class="spinner"></div></div></div>`);
  const alvo = conteiner.querySelector("[data-conteudo-cupons]");

  function desenhar() {
    const ind = dados.indicacao;
    montar(alvo, html`
      <div class="cupons__grade">
        <section class="cartao cupons__lista">
          <div class="cartao__cab"><h2>Cupons</h2></div>
          ${dados.cupons.length ? html`
            <div class="tabela tabela--cupons" role="table" aria-label="Cupons">
              <div class="tabela__linha tabela__cab" role="row"><span>Código</span><span>Desconto</span><span>Validade</span><span>Usos</span><span></span></div>
              ${dados.cupons.map((c) => html`
                <div class="tabela__linha ${!c.ativo && "tabela__linha--apagada"}" role="row" data-id="${c.id}">
                  <span class="tabela__mono"><strong>${c.codigo}</strong></span>
                  <span>${c.tipo === "percentual" ? `${c.valor}%` : reais(c.valor)}</span>
                  <span class="tabela__suave">${c.validade ? `até ${dataBR(c.validade)}` : "sem prazo"}</span>
                  <span class="tabela__numero">${c.usos}${c.max_usos ? ` de ${c.max_usos}` : ""}</span>
                  <span class="tabela__acoes">
                    <label class="interruptor interruptor--pequeno" title="${c.ativo ? "Ligado" : "Desligado"}"><input type="checkbox" data-acao="ativo" ${c.ativo && "checked"} aria-label="Cupom ${c.codigo} ligado"><span class="interruptor__trilho"></span></label>
                    ${c.usos === 0 && html`<button type="button" class="btn-icone btn-icone--pequeno" data-acao="apagar" aria-label="Apagar ${c.codigo}" title="Apagar">${icone("lixeira", { tamanho: 16 })}</button>`}
                  </span>
                </div>`)}
            </div>` : html`<p class="texto-suave">Nenhum cupom ainda. Crie um para uma campanha (ex.: <strong>SETEMBRO10</strong>) e passe para quem vende.</p>`}
        </section>

        <form class="cartao" id="f-indicacao" novalidate>
          <div class="cartao__cab"><div><h2>Indicação</h2><small class="texto-suave">${ind.codigos} ${ind.codigos === 1 ? "código criado" : "códigos criados"} · ${ind.usos} ${ind.usos === 1 ? "indicada" : "indicadas"}</small></div></div>
          <div class="form-erro" data-erro-geral hidden></div>
          <p class="texto-suave cupons__explica">Cada cliente que já pagou tem um código (na ficha dela). Quem usar ganha o desconto; quando pagar, quem indicou ganha o crédito para abater nas mensalidades.</p>
          <div class="grade-2">
            ${campo({ nome: "desconto_pct", rotulo: "Desconto de quem chega (%)", tipo: "number", valor: ind.desconto_pct, atributos: 'min="0" max="90"', ajuda: "0 desliga os códigos." })}
            ${campo({ nome: "recompensa", rotulo: "Crédito de quem indicou (R$)", mascara: "moeda", valor: emReais(ind.recompensa_centavos) })}
          </div>
          <div class="cartao__rodape"><button type="submit" class="btn btn--primario">Salvar</button></div>
        </form>
      </div>`);
    const form = alvo.querySelector("#f-indicacao");
    ativarCampos(form);
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const d = dadosDe(form);
      await ocupado(form.querySelector("[type=submit]"), async () => {
        try {
          const r = await api("PUT", "indicacao", { desconto_pct: Number(d.desconto_pct) || 0, recompensa_centavos: paraCentavos(d.recompensa) });
          dados.indicacao = { ...dados.indicacao, ...r };
          toast("Indicação salva.");
        } catch (erro) { mostrarErros(form, erro); }
      });
    });
  }

  async function carregar() {
    try { dados = await api("GET", "cupons"); desenhar(); }
    catch (erro) { montar(alvo, aviso("perigo", erro.message)); }
  }

  conteiner.addEventListener("click", async (ev) => {
    const alvoAcao = ev.target.closest("[data-acao]");
    if (!alvoAcao) return;
    if (alvoAcao.dataset.acao === "novo") return novoCupom(carregar);
    const id = alvoAcao.closest("[data-id]")?.dataset.id;
    const cupom = dados?.cupons.find((c) => c.id === id);
    if (alvoAcao.dataset.acao === "apagar" && cupom) {
      if (!(await confirmar({ titulo: "Apagar cupom?", mensagem: `O cupom ${cupom.codigo} deixa de existir.`, rotulo: "Apagar", perigo: true }))) return;
      try { await api("DELETE", `cupons/${id}`, {}); toast("Cupom apagado."); carregar(); } catch (erro) { toast(erro.message, "erro"); }
    }
  });
  conteiner.addEventListener("change", async (ev) => {
    const caixa = ev.target.closest('[data-acao="ativo"]');
    if (!caixa) return;
    const id = caixa.closest("[data-id]").dataset.id;
    try {
      await api("PUT", `cupons/${id}`, { ativo: caixa.checked });
      toast(caixa.checked ? "Cupom ligado." : "Cupom desligado.", "info");
      carregar();
    } catch (erro) { caixa.checked = !caixa.checked; toast(erro.message, "erro"); }
  });
  await carregar();
}

function novoCupom(depois) {
  const modal = abrirModal({
    titulo: "Novo cupom", largura: 520,
    corpo: html`
      <form id="form-cupom" novalidate>
        <div class="form-erro" data-erro-geral hidden></div>
        ${campo({ nome: "codigo", rotulo: "Código", obrigatorio: true, placeholder: "SETEMBRO10", atributos: 'maxlength="20" autocomplete="off" autocapitalize="characters" spellcheck="false" autofocus' })}
        <div class="grade-2">
          ${campo({ nome: "tipo", rotulo: "Tipo de desconto", tipo: "select", valor: "percentual", opcoes: [{ valor: "percentual", texto: "Porcentagem (%)" }, { valor: "valor", texto: "Valor fixo (R$)" }] })}
          ${campo({ nome: "valor", rotulo: "Desconto", obrigatorio: true, placeholder: "10", atributos: 'inputmode="decimal"' })}
          ${campo({ nome: "validade", rotulo: "Vale até", tipo: "date", ajuda: "Em branco: sem prazo." })}
          ${campo({ nome: "max_usos", rotulo: "Limite de usos", tipo: "number", atributos: 'min="1"', ajuda: "Em branco: sem limite." })}
        </div>
      </form>`,
    rodape: html`<button type="button" class="btn btn--suave" data-fechar>Cancelar</button><button type="submit" form="form-cupom" class="btn btn--primario">Criar cupom</button>`,
  });
  const form = modal.el.querySelector("form");
  ativarCampos(form);
  const rotuloValor = form.querySelector(`label[for="${form.valor.id}"]`);
  const ajustar = () => { rotuloValor.firstChild.textContent = form.tipo.value === "valor" ? "Desconto (R$)" : "Desconto (%)"; };
  form.tipo.addEventListener("change", ajustar);
  ajustar();
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const d = dadosDe(form);
    const valor = d.tipo === "valor" ? paraCentavos(d.valor) : Number(String(d.valor).replace(",", "."));
    await ocupado(modal.el.querySelector('[form="form-cupom"]'), async () => {
      try {
        const c = await api("POST", "cupons", { codigo: d.codigo, tipo: d.tipo, valor, validade: d.validade || null, max_usos: d.max_usos || null });
        modal.fechar();
        toast(`Cupom ${c.codigo} criado: ${c.descricao}.`);
        depois();
      } catch (erro) { mostrarErros(form, erro); }
    });
  });
}
