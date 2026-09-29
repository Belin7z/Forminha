/* ==========================================================
   BUSCA RÁPIDA (Ctrl+K ou "/") — acha clientes, lojas, telas e
   ações sem tirar a mão do teclado. ↑ ↓ para escolher, Enter para
   abrir, Esc para fechar. Só mostra o que a pessoa pode ver; as
   listas são lidas quando a busca abre (e guardadas por 1 minuto).
   ========================================================== */
import { html, montar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { abrirModal } from "/src/scripts/base/ui.js";
import { api, pode } from "./nucleo.js";

const GUARDA_MS = 60_000;
const POR_GRUPO = 6;
const cache = { clientes: null, lojas: null, em: 0 };

/** Texto sem acento e em minúsculas (busca "confeitaria" acha "Confeitária"). */
export const normalizar = (t) => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/**
 * Nota de quanto o item combina com a busca (0 = não combina). Todas as palavras precisam aparecer;
 * começar pela palavra vale mais que ter no meio. `campos`: [texto principal, outros...].
 */
export function combina(busca, campos) {
  const termos = normalizar(busca).split(/\s+/).filter(Boolean);
  if (!termos.length) return 1;
  const textos = campos.map(normalizar);
  const junto = textos.join(" ");
  if (!termos.every((t) => junto.includes(t))) return 0;
  let nota = 1;
  for (const t of termos) {
    if (textos[0].startsWith(t)) nota += 3;
    else if (textos[0].split(/\s+/).some((p) => p.startsWith(t))) nota += 2;
    else if (junto.split(/\s+/).some((p) => p.startsWith(t))) nota += 1;
  }
  return nota;
}

async function carregarListas(eu) {
  if (Date.now() - cache.em < GUARDA_MS && (cache.clientes || cache.lojas)) return;
  const [c, l] = await Promise.all([
    pode(eu, "clientes.ver") ? api("GET", "clientes").then((r) => r.clientes).catch(() => null) : null,
    pode(eu, "lojas.ver") ? api("GET", "lojas").then((r) => r.lojas).catch(() => null) : null,
  ]);
  Object.assign(cache, { clientes: c, lojas: l, em: Date.now() });
}

const SITUACAO = (c) => (c.situacao === "cancelado" ? "Cancelado" : c.situacao === "aguardando_pagamento" ? "Aguardando pagamento" : c.etapa === "pronta" ? "Loja pronta" : "Criando a loja");

/**
 * Abre a busca. `telas`: [{ id, nome, icone }] que a pessoa pode ver; `acoes`: [{ nome, icone, fazer }];
 * `abrirCliente(id)`, `abrirLoja(ref)`: o que fazer ao escolher.
 */
export function abrirBusca(eu, { telas, acoes, abrirCliente, abrirLoja }) {
  const modal = abrirModal({
    titulo: "Buscar", largura: 620, classe: "modal__caixa--busca",
    corpo: html`
      <div class="busca">
        <label class="busca__campo">${icone("busca", { tamanho: 18 })}
          <input type="search" class="busca__entrada" placeholder="Cliente, loja, código, e-mail ou tela…" autocomplete="off" spellcheck="false" autofocus
            role="combobox" aria-expanded="true" aria-controls="busca-resultados" aria-autocomplete="list" aria-label="Buscar"></label>
        <div id="busca-resultados" class="busca__resultados" role="listbox" aria-label="Resultados"></div>
        <p class="busca__dica"><kbd>↑</kbd><kbd>↓</kbd> escolher · <kbd>Enter</kbd> abrir · <kbd>Esc</kbd> fechar</p>
      </div>`,
  });
  const entrada = modal.el.querySelector(".busca__entrada");
  const lista = modal.el.querySelector(".busca__resultados");
  let itens = [];
  let ativo = 0;
  let carregando = true;

  function resultados(q) {
    const grupos = [];
    const add = (titulo, candidatos) => {
      const achados = candidatos.map((x) => ({ ...x, nota: combina(q, x.campos) })).filter((x) => x.nota > 0)
        .sort((a, b) => b.nota - a.nota).slice(0, q ? POR_GRUPO : 4);
      if (achados.length) grupos.push({ titulo, itens: achados });
    };
    if (q) {
      add("Clientes", (cache.clientes ?? []).map((c) => ({
        tipo: "cliente", id: c.id, titulo: c.nome_loja, detalhe: `${c.nome} · ${SITUACAO(c)}`, icone: "usuarios",
        campos: [c.nome_loja, c.nome, c.email, String(c.telefone ?? "")],
      })));
      add("Lojas", (cache.lojas ?? []).map((l) => ({
        tipo: "loja", id: l.ref, titulo: l.nome, detalhe: `${l.codigo}${l.dominio ? ` · ${l.dominio}` : ""}`, icone: "home",
        campos: [l.nome, l.codigo, l.dominio ?? "", l.loja ?? ""],
      })));
    }
    add("Ir para", telas.map((t) => ({ tipo: "tela", id: t.id, titulo: t.nome, detalhe: "", icone: t.icone, campos: [t.nome] })));
    add("Ações", acoes.map((a, i) => ({ tipo: "acao", id: String(i), titulo: a.nome, detalhe: "", icone: a.icone, campos: [a.nome, a.palavras ?? ""] })));
    return grupos;
  }

  function desenhar() {
    const q = entrada.value;
    const grupos = resultados(q);
    itens = grupos.flatMap((g) => g.itens);
    ativo = Math.min(ativo, Math.max(0, itens.length - 1));
    let n = -1;
    montar(lista, grupos.length ? html`${grupos.map((g) => html`
      <p class="busca__grupo" role="presentation">${g.titulo}</p>
      ${g.itens.map((x) => { n += 1; const i = n; return html`
        <button type="button" id="busca-item-${i}" class="busca__item ${i === ativo && "busca__item--ativo"}" role="option" aria-selected="${String(i === ativo)}" data-indice="${i}" tabindex="-1">
          <span class="busca__ico">${icone(x.icone, { tamanho: 16 })}</span>
          <span class="busca__texto"><strong>${x.titulo}</strong>${x.detalhe && html`<small>${x.detalhe}</small>`}</span>
          ${i === ativo && html`<span class="busca__enter" aria-hidden="true">${icone("direita", { tamanho: 15 })}</span>`}
        </button>`; })}`)}`
      : html`<p class="busca__vazio">${carregando && q ? "Procurando…" : q ? `Nada encontrado para “${q}”.` : ""}</p>`);
    entrada.setAttribute("aria-activedescendant", itens.length ? `busca-item-${ativo}` : "");
    lista.querySelector(".busca__item--ativo")?.scrollIntoView({ block: "nearest" });
  }

  function escolher(i) {
    const x = itens[i];
    if (!x) return;
    modal.fechar();
    if (x.tipo === "cliente") abrirCliente(x.id);
    else if (x.tipo === "loja") abrirLoja(x.id);
    else if (x.tipo === "tela") location.hash = `#/${x.id}`;
    else acoes[Number(x.id)]?.fazer();
  }

  entrada.addEventListener("input", () => { ativo = 0; desenhar(); });
  entrada.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowDown") { ev.preventDefault(); ativo = itens.length ? (ativo + 1) % itens.length : 0; desenhar(); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); ativo = itens.length ? (ativo - 1 + itens.length) % itens.length : 0; desenhar(); }
    else if (ev.key === "Enter") { ev.preventDefault(); escolher(ativo); }
  });
  lista.addEventListener("click", (ev) => { const b = ev.target.closest("[data-indice]"); if (b) escolher(Number(b.dataset.indice)); });
  lista.addEventListener("mousemove", (ev) => {
    const b = ev.target.closest("[data-indice]");
    if (b && Number(b.dataset.indice) !== ativo) { ativo = Number(b.dataset.indice); desenhar(); }
  });

  desenhar();
  carregarListas(eu).finally(() => { carregando = false; if (!modal.fechado) desenhar(); });
}

/** Esquece as listas guardadas (ex.: acabou de cadastrar uma cliente). */
export const esquecerBusca = () => { cache.em = 0; };
