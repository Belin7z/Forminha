# Integrações: PIX automático e avisos por WhatsApp

Este guia explica, **clique por clique**, como ligar duas coisas que o sistema já traz prontas, mas que só funcionam depois de você criar
contas em serviços de terceiros:

| O quê | Para que serve | Serviço | Tempo estimado |
|---|---|---|---|
| **PIX automático** | O cliente paga lendo um QR Code e o pedido muda para “pago” **sozinho**, sem você olhar o extrato. | Mercado Pago | 30 a 60 min |
| **Avisos por WhatsApp** | O cliente recebe uma mensagem quando o pedido é confirmado, fica pronto ou sai para entrega. | Meta (WhatsApp Business oficial) | 1 a 3 dias (aprovação da Meta) |

> **Importante — sobre as suas chaves.** Nenhuma chave dessas contas é colada no site, no Dashboard, no GitHub ou em conversa. Elas ficam
> só nos **Secrets** do Supabase (uma “gaveta” trancada que só as funções do servidor abrem). Se algum dia uma chave vazar, gere outra no
> serviço e troque o Secret: o resto continua funcionando.
>
> **Custos e regras mudam.** As taxas do Mercado Pago e da Meta, e os nomes dos menus, são deles e mudam de tempos em tempos. Confira sempre
> nos sites oficiais antes de decidir. Aqui não há valores fixos de propósito.

Enquanto nada disso estiver configurado, **o site funciona normalmente**: o PIX segue com a chave da loja (você confere) e o WhatsApp segue com o botão
que abre a conversa com a mensagem pronta.

---

## Como as peças se falam (para entender, não precisa decorar)

```
Cliente paga o PIX ──► Mercado Pago ──► função "pix-webhook" (Supabase) ──► banco marca o pedido como pago
Cliente abre o pedido ──► função "pix-criar" (Supabase) ──► Mercado Pago devolve o QR Code
Você muda o status do pedido ──► função "whatsapp-avisar" (Supabase) ──► WhatsApp do cliente
```

- As três **funções** já estão prontas no projeto (`Dashboard/supabase/functions/`).
- O **valor** do PIX nunca vem da tela: é lido do pedido, no banco.
- O aviso de pagamento do Mercado Pago **não é aceito “de boca”**: a função confere o pagamento direto no Mercado Pago antes de registrar.
- Cada pagamento só é registrado **uma vez**, mesmo que o Mercado Pago avise várias vezes, e nunca passa do total do pedido.

---

# Parte 1 — Endereços e Secrets no Supabase (vale para as duas integrações)

Você vai precisar de dois endereços do seu projeto:

- **Endereço das funções:** `https://SEU-PROJETO.supabase.co/functions/v1/` (é o do seu projeto Supabase).
- **Endereços dos sites:** a Loja (`https://doce-da-ana.vercel.app`) e o Dashboard (`https://doce-da-ana-painel.vercel.app`),
  ou os domínios próprios, quando tiver.

### Como cadastrar um Secret

1. Entre em **supabase.com** → seu projeto.
2. No menu da esquerda, **Edge Functions**.
3. Abra a aba/botão **Secrets** (ou *Manage secrets*).
4. Clique em **Add new secret**, escreva o **nome** (exatamente como neste guia, em maiúsculas) e cole o **valor**. Salve.
5. Se trocar um valor depois, o Supabase pode levar alguns segundos para passar a usar o novo.

### Secret que vale para as duas integrações

| Nome | Valor | Para que serve |
|---|---|---|
| `ORIGENS_PERMITIDAS` | Os dois endereços dos sites, separados por vírgula, sem barra no final. Ex.: `https://doce-da-ana.vercel.app,https://doce-da-ana-painel.vercel.app` | Só a sua loja e o seu Dashboard conseguem chamar as funções pelo navegador. |

---

# Parte 2 — PIX automático (Mercado Pago)

### 2.1 Criar e preparar a conta
1. Acesse **mercadopago.com.br** e crie a conta (use os dados do CPF ou CNPJ de quem vai receber).
2. Conclua a **validação de identidade** que o Mercado Pago pedir.
3. Na conta, cadastre uma **chave PIX** (é por ela que o dinheiro entra). Sem isso, o Mercado Pago não gera PIX.

### 2.2 Criar a aplicação e pegar o Access Token
1. Acesse **mercadopago.com.br/developers** e entre com a mesma conta.
2. **Suas integrações** → **Criar aplicação**.
3. Nome: o nome da sua loja (ex.: `Doce da Ana`). Em “tipo de solução”, escolha a opção de **pagamentos online / API de pagamentos** (o nome exato muda; o que importa é poder criar pagamentos por PIX).
4. Depois de criada, abra a aplicação → **Credenciais**.
5. Você verá dois conjuntos:
   - **Credenciais de teste** (o Access Token começa com `TEST-`): para experimentar sem dinheiro de verdade.
   - **Credenciais de produção** (o Access Token começa com `APP_USR-`): para receber de verdade.
6. Comece pelo **teste**. Copie o **Access Token** (não é a “Public Key”).

### 2.3 Cadastrar os Secrets
No Supabase (Parte 1), cadastre:

| Nome | Valor |
|---|---|
| `MP_ACCESS_TOKEN` | O Access Token do passo anterior. |
| `SEGREDO_GATEWAY` | A **chave de integração** gerada no Dashboard (passo 2.5). |
| `MP_WEBHOOK_SECRET` | A “assinatura secreta” do webhook (passo 2.4). Recomendado: garante que o aviso veio mesmo do Mercado Pago. |

### 2.4 Configurar o aviso de pagamento (webhook)
1. No Mercado Pago → sua aplicação → **Webhooks** → **Configurar notificações**.
2. Em **URL de produção** (e na de teste, se pedir), cole o endereço mostrado no Dashboard, em **Configurações → Integrações → PIX automático**.
   Ele termina em `/functions/v1/pix-webhook`.
3. Marque o evento **Pagamentos** (*Payments*). Salve.
4. Copie a **assinatura secreta** que o Mercado Pago mostra e cadastre como `MP_WEBHOOK_SECRET` (2.3).

### 2.5 Gerar a chave de integração e ligar
1. No **Dashboard → Configurações → Integrações**, clique **Gerar chave de integração**.
2. **Copie a chave na hora** (ela aparece uma única vez) e cadastre no Supabase como `SEGREDO_GATEWAY` (2.3).
   O sistema guarda só uma “impressão digital” dela, não a chave.
3. Volte à tela e **ligue** o “PIX automático”.
4. Mantenha também a **chave PIX da loja** em *Configurações → Pagamento*: ela é a alternativa se o Mercado Pago sair do ar.

### 2.6 Testar
1. Crie um produto de teste barato (ex.: R$ 1,00) e faça um pedido escolhendo PIX.
2. Na página do pedido, clique **Gerar QR Code do PIX**.
3. Pague com o que o Mercado Pago indicar para testes (na documentação de testes eles oferecem contas/cartões de teste). Em produção, pague com o app do seu banco.
4. Em poucos segundos a página do cliente mostra **“Pagamento confirmado”** e, no Dashboard, o pedido aparece como **Pago**, com a forma “PIX (automático)”.

### 2.7 Passar para o valendo
1. No Mercado Pago, pegue o **Access Token de produção** (`APP_USR-…`) e atualize o Secret `MP_ACCESS_TOKEN`.
2. Confira que o webhook de **produção** aponta para o mesmo endereço.
3. Faça um pedido real de valor baixo e confira. Depois pode apagar/desativar o produto de teste.

### Se algo der errado (PIX)
| O que aparece | O que fazer |
|---|---|
| “O PIX automático ainda não foi configurado.” | Falta o Secret `MP_ACCESS_TOKEN`. |
| “O PIX automático está desligado.” | Ligue em *Configurações → Integrações*. |
| Botão “Gerar QR Code” dá erro de conexão | Confira o Secret `ORIGENS_PERMITIDAS` (os endereços dos sites, sem barra no final) e se a função `pix-criar` está publicada. |
| O cliente paga e o pedido não muda | Confira o webhook no Mercado Pago (endereço e evento *Pagamentos*) e os Secrets `SEGREDO_GATEWAY` e `MP_WEBHOOK_SECRET`. Gerou uma chave nova? Atualize o Secret **e religue** o recurso. |
| “Não foi possível gerar o PIX agora.” | O Mercado Pago recusou. Veja se a conta tem chave PIX e se o Access Token é o certo (teste ou produção). |

**Devolução (estorno):** pagamento confirmado pelo Mercado Pago **não se apaga no Dashboard**. Para devolver o dinheiro, faça o estorno pelo Mercado Pago.

---

# Parte 3 — Avisos por WhatsApp (Meta / WhatsApp Business oficial)

O WhatsApp oficial só deixa você **iniciar** uma conversa com um cliente usando **modelos de mensagem aprovados** pela Meta. É por isso que o sistema usa
modelos com 4 espaços variáveis (nome, código, dia e hora, link).

### 3.1 O que você precisa antes
- Uma conta pessoal do **Facebook**.
- Um **número de telefone** para a loja que **não esteja em uso no aplicativo comum do WhatsApp** (ou apague a conta do WhatsApp naquele número antes). Para testar,
  a Meta oferece um número de teste gratuito.
- Dados da empresa (razão social/CNPJ) para a **verificação da empresa**, que a Meta exige para usar em produção.

### 3.2 Criar o app na Meta
1. Acesse **business.facebook.com** e crie o seu **Portfólio empresarial** (se ainda não tiver).
2. Acesse **developers.facebook.com** → **Meus apps** → **Criar app** → tipo **Empresa** → escolha o portfólio criado.
3. No painel do app, em **Adicionar produtos**, escolha **WhatsApp** → **Configurar**.
4. Em **WhatsApp → Configuração da API** (*API Setup*), anote:
   - **ID do número de telefone** (*Phone number ID*) → será o Secret `WHATSAPP_PHONE_ID`.
   - **ID da conta do WhatsApp Business** (só para consultar depois).
5. Nessa mesma tela há um **token temporário** (vale 24 h): serve só para o primeiro teste.

### 3.3 Modo de teste (grátis, sem verificar a empresa)
1. Na mesma tela, em **Para** (*To*), **adicione o seu celular** à lista de números de teste e confirme o código que chegar no WhatsApp.
2. Cadastre os Secrets (3.6) com o token temporário e teste com **um cliente cujo telefone seja o seu**. Só números da lista recebem no modo de teste.

### 3.4 Token permanente (para o dia a dia)
O token temporário vence. Para um token que não vence:
1. **business.facebook.com → Configurações da empresa → Usuários → Usuários do sistema** → **Adicionar** (papel *Administrador*).
2. **Atribuir ativos**: dê a esse usuário o **app** e a **conta do WhatsApp** (controle total).
3. **Gerar novo token**: escolha o app e marque as permissões **`whatsapp_business_messaging`** e **`whatsapp_business_management`**, com validade **“Nunca”**.
4. Copie o token (aparece uma vez) → será o Secret `WHATSAPP_TOKEN`.

### 3.5 Número da loja e verificação da empresa (produção)
1. **WhatsApp Manager → Números de telefone → Adicionar número** e verifique por SMS ou ligação.
2. Defina o **nome de exibição** (o nome que o cliente vê); a Meta analisa e aprova.
3. Em **Configurações da empresa → Central de segurança → Verificação da empresa**, envie os documentos pedidos. Sem isso, o limite de envio é baixo e há restrições.
4. O **Phone number ID** do número real (WhatsApp Manager) substitui o do número de teste no Secret `WHATSAPP_PHONE_ID`.

### 3.6 Criar os modelos de mensagem
1. **WhatsApp Manager → Modelos de mensagem → Criar modelo**.
2. **Categoria:** *Utilitário*. **Idioma:** *Português (Brasil)*. **Nome:** exatamente como no Dashboard (ex.: `pedido_confirmado`).
3. **Corpo:** cole o texto sugerido (no Dashboard, em *Configurações → Integrações → Textos sugeridos*). Os 6 modelos de pedido usam **as 4 variáveis nesta ordem**:
   `{{1}}` primeiro nome · `{{2}}` código do pedido · `{{3}}` dia e hora · `{{4}}` link para acompanhar.
4. Nos **exemplos** de cada variável, ponha valores de mentira (ex.: `Maria`, `LA1001`, `sábado, 26/09 às 16:00`, `https://sualoja.com.br/#/pedido/LA1001`).
5. Envie para aprovação (costuma levar de minutos a algumas horas). Repita para os modelos:

| Nome do modelo | Quando é enviado |
|---|---|
| `pedido_confirmado` | Pedido confirmado |
| `pedido_em_preparo` | Em preparo (vem desligado por padrão) |
| `pedido_pronto` | Pronto / pronto para retirada |
| `pedido_saiu_entrega` | Saiu para entrega |
| `pedido_entregue` | Entregue ou retirado (vem desligado por padrão) |
| `pedido_cancelado` | Cancelado |
| `estoque_alerta` (opcional) | Aviso de estoque para você mesma (*Estoque → Ingredientes → Aviso de estoque*) — usa só **2 variáveis**: `{{1}}` seu nome · `{{2}}` o resumo do que precisa de atenção. Texto sugerido: “Oi, {{1}}! Alerta de estoque: {{2}}.” |

> Os textos não podem **começar nem terminar** com uma variável; os sugeridos já terminam com uma frase para isso.

### 3.7 Cadastrar os Secrets
No Supabase (Parte 1):

| Nome | Valor |
|---|---|
| `WHATSAPP_TOKEN` | O token do passo 3.4 (ou o temporário, no teste). |
| `WHATSAPP_PHONE_ID` | O *Phone number ID* (3.2 ou 3.5). |
| `URL_LOJA` | O endereço da loja, sem barra no final. É usado no link “acompanhe por aqui”. |

### 3.8 Ligar no Dashboard
1. **Configurações → Integrações → Avisos por WhatsApp**.
2. Confira **quais situações avisam** e o **nome de cada modelo** (deve ser igual ao da Meta).
3. Ligue **“Enviar avisos automáticos pelo WhatsApp”** e clique **Salvar avisos**.

### 3.9 Testar
1. Faça um pedido com o **seu** telefone (no modo de teste, só ele recebe) e, no Dashboard, mude o pedido para **Confirmado**.
2. A mensagem chega no WhatsApp e o pedido mostra, em **Avisos ao cliente**, a linha **Enviado**.
3. Se falhar, a linha mostra **Falhou** com o motivo, e há o botão **Reenviar aviso**.

### Regras que o sistema já respeita
- Só avisa sobre **o pedido** (mensagens utilitárias), nunca propaganda.
- O **cliente pode desligar** em *Minha conta → Meus dados* (“Receber avisos do pedido pelo WhatsApp”). Se desligou, não recebe.
- Não repete o mesmo aviso por engano (o botão *Reenviar* existe para quando você quiser repetir).
- Pedidos lançados pela equipe, mesmo de cliente sem conta, recebem se tiverem telefone.
- Quem nunca configurou o WhatsApp **nunca vê erro**: sem aviso para enviar, nada acontece.

### Se algo der errado (WhatsApp)
| Mensagem no Dashboard | O que fazer |
|---|---|
| “O WhatsApp ainda não foi configurado (faltam as chaves…)” | Cadastre `WHATSAPP_TOKEN` e `WHATSAPP_PHONE_ID`. |
| “A chave do WhatsApp venceu ou está errada.” | Gere um token novo (3.4) e atualize o Secret. |
| “Este número não está autorizado no modo de teste da Meta.” | Adicione o número à lista de testes (3.3) ou conclua a configuração para produção (3.5). |
| “Este número não tem WhatsApp…” | O telefone do cliente não tem WhatsApp. |
| “O modelo de mensagem não existe ou ainda não foi aprovado.” | Confira o nome do modelo (igual ao Meta, minúsculas) e se está **Aprovado**. |
| “Os campos do modelo não batem.” | O modelo precisa ter exatamente as 4 variáveis `{{1}}` a `{{4}}`. |
| “Limite de mensagens do WhatsApp atingido.” | Aguarde; conclua a verificação da empresa para aumentar o limite. |

---

# Parte 4 — Para quem vai manter o sistema (técnico)

As funções ficam em `Dashboard/supabase/functions/` (`pix-criar`, `pix-webhook`, `whatsapp-avisar`, e `_shared/`). A lógica de cada uma está em `logica.js`
e é testada em `npm test` contra o banco de teste com Mercado Pago e Meta simulados.

**Publicar (ou republicar) as funções**, dentro da pasta `Dashboard`, com a CLI do Supabase logada no projeto:

```
supabase functions deploy pix-criar        --project-ref SEU-PROJETO --use-api
supabase functions deploy whatsapp-avisar  --project-ref SEU-PROJETO --use-api
supabase functions deploy pix-webhook      --project-ref SEU-PROJETO --use-api --no-verify-jwt
```

O `pix-webhook` precisa ser público (o Mercado Pago não tem o login do Supabase), por isso o `--no-verify-jwt`; a segurança dele é a conferência do pagamento na
API do Mercado Pago, a assinatura do aviso (`MP_WEBHOOK_SECRET`) e a chave de integração (`SEGREDO_GATEWAY`) exigida pelo banco.

**Rodar tudo no computador, sem contas:** `npm run dev` já inclui as três funções com Mercado Pago e Meta **simulados** (nada sai da máquina). Gere a chave em
*Configurações → Integrações*, ligue e faça um pedido: o QR Code aparece e o pedido pode ser “pago” pelo endereço de controle
`POST http://127.0.0.1:54321/__teste/mp/aprovar` com `{"codigo":"LA1001"}`.

**Segredos usados por cada função** (Supabase → Edge Functions → Secrets). `SUPABASE_URL` e `SUPABASE_ANON_KEY` já existem sozinhos; a chave secreta (`service_role`) **não é usada**:

| Função | Secrets |
|---|---|
| `pix-criar` | `MP_ACCESS_TOKEN`, `ORIGENS_PERMITIDAS` |
| `pix-webhook` | `MP_ACCESS_TOKEN`, `SEGREDO_GATEWAY`, `MP_WEBHOOK_SECRET` |
| `whatsapp-avisar` | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `URL_LOJA`, `ORIGENS_PERMITIDAS` |
