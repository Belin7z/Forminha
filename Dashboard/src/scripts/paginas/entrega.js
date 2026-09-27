/* ==========================================================
   PÁGINA — entrega e mapa: localização da loja (pino arrastável),
   faixas de frete por distância (círculos no mapa) e regras de
   recebimento (entrega, retirada, frete grátis).
   ========================================================== */
import { html, montar, delegar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { abrirModal, confirmar, ocupado, toast } from "/src/scripts/base/ui.js";
import { ativarCampos, campo, dadosDe, interruptor, mostrarErros } from "/src/scripts/base/formularios.js";
import { brl, emReais, km, paraCentavos } from "/src/scripts/base/formatacao.js";
import { criarMapa, geocodificar, localizarUsuario } from "/src/scripts/base/mapa.js";
import { api } from "../nucleo/api.js";
import { cabecalhoPagina, carregandoPagina, erroPagina, vazio } from "../componentes/pagina.js";

export async function entrega(ctx) {
  montar(ctx.raiz, carregandoPagina);
  let cfg, zonas;
  try {
    [{ configuracoes: cfg }, { zonas }] = await Promise.all([api.get("/configuracoes"), api.get("/zonas")]);
  } catch (erro) { montar(ctx.raiz, erroPagina(erro.message)); return; }
  if (!ctx.ativo()) return;

  let mapa = null;
  let pino = cfg.loja.lat != null ? { lat: cfg.loja.lat, lng: cfg.loja.lng } : null;
  let alterado = false;

  montar(ctx.raiz, html`
    ${cabecalhoPagina({ titulo: "Entrega e mapa", descricao: "Defina onde fica a loja e quanto cobrar de frete conforme a distância." })}
    <div class="painel-grade painel-grade--2-1">
      <section class="cartao">
        <div class="cartao__cab"><div><h2>Localização da loja</h2><small class="texto-suave">A distância até o cliente é medida a partir deste ponto.</small></div>
          <div class="linha-flex">
            <button type="button" class="btn btn--suave btn--pequeno" data-acao="achar">${icone("busca", { tamanho: 15 })} Achar pelo endereço</button>
            <button type="button" class="btn btn--suave btn--pequeno" data-acao="gps">${icone("navegar", { tamanho: 15 })} Minha localização</button></div></div>
        <div class="mapa mapa--grande" id="mapa-loja"></div>
        <div class="linha-flex mapa-rodape">
          <small class="texto-suave" id="mapa-info"></small><span class="espaco"></span>
          <button type="button" class="btn btn--primario btn--pequeno" data-acao="salvar-local" id="salvar-local" disabled>Salvar localização</button></div>
      </section>

      <section class="cartao">
        <div class="cartao__cab"><h2>Regras de recebimento</h2></div>
        <form id="form-regras" novalidate>
          <div class="form-erro" data-erro-geral hidden></div>
          ${interruptor({ nome: "entrega_ativa", rotulo: "Fazer entregas", marcado: cfg.entrega.entrega_ativa })}
          ${interruptor({ nome: "retirada_ativa", rotulo: "Permitir retirada na loja", marcado: cfg.entrega.retirada_ativa })}
          ${campo({ nome: "gratis_acima", rotulo: "Frete grátis acima de (R$)", valor: emReais(cfg.entrega.gratis_acima), mascara: "moeda", ajuda: "Use 0,00 para não oferecer frete grátis." })}
          ${campo({ nome: "taxa_padrao", rotulo: "Taxa única (R$)", valor: emReais(cfg.entrega.taxa_padrao), mascara: "moeda", ajuda: "Só vale se você não cadastrar nenhuma faixa por distância." })}
          <button type="submit" class="btn btn--primario btn--bloco">Salvar regras</button>
        </form>
      </section>
    </div>

    <section class="cartao">
      <div class="cartao__cab"><div><h2>Faixas de frete por distância</h2><small class="texto-suave">O cliente paga a taxa da menor faixa que alcança o endereço dele. Fora da última faixa, só retirada.</small></div>
        <button type="button" class="btn btn--primario btn--pequeno" data-acao="nova-faixa">${icone("mais", { tamanho: 15 })} Nova faixa</button></div>
      <div id="faixas"></div>
    </section>`);

  const $ = (s) => ctx.raiz.querySelector(s);

  /* ---------- Mapa ---------- */
  function info() {
    $("#mapa-info").textContent = pino ? `Loja em ${pino.lat.toFixed(5)}, ${pino.lng.toFixed(5)}` : "Marque a loja no mapa (clique ou arraste o pino).";
    $("#salvar-local").disabled = !alterado || !pino;
  }
  function circulos() {
    if (mapa && pino) mapa.circulos(pino, zonas.filter((z) => z.ativa).map((z) => z.ate_km).sort((a, b) => a - b));
  }

  criarMapa($("#mapa-loja"), {
    lat: pino?.lat ?? -23.5505, lng: pino?.lng ?? -46.6333, zoom: pino ? 13 : 11, arrastavel: true, pino: true,
    aoMover: (lat, lng) => { pino = { lat, lng }; alterado = true; info(); mapa.circulos(pino, zonas.filter((z) => z.ativa).map((z) => z.ate_km).sort((a, b) => a - b)); },
  }).then((m) => { if (!ctx.ativo()) return m.destruir(); mapa = m; circulos(); info(); })
    .catch(() => { $("#mapa-loja").innerHTML = '<p class="vazio">Não foi possível carregar o mapa agora.</p>'; });
  info();

  async function definir(lat, lng) {
    pino = { lat, lng };
    alterado = true;
    mapa?.mover(lat, lng, 14);
    circulos();
    info();
  }

  /* ---------- Faixas ---------- */
  function desenharFaixas() {
    montar($("#faixas"), zonas.length ? html`<div class="tabela-rolagem"><table class="tabela">
      <thead><tr><th>Faixa</th><th>Até</th><th class="texto-direita">Frete</th><th class="texto-direita">Prazo</th><th>Ativa</th><th></th></tr></thead>
      <tbody>${zonas.map((z) => html`<tr class="${!z.ativa && "linha-inativa"}">
        <td><strong>${z.nome}</strong></td><td>${km(z.ate_km)}</td>
        <td class="texto-direita">${z.taxa ? brl(z.taxa) : "Grátis"}</td><td class="texto-direita">~${z.prazo_min} min</td>
        <td><label class="interruptor interruptor--tabela"><input type="checkbox" ${z.ativa && "checked"} data-acao="alternar-faixa" data-id="${z.id}" aria-label="Faixa ativa: ${z.nome}"><span class="interruptor__trilho"></span></label></td>
        <td class="texto-direita nowrap">
          <button type="button" class="btn-icone btn-icone--pequeno" data-acao="editar-faixa" data-id="${z.id}" aria-label="Editar ${z.nome}">${icone("editar", { tamanho: 17 })}</button>
          <button type="button" class="btn-icone btn-icone--pequeno btn-icone--perigo" data-acao="excluir-faixa" data-id="${z.id}" aria-label="Excluir ${z.nome}">${icone("lixeira", { tamanho: 17 })}</button></td></tr>`)}</tbody></table></div>`
      : vazio("caminhao", "Nenhuma faixa cadastrada", "Sem faixas, todas as entregas usam a taxa única acima."));
  }

  function formFaixa(z = null) {
    const f = z ?? {};
    const m = abrirModal({
      titulo: z ? "Editar faixa" : "Nova faixa de entrega", largura: 460,
      corpo: html`<form id="form-faixa" novalidate>
        <div class="form-erro" data-erro-geral hidden></div>
        ${campo({ nome: "nome", rotulo: "Nome", valor: f.nome ?? "", placeholder: "Ex.: Até 5 km", obrigatorio: true, atributos: 'maxlength="40" autofocus' })}
        <div class="grade-campos grade-campos--3">
          ${campo({ nome: "ate_km", rotulo: "Até (km)", valor: f.ate_km ?? "", tipo: "number", obrigatorio: true, atributos: 'min="0.1" step="0.1"' })}
          ${campo({ nome: "taxa", rotulo: "Frete (R$)", valor: emReais(f.taxa ?? 0), mascara: "moeda", obrigatorio: true })}
          ${campo({ nome: "prazo_min", rotulo: "Prazo (min)", valor: f.prazo_min ?? 60, tipo: "number", atributos: 'min="5"' })}
        </div>
        ${interruptor({ nome: "ativa", rotulo: "Faixa ativa", marcado: f.ativa ?? true })}
      </form>`,
      rodape: html`<button type="button" class="btn btn--suave" data-fechar>Cancelar</button>
        <button type="submit" form="form-faixa" class="btn btn--primario" data-salvar>Salvar faixa</button>`,
    });
    const form = m.el.querySelector("form");
    ativarCampos(form);
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const d = dadosDe(form);
      const corpo = { ...d, ate_km: Number(String(d.ate_km).replace(",", ".")), taxa: paraCentavos(d.taxa), prazo_min: Number(d.prazo_min) };
      await ocupado(m.el.querySelector("[data-salvar]"), async () => {
        try {
          zonas = (z ? await api.put(`/zonas/${z.id}`, corpo) : await api.post("/zonas", corpo)).zonas;
          toast("Faixa salva!");
          m.fechar(); desenharFaixas(); circulos();
        } catch (erro) { mostrarErros(form, erro, (msg) => toast(msg, "erro")); }
      });
    });
  }

  const achar = (el) => zonas.find((z) => z.id === Number(el.dataset.id));

  delegar(ctx.raiz, {
    achar: async (el) => {
      await ocupado(el, async () => {
        const consulta = [cfg.loja.endereco, cfg.loja.cidade, cfg.loja.uf, "Brasil"].filter(Boolean).join(", ");
        const p = cfg.loja.endereco ? await geocodificar(consulta) : null;
        if (p) definir(p.lat, p.lng); else toast("Não achamos o endereço. Preencha-o em Configurações ou clique no mapa.", "info");
      });
    },
    gps: async (el) => {
      await ocupado(el, async () => {
        try { const p = await localizarUsuario(); definir(p.lat, p.lng); } catch (erro) { toast(erro.message, "info"); }
      });
    },
    "salvar-local": async (el) => {
      await ocupado(el, async () => {
        try {
          const { configuracoes } = await api.put("/configuracoes/loja", { ...cfg.loja, lat: pino.lat, lng: pino.lng });
          cfg = configuracoes; alterado = false; info(); toast("Localização da loja salva!");
        } catch (erro) { toast(erro.message, "erro"); }
      });
    },
    "nova-faixa": () => formFaixa(),
    "editar-faixa": (el) => formFaixa(achar(el)),
    "excluir-faixa": async (el) => {
      const z = achar(el);
      if (!(await confirmar({ titulo: "Excluir faixa", mensagem: `Excluir “${z.nome}”?`, rotulo: "Excluir", perigo: true }))) return;
      try { zonas = (await api.delete(`/zonas/${z.id}`)).zonas; toast("Faixa excluída."); desenharFaixas(); circulos(); }
      catch (erro) { toast(erro.message, "erro"); }
    },
  });
  ctx.raiz.addEventListener("change", async (ev) => {
    const el = ev.target.closest("[data-acao=alternar-faixa]");
    if (!el) return;
    const z = achar(el);
    try { zonas = (await api.put(`/zonas/${z.id}`, { ...z, ativa: el.checked })).zonas; desenharFaixas(); circulos(); }
    catch (erro) { toast(erro.message, "erro"); desenharFaixas(); }
  });

  const formRegras = $("#form-regras");
  ativarCampos(formRegras);
  formRegras.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const d = dadosDe(formRegras);
    await ocupado(formRegras.querySelector("[type=submit]"), async () => {
      try {
        cfg = (await api.put("/configuracoes/entrega", { ...d, gratis_acima: paraCentavos(d.gratis_acima), taxa_padrao: paraCentavos(d.taxa_padrao) })).configuracoes;
        toast("Regras salvas!");
      } catch (erro) { mostrarErros(formRegras, erro, (m) => toast(m, "erro")); }
    });
  });

  desenharFaixas();
  return () => mapa?.destruir();
}
