# Loja

Site que o **cliente** usa: cardápio, conta, endereços com mapa, carrinho, pedido (com agenda e sinal) e acompanhamento.
Visual premium em rosa e dourado; fotos, perguntas frequentes e textos legais são editados no Dashboard.

**Esta pasta é um site completo**, com repositório próprio (`Luciene-Aguiar-Confeitaria-Loja`, privado) e projeto próprio na Vercel.
Tudo de que precisa está aqui dentro. Não usa nenhum arquivo do Dashboard nem de outra pasta.

```
Loja/
├─ index.html          página única (as telas trocam pelo endereço #/…)
├─ package.json        comando de build (npm run build)
├─ vercel.json         build e cabeçalhos de segurança
├─ .env.example        modelo das configurações (SUPABASE_URL e SUPABASE_ANON_KEY; URL_SITE é opcional e serve ao mapa do site)
├─ sw.js · manifest.webmanifest · robots.txt   app instalável (PWA) e orientações para buscadores (o sitemap é gerado no build)
├─ .gitignore · .gitattributes
├─ build/              monta a pasta de publicação (dist/) e gera o config.js
└─ src/
   ├─ estilos/
   │  ├─ main.css      ponto de entrada dos estilos
   │  ├─ base/         cores (tokens.css), botões, formulários, janelas, mapa…
   │  ├─ layout.css · componentes.css
   │  └─ paginas/      um CSS por tela
   ├─ scripts/
   │  ├─ main.js       ponto de entrada e tabela de rotas
   │  ├─ base/         ferramentas gerais: HTML seguro, roteador, janelas, formulários, mapa, PIX, datas…
   │  │  └─ api/       a ponte com o Supabase (nucleo.js = conexão e erros · loja.js = as chamadas da loja)
   │  ├─ nucleo/       conexão configurada (api.js), sessão, estado, carrinho, catálogo
   │  ├─ componentes/  cabeçalho, rodapé, carrinho lateral, cartão/modal de produto…
   │  └─ paginas/      início, cardápio, favoritos, entrar/cadastrar/recuperar, checkout, conta (com privacidade), pedido, contato, privacidade e termos
   ├─ vendor/          bibliotecas de terceiros sem alteração (supabase-js, Leaflet)
   └─ imagens/         favicon
```

## Onde mexer

| Quero mudar… | Onde |
|---|---|
| Uma tela ou um texto | `src/scripts/paginas/` e `src/estilos/paginas/` |
| Cores da loja | `src/estilos/base/tokens.css` |
| Menu, rodapé, carrinho | `src/scripts/componentes/` |
| Regras de preço, frete, cupom, horário | no banco de dados (pasta `supabase/` do repositório do Dashboard): o banco decide, a tela só mostra uma prévia |

Tudo aqui é da Loja: pode editar à vontade, sem se preocupar com o Dashboard.

## Ligação com o Dashboard

Nenhuma por arquivo. Os dois falam com o **mesmo banco no Supabase**, e por isso o que se muda no Dashboard
(cardápio, preços, horários, status de pedidos) aparece aqui. O banco, os guias e as ferramentas de teste
ficam no repositório do Dashboard (pastas `supabase`, `docs` e `ferramentas`).

## Rodar e publicar

- **Tudo junto, no seu computador:** deixe as pastas `Loja` e `Dashboard` lado a lado, entre em `Dashboard` e rode `npm run dev` → Loja em http://localhost:3000 (com banco de teste).
- **Vercel:** projeto novo apontando para este repositório (Root Directory em branco), Framework *Other*, variáveis
  `SUPABASE_URL` e `SUPABASE_ANON_KEY`. O comando de build já vem do `vercel.json`. Passo a passo em `docs/PUBLICAR.md` do repositório do Dashboard.
- **Build só desta pasta:** copie `.env.example` para `.env`, preencha e rode `npm run build` (gera `dist/`).

## Regras da casa

- Preço, frete, cupom e horário são **recalculados no banco**; a tela só mostra uma prévia.
- A sessão do cliente fica na chave `sb-loja-auth`.
