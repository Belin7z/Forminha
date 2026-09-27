/* Serviço do aplicativo: rede primeiro (o site sempre atualizado); sem internet, usa o que já foi aberto. */
const VERSAO = "v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (evento) => {
  evento.waitUntil(caches.keys().then((nomes) => Promise.all(nomes.filter((n) => n !== VERSAO).map((n) => caches.delete(n)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (evento) => {
  const pedido = evento.request;
  if (pedido.method !== "GET" || new URL(pedido.url).origin !== self.location.origin) return; // Supabase, mapas e fontes ficam de fora
  evento.respondWith(
    fetch(pedido)
      .then((resposta) => {
        if (resposta.ok) { const copia = resposta.clone(); caches.open(VERSAO).then((c) => c.put(pedido, copia)); }
        return resposta;
      })
      .catch(() => caches.match(pedido).then((guardado) => guardado || (pedido.mode === "navigate" ? caches.match("/") : Response.error())))
  );
});
