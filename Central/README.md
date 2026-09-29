# Central da Forminha

O seu painel para vender e cuidar das lojas: <https://forminha.vercel.app>.

Cada loja é independente: tem o **próprio banco** no Supabase (organização "Forminha", projeto
com o nome `<código> · <nome da loja>`, ex.: `7XT-Tna-dRe · Doce da Ana`) e **dois sites** na Vercel
(a loja e o painel da dona). Excluir a loja apaga tudo isso junto.

## O painel

Menu lateral com **Visão geral** (faturamento do mês, clientes, lojas no ar, cobranças esperando,
vendas do mês dia a dia ou dos 12 meses, o que precisa de atenção, últimas clientes e atividade),
**Clientes** (filtros por situação e planilha), **Vendas** (Hoje, 7 dias, 30 dias, Este mês, 12 meses,
Por ano ou de um dia até outro: faturamento, vendas e ticket médio comparados com o período anterior,
gráfico por hora/dia/mês/ano e cada venda, com planilha), **Pagamentos** (tudo o que foi cobrado, com
total recebido e pendente), **Lojas**, **Equipe** e **Atividade**. Cada item só aparece para quem pode ver (faturamento e pagamentos: dono, gerente e
financeiro). No topo, o **perfil**: ao clicar, Configurações (dono) ou Trocar minha senha (equipe) e
Sair. No celular, o menu abre pelo botão ☰.

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
cortesia), atualizar o banco, reativar e excluir. Em cada loja pronta:

- **Pagamento online**: cole o Access Token de produção do Mercado Pago da doceria e a Central liga
  o PIX automático e o cartão na loja (a dona também pode fazer isso no painel dela, em
  Configurações → Integrações).
- **Domínio**: liga um endereço próprio, como `suadoceria.com.br`. A Central coloca o domínio, o
  `www` (atalho para o domínio) e, se quiser, `painel.suadoceria.com.br` nos sites da loja, e mostra
  os registros de DNS para criar onde o domínio foi comprado (Registro.br, Hostinger…). Enquanto o DNS
  não fica pronto, a loja continua no endereço da Vercel; quando fica, tudo passa a usar o domínio
  sozinho (links de login e do WhatsApp, o painel e a ficha da cliente). A dona também pode ligar pelo
  painel dela, em **Configurações → Domínio**. O domínio é comprado e pago pela doceria.

## Equipe (aba Equipe — só o dono)

Cada funcionário entra com um **usuário próprio da Forminha**, nunca com e-mail: **FM** + a letra da
função + um número — `FMG` gerente, `FMV` vendedor, `FMS` suporte, `FMF` financeiro (ex.: `FMV-0427`).
Mudar a função troca só a letra; o número fica.

| Função | Pode |
|---|---|
| Gerente | clientes, cobranças, confirmar/cancelar pagamento, suporte e criar loja sem cobrança |
| Vendedor | ver/cadastrar/editar clientes, anotar, gerar e reenviar cobrança |
| Suporte | ver/editar clientes, anotar, lojas: convite, link novo, redefinir senha da dona, retomar, reativar |
| Financeiro | ver clientes, anotar, gerar cobrança, confirmar e cancelar pagamento |
| Dono (você) | tudo, inclusive equipe, configurações e excluir lojas |

Ao cadastrar, aparece **uma vez** a senha temporária (copiar ou WhatsApp); no 1º acesso a pessoa só
consegue criar a própria senha. Senha temporária nova, desativar e excluir derrubam a sessão na hora.
Cada botão só aparece para quem pode, e o servidor confere de novo em toda requisição. O histórico da
cliente diz quem fez (ex.: "Pagamento confirmado manualmente. (FMF-2231 · Carla)") e **Atividade
recente** lista quem entrou e o que fez (sem dados pessoais). Nomes da equipe ficam cifrados.

## Acesso (e-mail ou usuário + senha)

E-mail e senha nascem no `npm run configurar` (senha com 8 caracteres ou mais). Na Central, em
**Configurações**: **Conta de acesso** muda o e-mail e cria um nome de usuário (pede a senha para
confirmar); **Senha de acesso** troca a senha (pede a atual, e quem estiver com a Central aberta em outro
aparelho sai na hora). No banco fica só o resumo da senha (scrypt), nunca a senha. Esqueceu?
`npm run configurar`, opção **7** — vale mais que o que foi mudado pelo painel. Errar 5 vezes seguidas dá
uma pausa crescente, e a mensagem de erro não diz se foi o e-mail ou a senha.

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
**6** trocar só a chave da Vercel · **7** trocar só o e-mail e a senha da Central (serve também para quem esqueceu). E-mail e Mercado Pago podem ser pulados com Enter. A chave de
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
| `EXEMPLO=1 npm run dev` | O mesmo modo de teste, já com 20 clientes e vendas nos últimos meses (para ver os gráficos). |
| `npm run dev` | Central em <http://localhost:3100>, **modo de teste** (nada é criado de verdade; e-mails aparecem no terminal). Entrar com `teste@forminha.local` / `forminha`. |
| `npm test` | Tudo com Supabase, Vercel, Mercado Pago e e-mail simulados e bancos de verdade em memória. |
| `npm run copiar-sql` | Traz as migrações do `Dashboard/supabase` (a fonte da verdade). Depois publique a Central e use **Atualizar banco** nas lojas. |

Variáveis na Vercel — secretas (pelo `npm run configurar`): `CENTRAL_EMAIL`, `CENTRAL_SENHA_HASH`, `SEGREDO_SESSAO`,
`CRON_SECRET`, `CHAVE_CRIPTOGRAFIA`, `SUPABASE_ACCESS_TOKEN`, `VERCEL_TOKEN`, `SMTP_USUARIO`,
`SMTP_SENHA`, `EMAIL_NOME`, `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`; do Neon: `DATABASE_URL`;
não secretas: `FORMINHA_ORG`, `VERCEL_TIME`, `REPO_LOJA`, `REPO_PAINEL`, `SUPABASE_CHAVE_VENCE`,
`VERCEL_CHAVE_VENCE` (datas AAAA-MM-DD gravadas pelo configurar).
