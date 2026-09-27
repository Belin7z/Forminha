# Publicar o site (Supabase + Vercel)

> **Com a Central, tudo isto é automático:** em [forminha.vercel.app](https://forminha.vercel.app), **Nova loja** cria o banco,
> aplica as tabelas, publica os dois sites e gera o convite da dona (veja `Central/README.md`). Este guia é o **caminho
> manual** — para entender o que a Central faz por baixo ou montar uma loja fora dela.

Você vai colocar **dois sites separados** no ar, ligados ao **mesmo banco**:

```
   Clientes ──►  LOJA       (Vercel, pasta Loja/)       ──┐
                                                         ├──►  SUPABASE  (banco + login + fotos)
   Você     ──►  DASHBOARD  (Vercel, pasta Dashboard/)  ──┘
```

Não existe servidor próprio para cuidar: o banco, o login dos clientes e as fotos ficam no Supabase, e os dois sites são
arquivos estáticos na Vercel. Tempo estimado: 30 a 40 minutos na primeira vez.

> Os nomes dos menus do Supabase e da Vercel mudam de vez em quando. Se algo estiver com outro nome, procure pelo
> equivalente — a ideia é a mesma.

**Você vai precisar de contas gratuitas em:** [GitHub](https://github.com), [Supabase](https://supabase.com) e
[Vercel](https://vercel.com).

---

## Parte 1 — Supabase (banco, login e fotos)

### 1.1 Criar o projeto
1. No Supabase: **New project**. Escolha a região **South America (São Paulo)** e anote a senha do banco (guarde num lugar seguro).
2. Espere uns 2 minutos até o projeto ficar pronto.

### 1.2 Criar as tabelas, as regras de segurança e as configurações iniciais
1. No VS Code, no terminal **dentro da pasta `Dashboard`**: `npm install` (só na primeira vez) e depois `npm run sql`. Isso cria o arquivo `Dashboard/supabase/instalar-tudo.sql`.
2. No Supabase abra **SQL Editor → New query**, cole **todo** o conteúdo desse arquivo e clique em **Run**.
3. Deve terminar com *Success*. Confira: em **Table Editor** aparecem as tabelas (`produtos`, `pedidos`…) e em **Storage** existe o bucket `produtos`.

> Rode isso **uma única vez**, num projeto novo. Rodar de novo dá erro de “já existe” (não estraga nada).

### 1.3 Ajustar o login (Authentication)
- **Sign In / Providers → Email:**
  - **Minimum password length: 8** (o site também exige letras e números).
  - **Confirm email:** ligado é o mais seguro (o cliente confirma o e-mail antes de entrar). Desligado, a conta já nasce pronta. O site funciona nos dois modos.
- **URL Configuration** (faça depois da Parte 3, quando tiver os endereços):
  - **Site URL:** o endereço da **loja** (ex.: `https://zq-loja.vercel.app`).
  - **Redirect URLs:** adicione `https://zq-loja.vercel.app/**` e, para testar no computador, `http://localhost:3000/**`.
    (É para onde o link do e-mail “esqueci minha senha” e “confirmar e-mail” volta.)

### 1.4 E-mails (importante!)
O envio de e-mails que vem de fábrica no Supabase é **só para testes** (poucos por hora e só para os e-mails da sua equipe).
Para os clientes receberem “esqueci minha senha” e “confirmar e-mail” você precisa de um **SMTP próprio**:

1. Crie uma conta num serviço de e-mail (por exemplo Resend, Brevo ou Mailgun) e valide seu domínio.
2. No Supabase: **Authentication → SMTP Settings → Enable custom SMTP** e preencha com os dados do serviço.
3. Em **Authentication → Email Templates** traduza as mensagens para português, se quiser.

Sem SMTP o site funciona, mas nenhum e-mail chega ao cliente.

### 1.5 Copiar as chaves
Em **Project Settings → API** copie:
- **Project URL** → será o `SUPABASE_URL`
- **anon / public key** (ou *publishable key*) → será o `SUPABASE_ANON_KEY`

> ⚠️ **Nunca** use a chave `service_role` (ou *secret*). Ela dá acesso total ao banco. O projeto recusa publicar com ela.

### 1.6 Criar o primeiro administrador
1. **Authentication → Users → Add user → Create new user:** e-mail e senha da administradora da loja, marcando **Auto Confirm User**.
2. **SQL Editor**, rode (trocando o e-mail e o nome):
   ```sql
   update public.perfis
      set papel = 'admin', nome = 'Nome da administradora'
    where email = 'email-da-administradora@exemplo.com';
   ```
3. Confira com `select email, papel from public.perfis;` — deve aparecer `admin`.

Os outros administradores (equipe) você adiciona depois pelo próprio Dashboard, em **Equipe** — a pessoa cria uma conta na loja e você libera.
Ninguém consegue se tornar administrador pelo site: o papel só muda pelo SQL ou por outro administrador.

---

## Parte 2 — GitHub (um repositório só)

A Vercel publica a partir do GitHub. O código inteiro fica **num repositório só** (`Forminha`), com uma pasta para cada parte:

| Pasta | O que vai para o ar |
|---|---|
| `Loja` | o site dos clientes (um projeto na Vercel por loja) |
| `Dashboard` | o painel da dona (um projeto na Vercel por loja); leva junto o banco, os guias e as ferramentas de teste |
| `Central` | a Central da Forminha (um projeto só) |

**Antes de enviar:** rode `npm test` (na pasta `Dashboard`) — confere que os dois sites montam sozinhos. Os arquivos `.env`
**não sobem**: estão no `.gitignore`. Nenhuma chave de administração fica no código.

### Como escrever as mensagens de commit

Sempre começando com um verbo no gerúndio, dizendo o que mudou:

- `Adicionando filtro por categoria no cardápio`
- `Removendo botão duplicado do carrinho`
- `Atualizando cores dos botões`

### Rodar os dois sites juntos no computador

O `npm run dev` (na pasta `Dashboard`) liga a Loja e o Dashboard ao mesmo tempo. Ele espera as pastas **lado a lado**,
como já vêm no repositório:

```
Forminha/
├─ Loja/
├─ Dashboard/
└─ Central/
```

---

## Parte 3 — Vercel (dois projetos, do mesmo repositório)

Repita os passos **duas vezes**: uma para a **Loja** e outra para o **Dashboard**.

1. Na Vercel: **Add New → Project** e importe o repositório **Forminha**.
2. **Root Directory:** `Loja` (na segunda vez, `Dashboard`).
3. **Framework Preset:** *Other*. Deixe *Build Command* e *Output Directory* como estão — já vêm do `vercel.json` de cada pasta.
4. **Environment Variables** (as mesmas duas nos dois projetos):

   | Nome | Valor |
   |---|---|
   | `SUPABASE_URL` | Project URL do Supabase |
   | `SUPABASE_ANON_KEY` | chave *anon/public* |
   | `URL_LOJA` *(só no Dashboard)* | endereço da loja, ex.: `https://zq-loja.vercel.app` |

5. **Deploy.** Ao terminar, a Vercel mostra o endereço do site.

Depois de ter os dois endereços, volte ao Supabase e preencha **Authentication → URL Configuration** (item 1.3).

**Domínio próprio (opcional):** em **Settings → Domains** de cada projeto. Sugestão: a loja em `www.seudominio.com.br` e o Dashboard
num endereço discreto (ex.: `gestao.seudominio.com.br`).

> Se você mudar uma variável de ambiente, faça **Redeploy** — o `config.js` é gerado na hora do build.

---

## Parte 4 — Conferir se está tudo funcionando

- [ ] A loja abre e mostra “Estamos preparando o cardápio” (o cardápio começa vazio).
- [ ] Criar uma conta de cliente (se “Confirm email” estiver ligado, o e-mail de confirmação chega).
- [ ] “Esqueci minha senha” envia o e-mail e o link abre a tela de nova senha.
- [ ] Salvar um endereço com CEP e marcar o ponto no mapa; o frete aparece.
- [ ] Fazer um pedido de teste (retirada ou entrega).
- [ ] O Dashboard abre **só** com a conta do administrador; a conta de cliente é recusada.
- [ ] O pedido aparece no Dashboard; mudar o status e ver a mudança na página do pedido do cliente.
- [ ] Cadastrar um produto **com foto** no Dashboard e ver na loja.
- [ ] Configurações → Pagamento: cadastrar a chave PIX e ver o “copia e cola” num pedido.

Se algo falhar, veja **Problemas comuns** abaixo.

---

## Parte 5 — Configurar a loja
Entre no Dashboard e siga “Primeiros passos” do [GUIA.md](GUIA.md): dados da loja, horários, PIX, faixas de entrega, produtos e cupons.
O cardápio começa **vazio**: cadastre primeiro as categorias e depois os produtos, com foto, descrição e preço.

---

## Segurança — como o projeto se protege

- Nenhuma tabela pode ser lida ou escrita diretamente pelo navegador. Tudo passa por **funções do banco** que conferem quem está
  chamando (visitante, cliente ou administrador) e recalculam **preços, frete, cupom e horários no servidor**.
- O cliente só vê os próprios pedidos e endereços. Bloquear um cliente no Dashboard vale na hora.
- As fotos ficam num bucket público para **leitura**, mas só administradores conseguem enviar ou apagar.
- Os sites usam cabeçalhos de segurança (CSP restritiva, HSTS, anti-clickjacking, isolamento de origem, permissões do navegador desligadas)
  definidos em `Loja/vercel.json` e `Dashboard/vercel.json`. O Dashboard também pede aos buscadores para **não indexar** a página.
- **Contra flood e robôs — em camadas:**
  1. **Vercel (firewall):** cada site tem uma regra de limite de **600 requisições por minuto por IP** (uso normal fica bem abaixo; excedeu, o IP fica
     bloqueado por 5 minutos) e uma regra que bloqueia varreduras de endereços típicos de invasão (`.env`, `.git`, `wp-admin`, phpMyAdmin…). A proteção
     automática contra DDoS da Vercel já vem ligada. Veja/edite em *Vercel → projeto → Firewall*.
  2. **Banco de dados (migração `…0014_protecao`):** cada função pública tem um **limite por minuto** — por IP para visitantes (vitrine: 300/min) e por
     conta para clientes (orçamento 30/min, pedido 12/min, endereços, favoritos…), com resposta *429 “Muitas solicitações…”*. Pedidos gigantes (mais de
     256 KB) são recusados, cada cliente pode ter no máximo **15 pedidos em aberto**, exportações têm limite e toda consulta tem **tempo máximo**
     (visitante 3 s, logado 8 s). Os contadores ficam na tabela `limites` (limpa sozinha).
  3. **No navegador:** as leituras repetem com pausa se a rede falhar, chamadas iguais simultâneas viram uma, e depois de um 429 o site espera 5 s em vez
     de insistir; o cadastro tem uma **armadilha para robôs** (campo escondido e tempo mínimo de preenchimento); o Dashboard segura tentativas de login
     seguidas e **desconecta depois de 2 horas sem uso**.
  Observação técnica: uma chamada que termina em erro desfaz também a própria contagem; por isso o limite pega quem repete chamadas que dão certo
  (as caras). Erros de validação são baratos de processar.
- Boas práticas: ligue a **verificação em duas etapas** no GitHub, Vercel e Supabase; nunca compartilhe a `service_role`;
  troque a senha do administrador se suspeitar de vazamento.

**Atenção ao criar novas tabelas/funções no futuro:** ligue o RLS (`alter table ... enable row level security`) e libere execução
só do que o navegador precisa, como faz `Dashboard/supabase/migrations/20260921000008_permissoes.sql`.

## Backup e continuidade

- **Projetos gratuitos do Supabase podem ser pausados** depois de um tempo sem uso, e o site sai do ar até você reativar.
  Para uma loja de verdade, avalie um plano pago (que também inclui backups automáticos).
- Mesmo assim, faça cópias periódicas do banco (Supabase → **Database → Backups**, ou o comando `supabase db dump`) e das fotos.
- A Vercel no plano gratuito (*Hobby*) é para uso **não comercial**. Como este é um site de um negócio, verifique os termos e, se preciso,
  use o plano Pro.

## Atualizar o site depois

- **Mudou código/visual:** dentro da pasta do site, `git add .`, `git commit -m "Atualizando ..."` e `git push` — a Vercel publica sozinha.
  (Mensagens sempre no formato *Adicionando…*, *Removendo…* ou *Atualizando…*.)
- **Mudou o banco:** crie um arquivo novo em `Dashboard/supabase/migrations/` (ex.: `20261001000001_minha_mudanca.sql`) e rode-o no SQL Editor.
  Nunca edite as migrações antigas em projeto que já está no ar.
- **Projeto já no ar e chegou uma versão nova do sistema:** rode, **em ordem**, só as migrações que ainda não rodou (o número no nome mostra a ordem;
  por exemplo, quem parou na `…0008` roda `…0009` até `…0019`). Se a versão nova trouxe **funções do servidor** (`Dashboard/supabase/functions/`), publique-as também:
  os comandos estão em [INTEGRACOES.md](INTEGRACOES.md), Parte 4. Cada arquivo é colado inteiro no SQL Editor do Supabase e executado uma vez.
  Depois publique os dois sites (`git push` em cada um) — o banco novo continua funcionando com o site antigo, então a ordem não derruba a loja.
  As fotos do site (logo, destaque, galeria) usam o bucket `site`, criado pela migração `…0009`.

## Problemas comuns

| Sintoma | O que fazer |
|---|---|
| O build falha com “Falta configurar SUPABASE_URL…” | Cadastre as variáveis na Vercel e faça *Redeploy*. |
| O build diz que a chave é a SECRETA | Você colou a `service_role`. Use a chave **anon/public**. |
| Tela de erro “Não foi possível carregar…” na loja | URL/chave erradas, ou o SQL não foi rodado. Confira a Parte 1.2 e as variáveis. |
| “Muitas solicitações em pouco tempo” | O limite por minuto foi atingido (ou alguém está repetindo chamadas). Espere um minuto. Se acontecer com frequência para um cliente real, avise: dá para ajustar os limites em `…0014_protecao.sql`. |
| “Esqueci minha senha” não chega | SMTP próprio não configurado (1.4), ou o endereço não está em *Redirect URLs* (1.3). |
| Link do e-mail leva a “link vencido” | O link vale pouco tempo e só abre uma vez. Peça outro. |
| Cliente entra no Dashboard e vê “restrito à equipe” | Correto. Só contas com papel `admin` ou `atendente` entram. |
| A atendente vê poucas telas | Correto: ela só usa Pedidos, Novo pedido, Agenda e Produção. Para mais acesso, mude o papel em *Equipe*. |
| “Este dia está lotado/fechado” na loja | Vem da *Agenda* (limite por dia e datas bloqueadas). Altere lá. |
| Foto do produto não sobe | Precisa ser PNG/JPG/WEBP de até 4 MB e você precisa estar logado como administrador. |
| Mapa/CEP não carregam | Precisam de internet e dos serviços OpenStreetMap/ViaCEP (gratuitos). |

---

## O que **não** está incluído (para combinar com o cliente)

- **Cartão online.** Não existe pagamento com cartão no site; dinheiro e cartão são pagos na entrega/retirada. O **PIX automático** (Mercado Pago) já vem pronto,
  mas precisa da sua conta: veja [INTEGRACOES.md](INTEGRACOES.md).
- **Aviso por e-mail.** Não existe. O **aviso automático por WhatsApp** (oficial da Meta) já vem pronto, mas precisa da sua conta e de modelos aprovados: veja
  [INTEGRACOES.md](INTEGRACOES.md). Sem ele, o cliente acompanha na página do pedido e o Dashboard abre o WhatsApp com a mensagem pronta.
- Uma única loja (um único cardápio e endereço de retirada).

### Depende de você (não dá para fazer por código)

- **E-mail próprio (SMTP):** o e-mail padrão do Supabase tem limite baixo de envios. Para a loja de verdade, configure um SMTP (Resend, Brevo…) em
  *Authentication → Emails* (Parte 1.4).
- **Ajustes de login no Supabase (recomendado):** o login é do Supabase Auth e o site não consegue alterar essas configurações sozinho. Em
  *Supabase → Authentication*:
  - *URL Configuration* → **Site URL** = endereço da loja (`https://doce-da-ana.vercel.app` ou o domínio próprio) e, em **Redirect URLs**,
    a loja e o Dashboard com `/**` no final (mais `http://localhost:3000/**` e `http://localhost:3001/**` se testar no computador). Sem isso, o link de
    “esqueci minha senha” pode apontar para o lugar errado.
  - *Sign In / Providers → Email* → **tamanho mínimo da senha 8** e exigir **letras e números** (é o que o site já cobra); mantenha *Confirm email* ligado.
  - *Rate Limits* → reduza “sign-ups and sign-ins” (por 5 min e por IP) de 30 para cerca de **20**.
- **Domínio próprio** (ex.: `docedaana.com.br`): compre o domínio e ligue-o em *Vercel → Domains* (um para a loja e outro para o Dashboard).
  Depois ajuste as URLs do item acima e a variável `URL_SITE` da loja (usada no sitemap).
- **Fotos e logo reais:** envie em *Configurações → Imagens* e nos produtos. As ilustrações servem só até lá.
- **Textos legais:** revise a política de privacidade e os termos com um advogado (*Configurações → Textos legais*).
- **PIX automático e avisos por WhatsApp:** dependem de contas suas (Mercado Pago e Meta), de chaves cadastradas nos *Secrets* do Supabase e, no WhatsApp,
  de modelos aprovados pela Meta. O guia passo a passo é o [INTEGRACOES.md](INTEGRACOES.md). Cartão online ainda não existe.
- **Proteção contra robôs (CAPTCHA) no cadastro:** **ainda não ligue** o CAPTCHA do Supabase (*Attack Protection*): o site ainda não envia o código de
  verificação, então cadastro e login deixariam de funcionar. Se aparecerem cadastros falsos, avise para o site ganhar o CAPTCHA antes de ligar.
- **Verificação em duas etapas (2FA) do administrador:** o Supabase já a oferece (aplicativo autenticador). É a defesa mais forte contra invasão da conta da
  gestão; o site ainda não tem a tela para cadastrá-la. Enquanto isso, use senha longa e única e ligue a verificação em duas etapas no GitHub, Vercel e Supabase.
- **Termos dos serviços:** o plano gratuito da Vercel (*Hobby*) é para uso não comercial e o Supabase gratuito pausa projetos parados; para vender de verdade, avalie planos pagos.
- **Testes automáticos no GitHub (Actions):** o token usado na configuração não tinha permissão para criar workflows; se quiser, crie `.github/workflows`
  pelo próprio site do GitHub com o comando `npm test`.

## Como isto foi testado (e o que só dá para conferir no seu Supabase)

- **Testes automáticos** (`npm test`) rodam o banco (Postgres de verdade, com as mesmas migrações), a biblioteca oficial `supabase-js`
  e as mesmas chamadas que a loja e o Dashboard usam: cadastro, endereços, pedidos, atendimento no Dashboard, status, avaliações, cupons, fotos, permissões e
  bloqueios.
- **Roteiros de navegador** (Edge automatizado) percorreram a loja e o Dashboard do começo ao fim, incluindo mapa, PIX, foto, recuperação de senha
  e o build de publicação (`Loja/dist`, `Dashboard/dist`).
- O Supabase real não foi acessado nesses testes (usa-se um simulador local do protocolo). Por isso, no **primeiro deploy**, faça o checklist da
  Parte 4 — principalmente e-mails, upload de fotos e login — antes de divulgar o endereço.
