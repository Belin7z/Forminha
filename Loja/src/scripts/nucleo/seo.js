/* NÚCLEO — dados para o Google e para o compartilhamento (título, descrição, imagem, "Bakery") e app instalável */
import { caminhoDoProduto } from "/src/scripts/base/dominio.js";
import { precoInicial } from "./catalogo.js";

const definir = (seletor, criar, valor) => {
  if (!valor) return;
  let el = document.head.querySelector(seletor);
  if (!el) { el = document.createElement(criar.tag); for (const [k, v] of Object.entries(criar.atributos)) el.setAttribute(k, v); document.head.append(el); }
  el.setAttribute(criar.alvo, valor);
};

/** Preenche título, descrição, imagem de compartilhamento e os dados estruturados da loja. */
export function aplicarSeo(config) {
  const { loja, textos } = config;
  const titulo = loja.slogan ? `${loja.nome} — ${loja.slogan}` : loja.nome;
  const descricao = textos.hero_subtitulo || loja.slogan || "Faça seu pedido online, com entrega ou retirada.";
  const imagem = textos.hero_imagem || loja.logo || "";
  document.title = titulo;
  definir('meta[name="description"]', { tag: "meta", atributos: { name: "description" }, alvo: "content" }, descricao);
  definir('meta[property="og:title"]', { tag: "meta", atributos: { property: "og:title" }, alvo: "content" }, titulo);
  definir('meta[property="og:description"]', { tag: "meta", atributos: { property: "og:description" }, alvo: "content" }, descricao);
  definir('meta[property="og:image"]', { tag: "meta", atributos: { property: "og:image" }, alvo: "content" }, imagem);
  definir('meta[property="og:url"]', { tag: "meta", atributos: { property: "og:url" }, alvo: "content" }, location.origin + "/");
  definir('link[rel="canonical"]', { tag: "link", atributos: { rel: "canonical" }, alvo: "href" }, location.origin + "/");

  const dados = {
    "@context": "https://schema.org", "@type": "Bakery", name: loja.nome, description: descricao, url: location.origin + "/",
    ...(imagem && { image: imagem }),
    ...(loja.whatsapp && { telephone: "+55" + loja.whatsapp }),
    ...(loja.email && { email: loja.email }),
    ...(loja.endereco && { address: { "@type": "PostalAddress", streetAddress: loja.endereco, addressLocality: loja.cidade, addressRegion: loja.uf, addressCountry: "BR" } }),
    ...(loja.instagram && { sameAs: ["https://instagram.com/" + loja.instagram] }),
  };
  let script = document.getElementById("dados-estruturados");
  if (!script) { script = document.createElement("script"); script.id = "dados-estruturados"; script.type = "application/ld+json"; document.head.append(script); }
  script.textContent = JSON.stringify(dados);
}

/** Enquanto o link próprio de um produto está aberto: título, descrição, imagem e dados de produto (para o Google). */
export function aplicarSeoDoProduto(config, p) {
  const { loja, textos } = config;
  const url = location.origin + caminhoDoProduto(p);
  const titulo = `${p.nome} — ${loja.nome}`;
  const descricao = String(p.descricao ?? "").trim() || `${p.nome}: encomende online na ${loja.nome}.`;
  const imagem = p.imagem || textos.hero_imagem || loja.logo || "";
  document.title = titulo;
  definir('meta[name="description"]', { tag: "meta", atributos: { name: "description" }, alvo: "content" }, descricao);
  definir('meta[property="og:title"]', { tag: "meta", atributos: { property: "og:title" }, alvo: "content" }, titulo);
  definir('meta[property="og:description"]', { tag: "meta", atributos: { property: "og:description" }, alvo: "content" }, descricao);
  definir('meta[property="og:image"]', { tag: "meta", atributos: { property: "og:image" }, alvo: "content" }, imagem);
  definir('meta[property="og:url"]', { tag: "meta", atributos: { property: "og:url" }, alvo: "content" }, url);
  definir('link[rel="canonical"]', { tag: "link", atributos: { rel: "canonical" }, alvo: "href" }, url);
  const { preco } = precoInicial(p);
  const script = document.getElementById("dados-estruturados");
  if (script) {
    script.textContent = JSON.stringify({
      "@context": "https://schema.org", "@type": "Product", name: p.nome, description: descricao, url,
      ...(imagem && { image: imagem }),
      brand: { "@type": "Brand", name: loja.nome },
      offers: { "@type": "Offer", price: (preco / 100).toFixed(2), priceCurrency: "BRL", availability: "https://schema.org/InStock", url },
    });
  }
}

/** Deixa a loja instalável no celular e funcionando com internet ruim (só em https ou localhost). */
export function registrarApp() {
  if (!("serviceWorker" in navigator)) return;
  if (location.protocol !== "https:" && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") return;
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
