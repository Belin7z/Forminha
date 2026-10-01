/* ==========================================================
   BORDA — um site para várias lojas (MULTILOJA=1): antes de entregar
   a página, a Vercel pergunta ao banco qual loja mora no endereço
   aberto e entrega tudo já com a cara dela:
     • título, descrição e imagem do link compartilhado (o WhatsApp
       lê o HTML sem rodar o JavaScript);
     • as cores no config.js (a 1ª visita já abre com o tema);
     • o aplicativo instalável e o ícone da aba;
     • robots.txt e sitemap.xml do endereço, com os produtos (só na loja).
   E o link próprio de cada produto (/p/12-bolo-de-ninho) sai com a
   foto, o nome e o preço do produto — também na loja de site próprio
   (sem MULTILOJA), que de resto já foi personalizada na publicação.
   É a mesma personalização da publicação (build/personalizar.mjs),
   só que na hora. Se o banco não responder, a página sai padrão e
   se ajusta sozinha ao abrir (nada quebra). Usado por middleware.js.
   (Arquivo igual na Loja e no Dashboard.)
   ========================================================== */
import { faviconDaLoja, manifestoDaLoja, manifestoDoPainel, pacoteDoTema, personalizarHtmlLoja, personalizarHtmlPainel, personalizarHtmlProduto } from "./personalizar.mjs";
import { caminhoDoProduto, produtoDoCaminho } from "../src/scripts/base/dominio.js";

export const CAMINHOS = ["/", "/config.js", "/manifest.webmanifest", "/src/imagens/favicon.svg", "/robots.txt", "/sitemap.xml"];
const BASE = "x-forminha-base"; // o pedido que busca o arquivo original passa direto
const MINUTO = 60_000;

/** Cancela a consulta que demora (a página padrão é melhor que uma página que não abre). */
function tempoLimite(ms) {
  const c = new AbortController();
  setTimeout(() => c.abort(), ms)?.unref?.(); // (fora da Vercel, não segura o programa aberto)
  return c.signal;
}

/** "Siga em frente": a Vercel entrega o arquivo normal (o mesmo que next() de @vercel/functions). */
export const seguir = () => new Response(null, { headers: { "x-middleware-next": "1" } });

/**
 * site: "loja" | "dashboard". env: as variáveis do projeto na Vercel (MULTILOJA, SUPABASE_URL, SUPABASE_ANON_KEY).
 * Devolve a função que a Vercel chama a cada pedido desses caminhos.
 */
export function criarPersonalizador({ site, env, fetchFn = (...a) => fetch(...a), agora = () => Date.now() }) {
  const multiloja = env.MULTILOJA === "1";
  const guardados = new Map(); // "função endereço" -> { dados, ate }: o banco é perguntado no máximo uma vez por minuto por loja

  /** Uma função pública do banco (loja_config, loja_catalogo), guardada por um minuto. */
  async function doBanco(funcao, host) {
    const chave = `${funcao} ${host}`;
    const g = guardados.get(chave);
    if (g && g.ate > agora()) return g.dados;
    const r = await fetchFn(`${env.SUPABASE_URL}/rest/v1/rpc/${funcao}`, {
      method: "POST",
      // num banco de uma loja só, a loja é a única: o endereço não precisa (nem pode) ir junto
      headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, "Content-Type": "application/json", ...(multiloja && { "x-loja": host }) },
      body: "{}", signal: tempoLimite(2500),
    });
    if (!r.ok) throw new Error(`o banco respondeu ${r.status}`);
    const dados = await r.json();
    if (guardados.size > 1000) guardados.clear();
    guardados.set(chave, { dados, ate: agora() + MINUTO });
    return dados;
  }

  async function dadosDaLoja(host) {
    const dados = await doBanco("loja_config", host);
    if (!dados?.loja) throw new Error("sem os dados da loja");
    return dados;
  }

  /** Link próprio do produto: a página da loja com a foto, o nome e o preço dele na prévia. */
  async function paginaDoProduto(url, id) {
    const [dados, catalogo, base] = await Promise.all([
      dadosDaLoja(url.hostname),
      doBanco("loja_catalogo", url.hostname),
      fetchFn(new URL("/", url.origin), { headers: { [BASE]: "1" } }),
    ]);
    if (!base.ok) return seguir();
    let html = await base.text();
    if (multiloja) html = personalizarHtmlLoja(html, dados); // no site próprio, a página já vem com a cara da loja
    const produto = (catalogo?.produtos ?? []).find((p) => p.id === id);
    if (produto) html = personalizarHtmlProduto(html, produto, dados, url.origin);
    const cabecalhos = new Headers(base.headers);
    for (const h of ["content-length", "content-encoding", "etag", "last-modified", "age"]) cabecalhos.delete(h);
    cabecalhos.set("cache-control", "no-cache");
    return new Response(html, { status: 200, headers: cabecalhos });
  }

  return async function personalizar(request) {
    if (request.headers.get(BASE)) return seguir();
    const url = new URL(request.url);
    const idProduto = site === "loja" ? produtoDoCaminho(url.pathname) : null;
    if (idProduto) return paginaDoProduto(url, idProduto).catch(() => seguir()); // sem o banco: a página padrão abre o produto do mesmo jeito
    if (!multiloja || !CAMINHOS.includes(url.pathname)) return seguir();
    try {
      if (site === "loja" && url.pathname === "/robots.txt") {
        return new Response(`User-agent: *\nAllow: /\nSitemap: ${url.origin}/sitemap.xml\n`, { headers: { "content-type": "text/plain; charset=utf-8" } });
      }
      if (site === "loja" && url.pathname === "/sitemap.xml") {
        const produtos = await doBanco("loja_catalogo", url.hostname).then((c) => c?.produtos ?? []).catch(() => []);
        const enderecos = [`${url.origin}/`, ...produtos.map((p) => url.origin + caminhoDoProduto(p))];
        const mapa = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${enderecos.map((e) => `<url><loc>${e}</loc></url>`).join("")}</urlset>\n`;
        return new Response(mapa, { headers: { "content-type": "application/xml; charset=utf-8" } });
      }
      if (url.pathname === "/robots.txt" || url.pathname === "/sitemap.xml") return seguir();

      const [dados, base] = await Promise.all([
        dadosDaLoja(url.hostname),
        fetchFn(new URL(url.pathname, url.origin), { headers: { [BASE]: "1" } }),
      ]);
      if (!base.ok) return seguir();
      let corpo;
      if (url.pathname === "/") {
        const html = await base.text();
        corpo = site === "loja" ? personalizarHtmlLoja(html, dados) : personalizarHtmlPainel(html, dados);
      } else if (url.pathname === "/config.js") {
        corpo = (await base.text()).replace('"multiloja":true', `"multiloja":true,"tema":${JSON.stringify(pacoteDoTema(dados.aparencia))}`);
      } else if (url.pathname === "/manifest.webmanifest") {
        const manifesto = await base.json();
        corpo = JSON.stringify(site === "loja" ? manifestoDaLoja(manifesto, dados) : manifestoDoPainel(manifesto, dados), null, 2);
      } else {
        corpo = faviconDaLoja(dados);
      }
      // os mesmos cabeçalhos do arquivo original (segurança, tipo), sem guardar em cache: cada loja tem o seu
      const cabecalhos = new Headers(base.headers);
      for (const h of ["content-length", "content-encoding", "etag", "last-modified", "age"]) cabecalhos.delete(h);
      cabecalhos.set("cache-control", "no-cache");
      return new Response(corpo, { status: 200, headers: cabecalhos });
    } catch {
      return seguir(); // o banco não respondeu: a página padrão se ajusta sozinha ao abrir
    }
  };
}
