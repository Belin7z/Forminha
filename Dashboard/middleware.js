/* ==========================================================
   MIDDLEWARE (Vercel) — com MULTILOJA=1 (um site para todas as
   lojas do banco único), o painel já abre com o nome, as cores e o
   ícone da loja do endereço (build/borda.mjs). Sem MULTILOJA, não
   faz nada: o site da loja já foi personalizado na publicação.
   ========================================================== */
import { criarPersonalizador } from "./build/borda.mjs";

export const config = { matcher: ["/", "/config.js", "/manifest.webmanifest", "/src/imagens/favicon.svg"] };

const personalizar = criarPersonalizador({ site: "dashboard", env: process.env });

export default function middleware(request) {
  return personalizar(request);
}
