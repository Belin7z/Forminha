/* ==========================================================
   MAPA — Leaflet + OpenStreetMap, busca de endereço por CEP
   (ViaCEP) e geocodificação (Nominatim). O Leaflet só é
   carregado quando alguma página realmente pede um mapa.
   ========================================================== */

import { corDoTema } from "./tema.js";

let promessaLeaflet = null;

export function carregarLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  promessaLeaflet ??= new Promise((ok, falhar) => {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "/src/vendor/leaflet/leaflet.css";
    document.head.append(css);

    const js = document.createElement("script");
    js.src = "/src/vendor/leaflet/leaflet.js";
    js.onload = () => ok(window.L);
    js.onerror = () => { promessaLeaflet = null; falhar(new Error("Não foi possível carregar o mapa.")); };
    document.head.append(js);
  });
  return promessaLeaflet;
}

/**
 * Cria um mapa dentro de `elemento`.
 *   pino: true      -> mostra um marcador
 *   arrastavel      -> o usuário pode arrastar o pino ou clicar no mapa para mover
 *   aoMover(lat,lng)-> chamado quando o usuário move o pino
 */
export async function criarMapa(elemento, { lat, lng, zoom = 16, pino = true, arrastavel = false, aoMover } = {}) {
  const L = await carregarLeaflet();
  const mapa = L.map(elemento, { scrollWheelZoom: false, attributionControl: true }).setView([lat, lng], zoom);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: "© OpenStreetMap",
  }).addTo(mapa);

  const icone = L.divIcon({
    className: "mapa-pino",
    html: '<svg width="34" height="42" viewBox="0 0 34 42"><path d="M17 41C17 41 3 27 3 16a14 14 0 0 1 28 0c0 11-14 25-14 25z" fill="#cf6690" stroke="#fff" stroke-width="2.5"/><circle cx="17" cy="16" r="5.5" fill="#fff"/></svg>',
    iconSize: [34, 42], iconAnchor: [17, 41],
  });

  const camadas = [];
  let marcador = null;
  if (pino) {
    marcador = L.marker([lat, lng], { icon: icone, draggable: arrastavel }).addTo(mapa);
    if (arrastavel) {
      marcador.on("dragend", () => { const p = marcador.getLatLng(); aoMover?.(p.lat, p.lng); });
      mapa.on("click", (e) => { marcador.setLatLng(e.latlng); aoMover?.(e.latlng.lat, e.latlng.lng); });
    }
  }
  // o mapa costuma nascer dentro de modais/abas; recalcula o tamanho depois de desenhar
  setTimeout(() => mapa.invalidateSize(), 120);

  return {
    mapa,
    /** Move o pino e centraliza. */
    mover(novaLat, novaLng, novoZoom) {
      marcador?.setLatLng([novaLat, novaLng]);
      mapa.setView([novaLat, novaLng], novoZoom ?? mapa.getZoom());
    },
    posicao: () => (marcador ? { lat: marcador.getLatLng().lat, lng: marcador.getLatLng().lng } : null),
    /** Desenha círculos de raio (em km) ao redor de um ponto — usado nas faixas de entrega. */
    circulos(centro, raiosKm) {
      camadas.splice(0).forEach((c) => c.remove());
      raiosKm.forEach((km, i) => {
        camadas.push(
          L.circle([centro.lat, centro.lng], {
            radius: km * 1000, color: corDoTema("--marca-destaque", "#cf6690"), weight: 2, fillColor: corDoTema("--marca-300", "#f9ccdc"), fillOpacity: 0.12 + (raiosKm.length - i) * 0.02,
          }).addTo(mapa)
        );
      });
      if (camadas.length) mapa.fitBounds(camadas[camadas.length - 1].getBounds(), { padding: [20, 20] });
    },
    ajustar: () => mapa.invalidateSize(),
    destruir: () => mapa.remove(),
  };
}

/** Consulta o ViaCEP. Devolve { rua, bairro, cidade, uf } ou null se o CEP não existir. */
export async function buscarCep(cep) {
  const digitos = String(cep).replace(/\D/g, "");
  if (digitos.length !== 8) return null;
  try {
    const r = await fetch(`https://viacep.com.br/ws/${digitos}/json/`);
    const d = await r.json();
    if (d.erro) return null;
    return { rua: d.logradouro ?? "", bairro: d.bairro ?? "", cidade: d.localidade ?? "", uf: d.uf ?? "" };
  } catch {
    return null;
  }
}

/** Converte um endereço em coordenadas (Nominatim/OpenStreetMap). Devolve { lat, lng } ou null. */
export async function geocodificar(consulta) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=br&q=${encodeURIComponent(consulta)}`;
    const r = await fetch(url, { headers: { "Accept-Language": "pt-BR" } });
    const lista = await r.json();
    return lista[0] ? { lat: Number(lista[0].lat), lng: Number(lista[0].lon) } : null;
  } catch {
    return null;
  }
}

/** Pede a localização do aparelho (o navegador pergunta ao usuário). */
export function localizarUsuario() {
  return new Promise((ok, falhar) => {
    if (!navigator.geolocation) return falhar(new Error("Este aparelho não permite localização."));
    navigator.geolocation.getCurrentPosition(
      (p) => ok({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => falhar(new Error("Não foi possível obter sua localização. Marque no mapa.")),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}
