/* PÁGINA — clientes: busca, histórico de compras, bloqueio e e-mail de redefinição de senha */
import { html, montar, delegar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { abrirModal, confirmar, toast } from "/src/scripts/base/ui.js";
import { brl, dataBR, dataHora, enderecoEmLinha, iniciais, plural, tempoRelativo, telefone } from "/src/scripts/base/formatacao.js";
import { api } from "../nucleo/api.js";
import { cabecalhoPagina, carregandoPagina, erroPagina, vazio } from "../componentes/pagina.js";
import { abrirPedido } from "../componentes/detalhe-pedido.js";
import { exportarClientes } from "../componentes/planilha.js";

const linkWhats = (tel, texto = "") => `https://wa.me/55${tel}${texto ? `?text=${encodeURIComponent(texto)}` : ""}`;

async function abrirCliente(id, aoMudar) {
  const m = abrirModal({ titulo: "Cliente", largura: 820, corpo: carregandoPagina });
  let d;
  try { d = await api.get(`/clientes/${id}`); }
  catch (erro) { m.corpo.innerHTML = `<p class="aviso aviso--perigo">${erro.message}</p>`; return; }
  const c = d.cliente;
  m.el.querySelector(".modal__cab h2").textContent = c.nome;
  m.corpo.innerHTML = String(html`
    <div class="cliente-topo">
      <span class="avatar avatar--grande">${iniciais(c.nome)}</span>
      <div>
        <p class="linha-flex">${icone("telefone", { tamanho: 15 })} ${telefone(c.telefone)}
          <a class="btn btn--whats btn--pequeno" target="_blank" rel="noopener" href="${linkWhats(c.telefone)}">${icone("mensagem", { tamanho: 14 })} WhatsApp</a></p>
        <p class="linha-flex">${icone("email", { tamanho: 15 })} ${c.email}</p>
        <small class="texto-suave">Cliente desde ${dataBR(c.criado_em.slice(0, 10))}${c.ultimo_acesso ? ` · último acesso ${tempoRelativo(c.ultimo_acesso)}` : ""}</small>
      </div>
      <div class="cliente-topo__numeros"><div><strong>${c.pedidos}</strong><small>pedidos</small></div><div><strong>${brl(c.gasto)}</strong><small>gasto total</small></div></div>
    </div>

    <div class="ped-grade">
      <section class="ped-bloco"><h3>Pedidos</h3>
        ${d.pedidos.length ? html`<ul class="lista-simples">${d.pedidos.map((p) => html`
          <li><button type="button" class="linha-botao" data-pedido="${p.id}"><span><strong>${p.codigo}</strong> <small class="texto-suave">${dataHora(p.criado_em)}</small></span>
            <span class="status status--${p.status}">${p.status_texto}</span><strong>${brl(p.total)}</strong></button></li>`)}</ul>`
        : html`<p class="texto-suave">Ainda não fez pedidos.</p>`}</section>
      <div>
        <section class="ped-bloco"><h3>Endereços</h3>
          ${d.enderecos.length ? html`<ul class="lista-simples">${d.enderecos.map((e) => html`<li><p>${icone("pino", { tamanho: 14 })} <strong>${e.apelido}</strong> ${e.principal && html`<span class="badge badge--sucesso">Principal</span>`}<br><small class="texto-suave">${enderecoEmLinha(e)}</small></p></li>`)}</ul>`
          : html`<p class="texto-suave">Nenhum endereço salvo.</p>`}</section>
        <section class="ped-bloco"><h3>Favoritos</h3>
          ${d.favoritos.length ? html`<p>${d.favoritos.map((p) => html`<span class="badge">${p.nome}</span> `)}</p>` : html`<p class="texto-suave">Nenhum favorito.</p>`}</section>
      </div>
    </div>`);
  m.corpo.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-pedido]");
    if (b) abrirPedido(b.dataset.pedido, aoMudar);
  });
}

export async function clientes(ctx) {
  montar(ctx.raiz, carregandoPagina);
  let lista = [];
  let busca = "";
  let temporizador;

  async function carregar() {
    try { lista = (await api.get(`/clientes${busca ? `?busca=${encodeURIComponent(busca)}` : ""}`)).clientes; }
    catch (erro) { montar(ctx.raiz.querySelector("#resultado"), erroPagina(erro.message)); return; }
    if (ctx.ativo()) desenharLista();
  }

  function desenharLista() {
    montar(ctx.raiz.querySelector("#resultado"), lista.length ? html`
      <p class="texto-suave resultado-contagem">${plural(lista.length, "cliente")}</p>
      <div class="cartao cartao--sem-margem"><div class="tabela-rolagem"><table class="tabela">
        <thead><tr><th>Cliente</th><th>Contato</th><th class="texto-direita">Pedidos</th><th class="texto-direita">Total gasto</th><th>Último pedido</th><th>Situação</th><th></th></tr></thead>
        <tbody>${lista.map((c) => html`<tr class="${!c.ativo && "linha-inativa"}">
          <td><div class="produto-celula"><span class="avatar">${iniciais(c.nome)}</span><div><strong>${c.nome}</strong><small class="texto-suave">desde ${dataBR(c.criado_em.slice(0, 10))}</small></div></div></td>
          <td>${telefone(c.telefone)}<br><small class="texto-suave">${c.email}</small></td>
          <td class="texto-direita">${c.pedidos}</td><td class="texto-direita"><strong>${brl(c.gasto)}</strong></td>
          <td>${c.ultimo_pedido ? tempoRelativo(c.ultimo_pedido) : "—"}</td>
          <td><span class="badge ${c.ativo ? "badge--sucesso" : "badge--perigo"}">${c.ativo ? "Ativo" : "Bloqueado"}</span></td>
          <td class="texto-direita nowrap">
            <button type="button" class="btn btn--suave btn--pequeno" data-acao="ver" data-id="${c.id}">Ver</button>
            <button type="button" class="btn-icone btn-icone--pequeno" data-acao="senha" data-id="${c.id}" title="Enviar e-mail para redefinir a senha" aria-label="Enviar e-mail para redefinir a senha de ${c.nome}">${icone("cadeado", { tamanho: 17 })}</button>
            <button type="button" class="btn-icone btn-icone--pequeno ${c.ativo && "btn-icone--perigo"}" data-acao="bloquear" data-id="${c.id}" title="${c.ativo ? "Bloquear" : "Desbloquear"}" aria-label="${c.ativo ? "Bloquear" : "Desbloquear"} ${c.nome}">${icone(c.ativo ? "xCirculo" : "checkCirculo", { tamanho: 17 })}</button></td>
        </tr>`)}</tbody></table></div></div>`
      : vazio("usuarios", "Nenhum cliente encontrado", busca ? "Tente outro nome, e-mail ou telefone." : "Os clientes aparecem aqui quando criarem a conta na loja."));
  }

  montar(ctx.raiz, html`
    ${cabecalhoPagina({ titulo: "Clientes", descricao: "Quem já comprou (ou se cadastrou) na sua loja.",
      acoes: html`<button type="button" class="btn btn--contorno" data-acao="exportar">${icone("baixar", { tamanho: 16 })} Exportar planilha</button>` })}
    <div class="filtros-barra"><div class="busca"><input type="search" id="busca" placeholder="Buscar por nome, e-mail ou telefone…" aria-label="Buscar cliente" autocomplete="off">${icone("busca", { tamanho: 18 })}</div></div>
    <div id="resultado">${carregandoPagina}</div>`);

  const achar = (el) => lista.find((c) => c.id === el.dataset.id); // o id do cliente é um UUID (texto)
  delegar(ctx.raiz, {
    ver: (el) => abrirCliente(el.dataset.id, carregar),
    exportar: (el) => exportarClientes(el),
    bloquear: async (el) => {
      const c = achar(el);
      if (c.ativo && !(await confirmar({ titulo: "Bloquear cliente", mensagem: `${c.nome} será desconectado(a) e não poderá entrar nem fazer pedidos até você desbloquear.`, rotulo: "Bloquear", perigo: true }))) return;
      try { await api.patch(`/clientes/${c.id}`, { ativo: !c.ativo }); toast(c.ativo ? "Cliente bloqueado." : "Cliente desbloqueado.", "info"); carregar(); }
      catch (erro) { toast(erro.message, "erro"); }
    },
    senha: async (el) => {
      const c = achar(el);
      if (!(await confirmar({ titulo: "Redefinir senha", mensagem: `Enviamos um e-mail para ${c.email} com um link para ${c.nome.split(" ")[0]} criar uma nova senha. A senha atual continua valendo até lá.`, rotulo: "Enviar e-mail" }))) return;
      try {
        await api.post(`/clientes/${c.id}/senha`, { email: c.email });
        toast(`E-mail enviado para ${c.email}.`);
      } catch (erro) { toast(erro.message, "erro"); }
    },
  });
  ctx.raiz.querySelector("#busca").addEventListener("input", (ev) => {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => { busca = ev.target.value.trim(); carregar(); }, 300);
  });

  await carregar();
  return () => clearTimeout(temporizador);
}
