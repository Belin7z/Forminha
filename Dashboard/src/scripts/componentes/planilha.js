/* ==========================================================
   COMPONENTE — planilhas (CSV) de pedidos e clientes.
   O arquivo abre direto no Excel ou no Google Planilhas
   (separador ";" e acentos corretos).
   ========================================================== */
import { html } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { abrirModal, ocupado, toast } from "/src/scripts/base/ui.js";
import { campo, dadosDe } from "/src/scripts/base/formularios.js";
import { dataBR, emReais } from "/src/scripts/base/formatacao.js";
import { dataISO } from "/src/scripts/base/agendamento.js";
import { api } from "../nucleo/api.js";

/** Texto que começa com = + - @ viraria fórmula no Excel: um apóstrofo o mantém como texto. */
const seguro = (valor) => {
  const t = String(valor ?? "");
  return /^[=+\-@\t\r]/.test(t) ? `'${t}` : t;
};
const celula = (valor) => {
  const t = seguro(valor);
  return /[";\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

/** colunas: [{ titulo, valor: (linha) => … }] */
export function baixarCsv(nome, colunas, linhas) {
  const cabecalho = colunas.map((c) => celula(c.titulo)).join(";");
  const corpo = linhas.map((l) => colunas.map((c) => celula(c.valor(l))).join(";"));
  const blob = new Blob(["﻿" + [cabecalho, ...corpo].join("\r\n")], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = nome;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 2000);
}

const reais = (centavos) => emReais(centavos);
const COLUNAS_PEDIDOS = [
  { titulo: "Pedido", valor: (l) => l.codigo }, { titulo: "Data", valor: (l) => dataBR(l.data) }, { titulo: "Hora", valor: (l) => l.hora },
  { titulo: "Cliente", valor: (l) => l.cliente }, { titulo: "Telefone", valor: (l) => l.telefone },
  { titulo: "Recebimento", valor: (l) => (l.tipo === "entrega" ? "Entrega" : "Retirada") }, { titulo: "Situação", valor: (l) => l.status },
  { titulo: "Origem", valor: (l) => (l.origem === "manual" ? "Lançado pela loja" : "Loja online") }, { titulo: "Itens", valor: (l) => l.itens },
  { titulo: "Subtotal (R$)", valor: (l) => reais(l.subtotal) }, { titulo: "Entrega (R$)", valor: (l) => reais(l.taxa_entrega) },
  { titulo: "Desconto (R$)", valor: (l) => reais(l.desconto) }, { titulo: "Total (R$)", valor: (l) => reais(l.total) },
  { titulo: "Sinal (R$)", valor: (l) => reais(l.sinal) }, { titulo: "Recebido (R$)", valor: (l) => reais(l.pago) },
  { titulo: "A receber (R$)", valor: (l) => reais(Math.max(l.total - l.pago, 0)) },
  { titulo: "Pagamento", valor: (l) => l.pagamento }, { titulo: "Cupom", valor: (l) => l.cupom }, { titulo: "Feito em", valor: (l) => l.criado_em },
];
const COLUNAS_CLIENTES = [
  { titulo: "Nome", valor: (l) => l.nome }, { titulo: "E-mail", valor: (l) => l.email }, { titulo: "Telefone", valor: (l) => l.telefone },
  { titulo: "Cadastro", valor: (l) => l.cadastro }, { titulo: "Pedidos", valor: (l) => l.pedidos }, { titulo: "Total gasto (R$)", valor: (l) => reais(l.gasto) },
  { titulo: "Conta ativa", valor: (l) => (l.ativo ? "Sim" : "Não") },
];

function somarDias(iso, n) {
  const [a, m, d] = iso.split("-").map(Number);
  return dataISO(new Date(a, m - 1, d + n));
}

/** Janela para escolher o período (pela data agendada) e baixar os pedidos. */
export function abrirExportacaoPedidos() {
  const hoje = dataISO(new Date());
  const m = abrirModal({
    titulo: "Exportar pedidos", largura: 460,
    corpo: html`<form id="form-exportar" novalidate>
      <p class="texto-suave">Escolha o período pela <strong>data agendada</strong> dos pedidos. A planilha abre no Excel e no Google Planilhas.</p>
      <div class="grade-campos grade-campos--2">
        ${campo({ nome: "de", rotulo: "De", tipo: "date", valor: somarDias(hoje, -30) })}
        ${campo({ nome: "ate", rotulo: "Até", tipo: "date", valor: somarDias(hoje, 60) })}
      </div>
    </form>`,
    rodape: html`<button type="button" class="btn btn--suave" data-fechar>Cancelar</button>
      <button type="submit" form="form-exportar" class="btn btn--primario" data-baixar>${icone("baixar", { tamanho: 16 })} Baixar planilha</button>`,
  });
  const form = m.el.querySelector("form");
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const { de, ate } = dadosDe(form);
    if (!de || !ate || de > ate) { toast("Confira o período: a data inicial deve vir antes da final.", "erro"); return; }
    await ocupado(m.el.querySelector("[data-baixar]"), async () => {
      try {
        const r = await api.get(`/exportar/pedidos?de=${de}&ate=${ate}`);
        if (!r.linhas.length) { toast("Nenhum pedido nesse período.", "info"); return; }
        baixarCsv(`pedidos-${de}-a-${ate}.csv`, COLUNAS_PEDIDOS, r.linhas);
        toast(`${r.linhas.length} pedido(s) exportado(s).`);
        m.fechar();
      } catch (erro) { toast(erro.message, "erro"); }
    });
  });
}

export async function exportarClientes(botao) {
  await ocupado(botao, async () => {
    try {
      const r = await api.get("/exportar/clientes");
      if (!r.linhas.length) { toast("Ainda não há clientes.", "info"); return; }
      baixarCsv(`clientes-${dataISO(new Date())}.csv`, COLUNAS_CLIENTES, r.linhas);
      toast(`${r.linhas.length} cliente(s) exportado(s).`);
    } catch (erro) { toast(erro.message, "erro"); }
  });
}
