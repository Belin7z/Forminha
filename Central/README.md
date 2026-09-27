# Central da Forminha

Site onde **você** cria e acompanha as lojas das clientes: <https://forminha.vercel.app>.

Cada loja é independente: tem o **próprio banco** no Supabase (organização "Forminha", projeto
com o nome `<código> · <nome da loja>`, ex.: `7XT-Tna-dRe · Doce da Ana`) e **dois sites** na Vercel
(a loja e o painel da dona). Excluir a loja apaga tudo isso junto.

## Criar uma loja

1. Entre em forminha.vercel.app com a sua senha.
2. **Nova loja** → nome da loja e e-mail da dona → **Criar loja**.
3. A tela mostra o passo a passo (leva uns 3 a 5 minutos). No fim aparece o **convite**:
   mande pelo WhatsApp ou e-mail. A dona cria o acesso dela e já cai no painel da loja.

Na lista, cada loja tem: **Convite da dona** (link novo), **Atualizar banco** (quando sai
melhoria nova), **Reativar** (se o Supabase pausou) e **Excluir** (pede o código da loja).
Todo dia a Central dá uma "cutucada" em cada loja para o plano grátis do Supabase não pausar.

## Primeira configuração (uma vez só)

Na pasta `Central`, no seu terminal:

```
npm run configurar
```

Ele pergunta, sem mostrar o que você digita:

- a **senha** da Central (12 caracteres ou mais);
- a **chave do Supabase** — crie em <https://supabase.com/dashboard/account/tokens>
  (se der para limitar, deixe só a organização "Forminha");
- a **chave da Vercel** — crie em <https://vercel.com/account/tokens>.

As chaves vão direto para as variáveis secretas do projeto `forminha` na Vercel: não ficam no
computador, nem no código, nem no navegador.

## Para quem mexe no código

| Comando | O que faz |
|---|---|
| `npm run dev` | Central em <http://localhost:3100>. Sem chaves no `.env`: **modo de teste** (nada é criado de verdade), senha `forminha`. |
| `npm test` | Caminho completo de uma loja com Supabase e Vercel simulados (as migrações rodam de verdade num Postgres em memória). |
| `npm run copiar-sql` | Traz as migrações do `Dashboard/supabase` (a fonte da verdade). Rode depois de criar uma migração nova e publique a Central; depois use **Atualizar banco** em cada loja. |

Variáveis na Vercel: `CENTRAL_SENHA_HASH`, `SEGREDO_SESSAO`, `CRON_SECRET`, `SUPABASE_ACCESS_TOKEN`,
`VERCEL_TOKEN` (secretas, gravadas pelo `npm run configurar`) e `FORMINHA_ORG`, `VERCEL_TIME`,
`REPO_LOJA`, `REPO_PAINEL` (não secretas).

**Segurança:** a Central só mexe em projetos da organização `FORMINHA_ORG` com nome no padrão da
Forminha — nunca nos outros projetos da conta. Só lê as chaves **públicas** de cada loja.
