# Central da Forminha

O seu painel para vender e cuidar das lojas: <https://forminha.vercel.app>.

Cada loja é independente: tem o **próprio banco** no Supabase (organização "Forminha", projeto
com o nome `<código> · <nome da loja>`, ex.: `7XT-Tna-dRe · Doce da Ana`) e **dois sites** na Vercel
(a loja e o painel da dona). Excluir a loja apaga tudo isso junto.

## O painel

Menu lateral com **Visão geral** (faturamento do mês, clientes, lojas no ar, cobranças esperando,
**meta do mês** — faturamento e lojas vendidas, com a projeção de onde o mês fecha no ritmo atual; só o
dono define —, vendas do mês dia a dia ou dos 12 meses, o que precisa de atenção, últimas clientes e atividade),
**Clientes** (filtros por situação e planilha; dá para **só registrar o interesse** e enviar a proposta depois),
**Funil** (das clientes que entraram no período: quantas receberam a cobrança, pagaram e estão com a loja no ar, a conversão de cada passo, o tempo até pagar e o resultado de cada pessoa da equipe), **Vendas** (Hoje, 7 dias, 30 dias, Este mês, 12 meses,
Por ano ou de um dia até outro: faturamento, vendas e ticket médio comparados com o período anterior,
gráfico por hora/dia/mês/ano e cada venda, com planilha), **Pagamentos** (tudo o que foi cobrado, com
total recebido e pendente), **Cupons** (só o dono: cupons em % ou R$, com validade e limite de usos; e as regras da
**indicação** — cada cliente que pagou tem um código na ficha: quem usa ganha desconto e, quando paga, quem indicou ganha
crédito para abater nas mensalidades; quem vende aplica o cupom no cadastro e já vê o valor final), **Lojas**, **Equipe** e **Atividade**. Cada item só aparece para quem pode ver (faturamento e pagamentos: dono, gerente e
financeiro). No topo, a **busca rápida** (Ctrl+K ou "/": clientes, lojas, telas e ações, sem acento e pelo teclado), o **sino** (avisos na hora: pagamento recebido, loja pronta, criação parada e, para o
dono, cliente cadastrada pela equipe; também no computador, se você deixar) e o **perfil**: ao clicar,
Configurações (dono) ou Trocar minha senha (equipe) e Sair. No celular, o menu abre pelo botão ☰.

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
  Com o domínio da Forminha ligado (abaixo), a mesma janela mostra também o **endereço na Forminha**
  da loja (trocar o nome ou tirar).

## Domínio da Forminha (Configurações — só o dono)

Com um domínio seu (ex.: `forminha.com.br`, comprado no Registro.br):

1. Em **Configurações → Domínio da Forminha**, digite o domínio e clique em **Ligar domínio**.
2. Onde o domínio foi comprado, crie os 3 registros que a Central mostra: `A @` (a Central),
   `CNAME www` (atalho) e `CNAME *` (o coringa, que manda qualquer `nome.forminha.com.br` para a Vercel).
3. Clique em **Conferir agora** (o DNS pode levar algumas horas).

Quando a raiz funciona, a Central abre em `forminha.com.br` e os links novos (pagamento, e-mails)
passam a usar esse endereço — os antigos, em `forminha.vercel.app`, continuam valendo. Quando o coringa
fica pronto, cada loja nova já nasce com `nomedaloja.forminha.com.br` (e o painel em
`nomedaloja-painel.forminha.com.br`); para as lojas que já existiam, use **Dar endereço às lojas antigas**.
O domínio próprio da doceria, quando ligado, vale mais que o endereço na Forminha. Com `URL_CENTRAL`
definida na Vercel, a Central continua usando ela nos links.

## Mensalidade (assinatura)

Em **Configurações → Mensalidade**: valor por mês (0 = sem mensalidade), em quantos dias vence a primeira (contando da
loja pronta), quantos dias antes a cobrança sai e depois de quantos dias de atraso a loja é suspensa. Todo dia a Central:

1. cobra a mensalidade alguns dias antes do vencimento (PIX + página de pagamento + e-mail), já abatendo o **crédito de
   indicação** (se o crédito cobrir tudo, a mensalidade conta como paga);
2. um dia depois do vencimento, manda um lembrete;
3. passada a carência, **suspende** a loja: o site continua no ar, mas deixa de receber pedidos (aparece como pausado, com
   um recado para chamar no WhatsApp); o painel da dona continua funcionando e mostra o aviso com **Pagar agora**;
4. pagou (sozinho, pelo Mercado Pago, ou em *Mensalidade recebida* na ficha): a loja volta na hora e o vencimento avança 1 mês.

Na ficha de cada cliente (seção **Mensalidade**): valor próprio, mudar o vencimento, isentar (cortesia), cobrar agora,
suspender e reativar à mão, e o histórico das mensalidades. A Visão geral mostra quanto entra por mês.

## Termos, privacidade e nota fiscal

- **Termos de uso** e **Política de privacidade** da Forminha ficam públicos em `#/termos` e `#/privacidade` (links na
  tela de entrar e na página de pagamento, que avisa: “ao pagar, você concorda…”). O nome, o CPF/CNPJ, o e-mail e a cidade
  vêm de **Configurações → Empresa**. Quando a cliente paga a loja, a ficha guarda a versão dos termos aceitos. O texto é
  um modelo completo (LGPD, mensalidade, suspensão, cancelamento); vale a revisão de um advogado.
- **Nota fiscal**: emita no sistema da prefeitura (ou pelo contador) e registre o número e o link em **Pagamentos**
  (filtro *Sem nota fiscal*). A Visão geral avisa quantos pagamentos ainda estão sem nota.

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

## Segurança do acesso

- **Tentativas**: 5 senhas (ou códigos) erradas bloqueiam por 1 minuto, depois 2, 4, 8… até 15. O bloqueio fica no
  banco, então vale em todas as cópias da Central na Vercel, por endereço e por conta.
- **Verificação em duas etapas** (perfil → *Segurança da conta*): além da senha, o código de 6 números do aplicativo de
  autenticação (Google Authenticator, Microsoft Authenticator, Authy). Ao ligar, saem 8 códigos de reserva de uso único.
  Cada pessoa da equipe liga a sua; se alguém perder o celular, o dono desliga na tela Equipe (selo “2 etapas”).
- **Esqueci a senha** (dono): link por e-mail, vale 30 minutos e uma vez só; derruba as sessões abertas. Sem e-mail
  configurado, o caminho continua sendo `npm run configurar` (opção 7), que também desliga as duas etapas do dono.
- **Alertas**: erro inesperado, serviço fora do ar ou chave recusada viram aviso no sino do dono e e-mail (erros iguais
  são juntados: um aviso a cada 30 minutos e no máximo um e-mail a cada 6 horas).
- **Cópias de segurança**: Configurações → *Baixar cópia da Central* (dados pessoais continuam criptografados: guarde junto
  com a `CHAVE_CRIPTOGRAFIA`) e Lojas → *Cópia* (os dados de cada loja). A Central lembra toda semana.
- **Testes automáticos**: a cada envio ao GitHub, os testes do painel/loja e da Central rodam sozinhos (aba *Actions*).

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
**6** trocar só a chave da Vercel · **7** trocar só o e-mail e a senha da Central (serve também para quem esqueceu) ·
**8** e-mail profissional (Resend, com o seu domínio). E-mail e Mercado Pago podem ser pulados com Enter. A chave de
criptografia é criada sozinha **uma vez** (guarde a cópia que aparece na tela). Nada do que você digita
aparece na tela nem fica no computador.

**E-mail profissional:** com um domínio seu, os e-mails saem de um endereço como `contato@forminha.com.br`
pelo [Resend](https://resend.com) (plano grátis: 100 por dia). Crie a conta, adicione o domínio, copie os
registros de DNS que ele mostra, crie uma chave de API e rode a opção **8**. As respostas das clientes vão
para o e-mail que você informar. Com o Gmail também ligado, ele vira reserva: se o Resend falhar, o e-mail
sai pelo Gmail.

**Chaves com prazo:** a chave do Supabase vence (não existe "nunca"). Ao colar, informe a validade em
dias: a Central mostra um aviso no topo do painel 15 dias antes e manda e-mail para você 15 dias
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
`SMTP_SENHA`, `EMAIL_NOME`, `RESEND_API_KEY`, `EMAIL_REMETENTE`, `EMAIL_RESPONDER`, `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`; do Neon: `DATABASE_URL`;
não secretas: `FORMINHA_ORG`, `VERCEL_TIME`, `REPO_LOJA`, `REPO_PAINEL`, `SUPABASE_CHAVE_VENCE`,
`VERCEL_CHAVE_VENCE` (datas AAAA-MM-DD gravadas pelo configurar).
