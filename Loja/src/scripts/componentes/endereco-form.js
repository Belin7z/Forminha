/* ==========================================================
   COMPONENTE — formulário de endereço.
   CEP preenche rua/bairro/cidade (ViaCEP), o mapa mostra o pino
   (arraste para ajustar) e a taxa de entrega aparece na hora.
   ========================================================== */
import { html } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { abrirModal, ocupado, toast } from "/src/scripts/base/ui.js";
import { ativarCampos, campo, dadosDe, interruptor, mostrarErros } from "/src/scripts/base/formularios.js";
import { brl, km } from "/src/scripts/base/formatacao.js";
import { UFS } from "/src/scripts/base/dominio.js";
import { faixaDeEntrega } from "/src/scripts/base/geo.js";
import { buscarCep, criarMapa, geocodificar, localizarUsuario } from "/src/scripts/base/mapa.js";
import { api } from "../nucleo/api.js";
import { estado } from "../nucleo/estado.js";

/** Texto explicando a entrega para um ponto (mesma regra usada pelo servidor). */
export function resumoDeEntrega(lat, lng) {
  const { zonas, loja, entrega } = estado.config;
  if (!entrega.entrega_ativa) return html`<span class="texto-suave">No momento atendemos apenas retirada.</span>`;
  const r = faixaDeEntrega({ zonas, loja, lat, lng, taxaPadrao: entrega.taxa_padrao });
  if (r.status === "sem_local") return html`${icone("pino", { tamanho: 16 })} Marque o local no mapa para calcular a entrega.`;
  if (r.status === "fora") return html`<span class="texto-perigo">${icone("alerta", { tamanho: 16 })} Fora da área de entrega (${km(r.distancia_km)} da loja).</span>`;
  const partes = [r.distancia_km != null ? `${km(r.distancia_km)} da loja` : null, r.taxa ? `frete ${brl(r.taxa)}` : "frete grátis", r.prazo_min ? `~${r.prazo_min} min` : null];
  return html`<span class="texto-sucesso">${icone("checkCirculo", { tamanho: 16 })} Atendemos! ${partes.filter(Boolean).join(" · ")}</span>`;
}

/**
 * Abre o formulário. `aoSalvar(enderecos, idSalvo)` recebe a lista atualizada da conta.
 */
export function abrirFormEndereco({ endereco = null, aoSalvar }) {
  const { loja, entrega } = estado.config;
  const e = endereco ?? {};
  let coords = e.lat != null ? { lat: e.lat, lng: e.lng } : null;
  let mapa = null;

  const m = abrirModal({
    titulo: endereco ? "Editar endereço" : "Novo endereço", largura: 680,
    corpo: html`
      <form id="form-endereco" novalidate>
        <div class="form-erro" data-erro-geral hidden></div>
        <div class="grade-campos grade-campos--2">
          ${campo({ nome: "apelido", rotulo: "Apelido", valor: e.apelido ?? "Casa", placeholder: "Casa, Trabalho…", obrigatorio: true, atributos: 'maxlength="30"' })}
          ${campo({ nome: "cep", rotulo: "CEP", valor: e.cep ?? "", placeholder: "00000-000", obrigatorio: true, mascara: "cep", ajuda: "Preenchemos rua e bairro para você." })}
        </div>
        ${campo({ nome: "rua", rotulo: "Rua", valor: e.rua ?? "", obrigatorio: true })}
        <div class="grade-campos grade-campos--2">
          ${campo({ nome: "numero", rotulo: "Número", valor: e.numero ?? "", obrigatorio: true, atributos: 'maxlength="10"' })}
          ${campo({ nome: "complemento", rotulo: "Complemento", valor: e.complemento ?? "", placeholder: "Apto, bloco…" })}
        </div>
        <div class="grade-campos grade-campos--3">
          ${campo({ nome: "bairro", rotulo: "Bairro", valor: e.bairro ?? "", obrigatorio: true })}
          ${campo({ nome: "cidade", rotulo: "Cidade", valor: e.cidade ?? "", obrigatorio: true })}
          ${campo({ nome: "uf", rotulo: "UF", tipo: "select", valor: e.uf ?? loja.uf, opcoes: UFS.map((u) => ({ valor: u, texto: u })) })}
        </div>
        ${campo({ nome: "referencia", rotulo: "Ponto de referência", valor: e.referencia ?? "", placeholder: "Ex.: portão azul, próximo à padaria" })}

        <div class="mapa-bloco">
          <div class="mapa-bloco__cab">
            <strong>${icone("pino", { tamanho: 17 })} Local da entrega</strong>
            <div class="linha-flex">
              <button type="button" class="btn btn--suave btn--pequeno" data-localizar>${icone("busca", { tamanho: 15 })} Achar pelo endereço</button>
              <button type="button" class="btn btn--suave btn--pequeno" data-gps>${icone("navegar", { tamanho: 15 })} Usar minha localização</button>
            </div>
          </div>
          <div class="mapa" data-mapa></div>
          <p class="mapa-bloco__dica">Arraste o pino ou toque no mapa para marcar a entrada exata.</p>
          <p class="mapa-bloco__info" data-info></p>
        </div>
        ${interruptor({ nome: "principal", rotulo: "Usar como endereço principal", marcado: !!e.principal })}
      </form>`,
    rodape: html`
      <button type="button" class="btn btn--suave" data-fechar>Cancelar</button>
      <button type="submit" form="form-endereco" class="btn btn--primario" data-salvar>Salvar endereço</button>`,
    aoFechar: () => mapa?.destruir(),
  });

  const form = m.el.querySelector("form");
  const info = m.el.querySelector("[data-info]");
  ativarCampos(form);

  function atualizarInfo() {
    info.innerHTML = String(coords ? resumoDeEntrega(coords.lat, coords.lng) : resumoDeEntrega(null, null));
  }

  function definirPonto(lat, lng, zoom = 17) {
    coords = { lat, lng };
    mapa?.mover(lat, lng, zoom);
    atualizarInfo();
  }

  criarMapa(m.el.querySelector("[data-mapa]"), {
    lat: coords?.lat ?? loja.lat ?? -23.5505,
    lng: coords?.lng ?? loja.lng ?? -46.6333,
    zoom: coords ? 17 : 13, arrastavel: true, pino: true,
    aoMover: (lat, lng) => { coords = { lat, lng }; atualizarInfo(); },
  }).then((criado) => { mapa = criado; if (m.fechado) mapa.destruir(); })
    .catch(() => { m.el.querySelector("[data-mapa]").innerHTML = '<p class="vazio">Não foi possível carregar o mapa agora.</p>'; });
  atualizarInfo();

  async function localizarPeloEndereco(silencioso = false) {
    const d = dadosDe(form);
    const consulta = [d.rua && `${d.rua}${d.numero ? ", " + d.numero : ""}`, d.bairro, d.cidade, d.uf, "Brasil"].filter(Boolean).join(", ");
    if (!d.rua || !d.cidade) { if (!silencioso) toast("Preencha rua e cidade primeiro.", "info"); return; }
    const p = await geocodificar(consulta);
    if (p) definirPonto(p.lat, p.lng);
    else if (!silencioso) toast("Não achamos esse endereço no mapa. Toque no mapa para marcar.", "info");
  }

  m.el.querySelector("[data-localizar]").addEventListener("click", (ev) => ocupado(ev.currentTarget, () => localizarPeloEndereco()));
  m.el.querySelector("[data-gps]").addEventListener("click", (ev) =>
    ocupado(ev.currentTarget, async () => {
      try { const p = await localizarUsuario(); definirPonto(p.lat, p.lng); }
      catch (erro) { toast(erro.message, "info"); }
    }));

  // CEP completo: busca o endereço e já posiciona o pino
  form.elements.cep.addEventListener("input", async (ev) => {
    if (ev.target.value.replace(/\D/g, "").length !== 8) return;
    const r = await buscarCep(ev.target.value);
    if (!r) { toast("CEP não encontrado. Preencha o endereço manualmente.", "info"); return; }
    form.elements.rua.value = r.rua || form.elements.rua.value;
    form.elements.bairro.value = r.bairro || form.elements.bairro.value;
    form.elements.cidade.value = r.cidade || form.elements.cidade.value;
    if (UFS.includes(r.uf)) form.elements.uf.value = r.uf;
    form.elements.numero.focus();
    await localizarPeloEndereco(true);
  });

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (entrega.entrega_ativa && !coords) {
      mostrarErros(form, { message: "Marque o local da entrega no mapa (arraste o pino ou use “Achar pelo endereço”).", campos: {} });
      return;
    }
    const botao = m.el.querySelector("[data-salvar]");
    await ocupado(botao, async () => {
      try {
        const corpo = { ...dadosDe(form), lat: coords?.lat ?? null, lng: coords?.lng ?? null };
        const { enderecos } = endereco ? await api.put(`/enderecos/${endereco.id}`, corpo) : await api.post("/enderecos", corpo);
        const salvo = endereco ? endereco.id : Math.max(...enderecos.map((x) => x.id));
        toast("Endereço salvo!");
        m.fechar();
        aoSalvar?.(enderecos, salvo);
      } catch (erro) {
        mostrarErros(form, erro, (msg) => toast(msg, "erro"));
      }
    });
  });

  return m;
}

