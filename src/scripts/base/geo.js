/* GEO — distância entre coordenadas e faixa de entrega (a loja mostra a prévia; o banco recalcula com a mesma conta em _faixa_entrega) */

/** Distância em km entre dois pontos (fórmula de Haversine). */
export function distanciaKm(lat1, lng1, lat2, lng2) {
  const rad = (g) => (g * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Descobre a faixa de entrega de um ponto. `zonas` vem ordenada por ate_km.
 * Devolve { status: "ok" | "fora" | "sem_local", distancia_km, taxa, zona, prazo_min }.
 */
export function faixaDeEntrega({ zonas, loja, lat, lng, taxaPadrao = 0 }) {
  if (!zonas.length) return { status: "ok", distancia_km: null, taxa: taxaPadrao, zona: null, prazo_min: null };
  if (lat == null || lng == null || loja.lat == null || loja.lng == null) {
    return { status: "sem_local", distancia_km: null, taxa: 0, zona: null, prazo_min: null };
  }
  const distancia = Math.round(distanciaKm(loja.lat, loja.lng, lat, lng) * 10) / 10;
  const zona = zonas.find((z) => distancia <= z.ate_km);
  if (!zona) return { status: "fora", distancia_km: distancia, taxa: 0, zona: null, prazo_min: null };
  return { status: "ok", distancia_km: distancia, taxa: zona.taxa, zona: { id: zona.id, nome: zona.nome }, prazo_min: zona.prazo_min };
}
