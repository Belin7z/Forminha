/* ==========================================================
   MIDDLEWARE (Vercel) — com MULTILOJA=1 (um site para todas as
   lojas do banco único), a loja já abre com o nome, a descrição, a
   foto do link compartilhado, as cores e o ícone da loja do
   endereço (build/borda.mjs). Sem MULTILOJA, não faz nada: o site
   da loja já foi personalizado na publicação.
   ========================================================== */
import { criarPersonalizador } from "./build/borda.mjs";

export const config = { matcher: ["/", "/config.js", "/manifest.webmanifest", "/src/imagens/favicon.svg", "/robots.txt", "/sitemap.xml"] };

const personalizar = criarPersonalizador({ site: "loja", env: process.env });

export default function middleware(request) {
  return personalizar(request);
}
