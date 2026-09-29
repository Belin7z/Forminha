/* Serviço do aplicativo do painel: rede primeiro (sempre a versão mais nova); sem internet, abre o que já foi aberto.
   Só guarda os arquivos do próprio painel: pedidos, clientes e logins (Supabase, Central) nunca ficam guardados aqui. */
const VERSAO = "painel-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (evento) => {
  evento.waitUntil(caches.keys().then((nomes) => Promise.all(nomes.filter((n) => n !== VERSAO).map((n) => caches.delete(n)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (evento) => {
  const pedido = evento.request;
  if (pedido.method !== "GET" || new URL(pedido.url).origin !== self.location.origin) return;
  evento.respondWith(
    fetch(pedido)
      .then((resposta) => {
        if (resposta.ok) { const copia = resposta.clone(); caches.open(VERSAO).then((c) => c.put(pedido, copia)); }
        return resposta;
      })
      .catch(() => caches.match(pedido).then((guardado) => guardado || (pedido.mode === "navigate" ? caches.match("/") : Response.error())))
  );
});
