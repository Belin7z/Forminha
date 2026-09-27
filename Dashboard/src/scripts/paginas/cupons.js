/* PÁGINA — cupons de desconto */
import { html, montar, delegar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { abrirModal, confirmar, ocupado, toast } from "/src/scripts/base/ui.js";
import { ativarCampos, campo, dadosDe, interruptor, mostrarErros } from "/src/scripts/base/formularios.js";
import { brl, dataBR, emReais, paraCentavos } from "/src/scripts/base/formatacao.js";
import { dataISO } from "/src/scripts/base/agendamento.js";
import { api } from "../nucleo/api.js";
import { cabecalhoPagina, carregandoPagina, erroPagina, vazio } from "../componentes/pagina.js";

const descontoTexto = (c) => (c.tipo === "frete" ? "Frete grátis" : c.tipo === "percentual" ? `${c.valor}%` : brl(c.valor));

export async function cupons(ctx) {
  montar(ctx.raiz, carregandoPagina);
  let lista;
  try { lista = (await api.get("/cupons")).cupons; }
  catch (erro) { montar(ctx.raiz, erroPagina(erro.message)); return; }
  if (!ctx.ativo()) return;
  const hoje = dataISO(new Date());

  function situacao(c) {
    if (!c.ativo) return ["badge--neutro", "Desligado"];
    if (c.validade && c.validade < hoje) return ["badge--perigo", "Expirado"];
    if (c.limite_uso != null && c.usos >= c.limite_uso) return ["badge--aviso", "Esgotado"];
    return ["badge--sucesso", "Ativo"];
  }

  function desenhar() {
    montar(ctx.raiz, html`
      ${cabecalhoPagina({
        titulo: "Cupons", descricao: "Crie códigos de desconto para campanhas e primeiras compras.",
        acoes: html`<button type="button" class="btn btn--primario" data-acao="novo">${icone("mais", { tamanho: 17 })} Novo cupom</button>`,
      })}
      ${lista.length ? html`<div class="cartao cartao--sem-margem"><div class="tabela-rolagem"><table class="tabela">
        <thead><tr><th>Código</th><th>Desconto</th><th>Regras</th><th>Validade</th><th class="texto-direita">Usos</th><th>Situação</th><th></th></tr></thead>
        <tbody>${lista.map((c) => { const [classe, texto] = situacao(c); return html`<tr>
          <td><strong class="codigo-cupom">${c.codigo}</strong><br><small class="texto-suave">${c.descricao}</small></td>
          <td><strong>${descontoTexto(c)}</strong></td>
          <td><small>${c.minimo > 0 ? `Pedido mín. ${brl(c.minimo)}` : "Sem mínimo"}${c.primeira_compra ? " · 1ª compra" : ""}</small></td>
          <td>${c.validade ? dataBR(c.validade) : "Sem prazo"}</td>
          <td class="texto-direita">${c.usos}${c.limite_uso != null ? ` / ${c.limite_uso}` : ""}</td>
          <td><span class="badge ${classe}">${texto}</span></td>
          <td class="texto-direita nowrap">
            <button type="button" class="btn-icone btn-icone--pequeno" data-acao="editar" data-id="${c.id}" aria-label="Editar ${c.codigo}">${icone("editar", { tamanho: 17 })}</button>
            <button type="button" class="btn-icone btn-icone--pequeno btn-icone--perigo" data-acao="excluir" data-id="${c.id}" aria-label="Excluir ${c.codigo}">${icone("lixeira", { tamanho: 17 })}</button></td></tr>`; })}</tbody></table></div></div>`
      : vazio("etiqueta", "Nenhum cupom criado", "Crie um cupom e divulgue o código nas suas redes.")}`);
  }

  function formulario(cupom = null) {
    const c = cupom ?? {};
    const m = abrirModal({
      titulo: cupom ? "Editar cupom" : "Novo cupom", largura: 560,
      corpo: html`<form id="form-cupom" novalidate>
        <div class="form-erro" data-erro-geral hidden></div>
        <div class="grade-campos grade-campos--2">
          ${campo({ nome: "codigo", rotulo: "Código", valor: c.codigo ?? "", obrigatorio: true, atributos: 'maxlength="20" style="text-transform:uppercase" autofocus', ajuda: "Letras e números, sem espaços." })}
          ${campo({ nome: "descricao", rotulo: "Descrição (interna)", valor: c.descricao ?? "", atributos: 'maxlength="100"' })}
        </div>
        <div class="grade-campos grade-campos--2">
          ${campo({ nome: "tipo", rotulo: "Tipo de desconto", tipo: "select", valor: c.tipo ?? "percentual", opcoes: [{ valor: "percentual", texto: "Percentual (%)" }, { valor: "valor", texto: "Valor fixo (R$)" }, { valor: "frete", texto: "Frete grátis" }] })}
          ${campo({ nome: "valor", rotulo: "Valor", valor: c.tipo === "valor" ? emReais(c.valor) : (c.valor ?? 10), obrigatorio: true, ajuda: "Em %, ou em reais no caso de valor fixo." })}
        </div>
        <div class="grade-campos grade-campos--3">
          ${campo({ nome: "minimo", rotulo: "Pedido mínimo (R$)", valor: emReais(c.minimo ?? 0), mascara: "moeda" })}
          ${campo({ nome: "validade", rotulo: "Válido até", tipo: "date", valor: c.validade ?? "" })}
          ${campo({ nome: "limite_uso", rotulo: "Limite de usos", tipo: "number", valor: c.limite_uso ?? "", atributos: 'min="1"', ajuda: "Vazio = ilimitado." })}
        </div>
        ${interruptor({ nome: "primeira_compra", rotulo: "Só para a primeira compra", marcado: c.primeira_compra ?? false })}
        ${interruptor({ nome: "ativo", rotulo: "Cupom ativo", marcado: c.ativo ?? true })}
      </form>`,
      rodape: html`<button type="button" class="btn btn--suave" data-fechar>Cancelar</button>
        <button type="submit" form="form-cupom" class="btn btn--primario" data-salvar>Salvar cupom</button>`,
    });
    const form = m.el.querySelector("form");
    ativarCampos(form);
    const tipoCampo = form.querySelector('[name="tipo"]');
    const valorCampo = form.querySelector('[name="valor"]').closest(".campo");
    const aoMudarTipo = () => { valorCampo.hidden = tipoCampo.value === "frete"; }; // frete grátis não tem valor
    tipoCampo.addEventListener("change", aoMudarTipo);
    aoMudarTipo();
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const d = dadosDe(form);
      const corpo = { ...d, codigo: d.codigo.toUpperCase(), valor: d.tipo === "valor" ? paraCentavos(d.valor) : Number(String(d.valor).replace(",", ".")) || 0, minimo: paraCentavos(d.minimo) };
      await ocupado(m.el.querySelector("[data-salvar]"), async () => {
        try {
          lista = (cupom ? await api.put(`/cupons/${cupom.id}`, corpo) : await api.post("/cupons", corpo)).cupons;
          toast("Cupom salvo!");
          m.fechar();
          desenhar();
        } catch (erro) { mostrarErros(form, erro, (msg) => toast(msg, "erro")); }
      });
    });
  }

  const achar = (el) => lista.find((c) => c.id === Number(el.dataset.id));
  delegar(ctx.raiz, {
    novo: () => formulario(),
    editar: (el) => formulario(achar(el)),
    excluir: async (el) => {
      const c = achar(el);
      if (!(await confirmar({ titulo: "Excluir cupom", mensagem: `Excluir o cupom ${c.codigo}? Para só pausar, edite e desligue “Cupom ativo”.`, rotulo: "Excluir", perigo: true }))) return;
      try { lista = (await api.delete(`/cupons/${c.id}`)).cupons; toast("Cupom excluído."); desenhar(); }
      catch (erro) { toast(erro.message, "erro"); }
    },
  });
  desenhar();
}
