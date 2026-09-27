# Dashboard

Painel de **administração** da loja: pedidos, cardápio, clientes, cupons, entrega e configurações.
Só entra quem tem papel `admin` no banco.

Cada loja tem dois sites — **Loja** e **Dashboard** — e cada um é uma pasta completa deste repositório, publicada
num projeto próprio na Vercel (a Central cria os dois para cada loja nova).
O Dashboard também guarda o que serve aos dois: o **banco de dados**, os **guias** e as **ferramentas de teste**
(nada disso vai para o ar).

```
Forminha/
├─ Loja/          site do cliente (pasta completa e independente)
├─ Central/       onde as lojas são criadas (forminha.vercel.app)
└─ Dashboard/     ← você está aqui
   ├─ index.html · package.json · vercel.json · .env.example · .gitignore · README.md
   ├─ build/         monta a pasta de publicação (dist/) e gera o config.js
   ├─ src/           o SITE do Dashboard (detalhes abaixo)
   ├─ supabase/      o banco de dados: migrações (tabelas, regras, segurança) + configurações iniciais
   ├─ ferramentas/   dev.mjs (teste local) · juntar-sql.mjs · testes/ (testes automáticos)
   └─ docs/          GUIA.md (como funciona) · PUBLICAR.md (como colocar no ar)
```

## O site (`src/`)

```
src/
├─ estilos/
│  ├─ main.css      ponto de entrada dos estilos
│  ├─ base/         cores (tokens.css), botões, formulários, janelas, mapa…
│  └─ estrutura.css · componentes.css · paginas.css
├─ scripts/
│  ├─ main.js       ponto de entrada: login ou painel + tabela de rotas
│  ├─ base/         ferramentas gerais: HTML seguro, roteador, janelas, formulários, mapa, datas…
│  │  └─ api/       a ponte com o Supabase (nucleo.js = conexão e erros · painel.js = as chamadas do painel)
│  ├─ nucleo/       conexão configurada (api.js), estado, notificações de pedido novo
│  ├─ componentes/  estrutura (menu/topo), gráfico, detalhe do pedido, formulário de produto…
│  └─ paginas/      visão geral, pedidos, novo pedido, agenda, produção, produtos, categorias, clientes, avaliações,
│                   favoritos, cupons, entrega, configurações, equipe, atividade, conta, entrar
├─ vendor/          bibliotecas de terceiros sem alteração (supabase-js, Leaflet)
└─ imagens/         favicon
```

## Comandos (rode dentro da pasta `Dashboard`)

```
npm install        (só na primeira vez)
npm run dev        # Loja em http://localhost:3000 · Dashboard em http://localhost:3001 (com banco de teste)
npm test           # testes automáticos
npm run sql        # gera supabase/instalar-tudo.sql para colar no Supabase
npm run build      # monta o Dashboard em dist/ (a Vercel faz isso sozinha)
```

Para o `npm run dev` ligar os dois sites, as pastas `Loja` e `Dashboard` precisam estar **lado a lado** (mesma pasta-mãe).

Login de teste do `npm run dev`: `admin@exemplo.com` / `Admin12345` (só no banco local de teste, que some ao fechar).
Com um arquivo `.env` nesta pasta (modelo: `.env.example`) o `npm run dev` usa o Supabase de verdade.

## Onde mexer

| Quero mudar… | Onde |
|---|---|
| Uma tela ou o menu do Dashboard | `src/scripts/paginas/` e `src/scripts/componentes/` |
| Cores do Dashboard | `src/estilos/base/tokens.css` |
| Regras de negócio, permissões, tabelas | `supabase/` (funções `admin_*`, `cliente_*`, `loja_*`) |
| Como colocar no ar | `docs/PUBLICAR.md` |

## Ligação com a Loja

Nenhuma por arquivo: o Dashboard não usa nada da pasta Loja e a Loja não usa nada daqui. Os dois falam com o **mesmo banco no
Supabase**, e por isso o que se muda aqui (cardápio, preços, horários, status de pedidos) aparece na Loja. A única referência direta é
a variável `URL_LOJA`: o endereço público da Loja, usado no e-mail de redefinição de senha que o Dashboard envia aos clientes.
(Só as ferramentas de teste, em `ferramentas/`, leem a pasta Loja para rodar os dois sites juntos no computador.)

## Publicar

**Vercel:** projeto novo apontando para este repositório (Root Directory em branco), Framework *Other*, variáveis
`SUPABASE_URL`, `SUPABASE_ANON_KEY` e `URL_LOJA`. O comando de build já vem do `vercel.json`, e só o `dist/` vai para o ar
(o banco, os guias e as ferramentas ficam de fora). Passo a passo em `docs/PUBLICAR.md`.

## Regras da casa

- Nenhuma tabela é lida direto: tudo passa por funções `admin_*` que conferem o papel `admin` no banco.
- A sessão fica na chave `sb-painel-auth` e o site pede `noindex` aos buscadores.
- Novo administrador: a pessoa cria conta na Loja e, em **Equipe**, você libera. O primeiro admin é criado pelo SQL (veja `docs/PUBLICAR.md`).
