# Central da Forminha

O seu painel para vender e cuidar das lojas: <https://forminha.vercel.app>.

Cada loja é independente: tem o **próprio banco** no Supabase (organização "Forminha", projeto
com o nome `<código> · <nome da loja>`, ex.: `7XT-Tna-dRe · Doce da Ana`) e **dois sites** na Vercel
(a loja e o painel da dona). Excluir a loja apaga tudo isso junto.

## Vender uma loja

1. **Clientes → Nova cliente**: nome, e-mail, WhatsApp, CPF/CNPJ (opcional), nome da loja e valor.
2. A Central gera a **página de pagamento** (PIX com QR Code) e manda o link por e-mail; você também
   pode mandar pelo WhatsApp.
3. Quando o PIX cai:
   - com o **Mercado Pago** ligado, a confirmação é sozinha;
   - sem ele, abra a cliente e clique em **Pagamento recebido**.
4. A loja é **criada sozinha** (uns 3 a 6 minutos): banco, tabelas, loja, painel e convite. A cliente
   recebe o link de acesso por e-mail, e o mesmo link aparece na ficha dela para você.

Na ficha de cada cliente: pagamento, andamento da loja, link de acesso (copiar, WhatsApp, reenviar,
link novo), **Redefinir senha da dona** (link por e-mail, que vale pouco tempo), edição dos dados,
**notas** e o histórico de tudo o que aconteceu.

A aba **Lojas** mostra todas as lojas e serve para criar uma loja **sem cobrança** (teste ou
cortesia), atualizar o banco, reativar e excluir.

## Segurança dos dados

- **Dados pessoais cifrados** (AES-256-GCM): nome, e-mail, WhatsApp, CPF/CNPJ, observações, notas,
  histórico e os links de acesso. No banco só ficam textos embaralhados; quem copiar o banco inteiro
  não lê nada sem a `CHAVE_CRIPTOGRAFIA`, que fica só nas variáveis secretas da Vercel.
- O e-mail é encontrado por um **índice cego** (HMAC): dá para evitar cadastro repetido sem guardar
  o e-mail aberto.
- A página de pagamento é pública só pelo link (impossível de adivinhar) e não mostra dados pessoais.
- Aviso do Mercado Pago: a assinatura é conferida e o pagamento é **consultado de novo** na API dele
  antes de valer; aviso repetido não conta duas vezes.
- A Central só mexe em projetos da organização Forminha com nome no padrão — nunca nos outros da conta.
  A chave administrativa de uma loja só é lida na hora de gerar um link de redefinir senha e não é
  guardada nem mostrada.

## Configurar (no seu terminal, na pasta `Central`)

```
npm run configurar
```

Menu: **1** senha da Central + chaves do Supabase e da Vercel · **2** e-mail (Gmail com
"senha de app") · **3** PIX automático (Mercado Pago) · **4** tudo · **5** trocar só a chave do Supabase ·
**6** trocar só a chave da Vercel. E-mail e Mercado Pago podem ser pulados com Enter. A chave de
criptografia é criada sozinha **uma vez** (guarde a cópia que aparece na tela). Nada do que você digita
aparece na tela nem fica no computador.

**Chaves com prazo:** a chave do Supabase vence (não existe "nunca"). Ao colar, informe a validade em
dias: a Central mostra um aviso no topo do painel 15 dias antes e manda e-mail para o seu Gmail 15 dias
antes e todo dia na última semana. Para renovar, crie uma chave nova (Organization → Forminha, acesso
total) e rode `npm run configurar`, opção **5**. Se a chave for recusada, a Central diz isso na tela.

O **banco da Central** é ligado na Vercel: projeto `forminha` → **Storage → Create Database → Neon**
→ conectar ao projeto (grátis). Depois, publique de novo.

## Para quem mexe no código

| Comando | O que faz |
|---|---|
| `npm run dev` | Central em <http://localhost:3100>, **modo de teste** (nada é criado de verdade; e-mails aparecem no terminal). Senha `forminha`. |
| `npm test` | Tudo com Supabase, Vercel, Mercado Pago e e-mail simulados e bancos de verdade em memória. |
| `npm run copiar-sql` | Traz as migrações do `Dashboard/supabase` (a fonte da verdade). Depois publique a Central e use **Atualizar banco** nas lojas. |

Variáveis na Vercel — secretas (pelo `npm run configurar`): `CENTRAL_SENHA_HASH`, `SEGREDO_SESSAO`,
`CRON_SECRET`, `CHAVE_CRIPTOGRAFIA`, `SUPABASE_ACCESS_TOKEN`, `VERCEL_TOKEN`, `SMTP_USUARIO`,
`SMTP_SENHA`, `EMAIL_NOME`, `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`; do Neon: `DATABASE_URL`;
não secretas: `FORMINHA_ORG`, `VERCEL_TIME`, `REPO_LOJA`, `REPO_PAINEL`, `SUPABASE_CHAVE_VENCE`,
`VERCEL_CHAVE_VENCE` (datas AAAA-MM-DD gravadas pelo configurar).
