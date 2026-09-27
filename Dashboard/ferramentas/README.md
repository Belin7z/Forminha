# ferramentas

Só serve para **trabalhar no computador**. Nada daqui vai para a Vercel nem faz parte do site (o build só publica `index.html` e `src/`).

```
ferramentas/
├─ dev.mjs            npm run dev — liga Loja (:3000) e Dashboard (:3001) com um banco de teste local
├─ juntar-sql.mjs     npm run sql — reúne as migrações e as configurações iniciais em ../supabase/instalar-tudo.sql (sem cardápio)
└─ testes/            npm test
   ├─ api.test.js                 fluxo completo: cadastro, pedido, painel, permissões, fotos…
   ├─ confirmacao.test.js         cadastro com "confirmar e-mail" ligado
   ├─ sites-independentes.test.js copia só a pasta de cada site e confere que ele monta sozinho
   └─ emulador/                   Postgres de teste + simulador do Supabase (login, funções, fotos)
```

- Rode os comandos dentro da pasta `Dashboard`.
- `npm run dev` usa o banco de teste (some ao fechar). Com um arquivo `.env` na pasta `Dashboard` (modelo: `.env.example`) usa o Supabase de verdade.
- Os testes aplicam as migrações de `../supabase/migrations` num Postgres local e usam o código das pastas `Loja` e `Dashboard`.
