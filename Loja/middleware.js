/* ==========================================================
   MIDDLEWARE (Vercel) — com MULTILOJA=1 (um site para todas as
   lojas do banco único), a loja já abre com o nome, a descrição, a
   foto do link compartilhado, as cores e o ícone da loja do
   endereço (build/borda.mjs). Sem MULTILOJA, só o link próprio de
   cada produto (/p/12-…) passa por aqui (a foto e o nome dele na
   prévia); o resto do site já foi personalizado na publicação.
   ========================================================== */
import { criarPersonalizador } from "./build/borda.mjs";

export const config = { matcher: ["/", "/config.js", "/manifest.webmanifest", "/src/imagens/favicon.svg", "/robots.txt", "/sitemap.xml", "/p/:produto"] };

const personalizar = criarPersonalizador({ site: "loja", env: process.env });

export default function middleware(request) {
  return personalizar(request);
}
