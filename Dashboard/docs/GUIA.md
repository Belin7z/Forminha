# Guia do projeto

Um sistema completo de loja com **duas telas separadas**, ligadas ao mesmo banco de dados (Supabase):

| O quê | No seu computador | Na internet | Quem usa |
|---|---|---|---|
| **Loja** (site de pedidos) | http://localhost:3000 | projeto Vercel `Loja` | clientes |
| **Dashboard** (gestão) | http://localhost:3001 | projeto Vercel `Dashboard` | administradores |

Tudo o que o Dashboard altera (cardápio, preços, horários, entrega…) aparece na loja na hora.

Para publicar: veja [PUBLICAR.md](PUBLICAR.md).

---

## 1. Testar no seu computador

Precisa do **Node.js 20 ou mais novo**. Abra o terminal **dentro da pasta `Dashboard`** (é onde ficam o banco, os testes e as ferramentas):

```
cd Dashboard
npm install      (só na primeira vez)
npm run dev
```

O terminal mostra os dois endereços. Sem nenhuma configuração ele liga um **banco de teste local** (some ao fechar) com
um cardápio de exemplo (só para testar) e um administrador:

- Dashboard: `admin@exemplo.com` / `Admin12345`
- Cupom de exemplo: `BEMVINDO10`
- Para testar com o cardápio **vazio**, como o banco de verdade nasce: `SEM_EXEMPLO=1 npm run dev` (no PowerShell: `$env:SEM_EXEMPLO=1; npm run dev`)

Para testar com o **seu Supabase de verdade**, copie `.env.example` para `.env` (dentro da pasta `Dashboard`) e preencha `SUPABASE_URL` e `SUPABASE_ANON_KEY`.

| Comando | O que faz |
|---|---|
| `npm run dev` | liga loja e Dashboard para teste local |
| `npm test` | roda os testes automáticos |
| `npm run sql` | gera `supabase/instalar-tudo.sql` para colar no Supabase |
| `npm run build` | monta o Dashboard em `dist/` (a Vercel faz isso sozinha; na pasta `Loja` existe o mesmo comando) |

---

## 2. Primeiros passos no Dashboard

Na **Visão geral** aparece a lista **“Primeiros passos”**: ela mostra o que já está pronto e leva você direto ao que falta (dá para ocultá-la).

1. **Configurações → Loja e textos:** nome, WhatsApp, Instagram, endereço, textos da página inicial.
2. **Configurações → Imagens:** logo, foto de destaque da página inicial, foto da confeiteira e galeria (até 8 fotos). Sem fotos, o site usa ilustrações.
3. **Configurações → Horários:** dias e horários em que a loja recebe/entrega.
4. **Configurações → Pagamento:** chave PIX (sem ela o PIX não aparece para o cliente) e o **sinal** (percentual do pedido pago antes, por PIX, para garantir a data).
5. **Entrega e mapa:** arraste o pino até a localização da loja e ajuste as faixas de frete por distância.
6. **Categorias e Produtos:** o cardápio **começa vazio**. Crie primeiro as categorias (Bolos, Docinhos… cada uma com o seu **ícone**) e depois os produtos.
   Cada produto aceita foto (e até 4 fotos extras), preço, pedido mínimo, antecedência própria, **opções** (tamanho, recheio, adicionais…),
   **alérgenos**, **limite de unidades por dia** e **período de venda** (para itens de época, como ovos de Páscoa).
7. **Configurações → Perguntas e Textos legais:** perguntas frequentes e política de privacidade/termos. Já vêm com um texto-base;
   **peça a um advogado para revisar** antes de divulgar.
8. **Agenda:** defina o **limite de pedidos por dia** e bloqueie datas (feriados, férias).
9. **Cupons:** nenhum vem pronto — crie os seus (percentual, valor fixo ou **frete grátis**).

---

## 3. O que cada tela faz

### Loja (cliente)
- Visual **premium** em rosa e dourado (fontes Cormorant Garamond e Jost, ícones de linha, sem emojis), adaptado ao celular.
- Página inicial com foto de destaque, categorias com ícone, mais pedidos, sobre a confeiteira, galeria, avaliações e **perguntas frequentes**.
- Cardápio com busca, filtros, ordenação e favoritos. Janela do produto com fotos extras, **alérgenos**, opções, quantidade e observação; carrinho lateral.
- **Cadastro** (com aceite da política e dos termos), login e “esqueci minha senha”; **Minha conta** com dados, senha, **endereços**, histórico e **Privacidade**
  (baixar todos os meus dados e **excluir a conta**).
- **Endereços com CEP** (preenche rua e bairro) e **mapa** para marcar o ponto exato. O frete é calculado pela distância até a loja.
- Finalizar pedido: retirada ou entrega, **data e horário** dentro do funcionamento e da antecedência (dias **lotados ou bloqueados** aparecem desativados),
  pagamento (PIX “copia e cola”, dinheiro com troco, cartão), cupom e, quando a loja pede, o **sinal** para garantir a data.
- **Acompanhamento do pedido** com linha do tempo (atualiza sozinha), mapa da entrega, PIX do sinal, cancelar (enquanto “novo”), pedir de novo e **avaliar**.
- **Botão flutuante de WhatsApp**, páginas de **Privacidade** e **Termos**, dados para o Google (SEO) e **app instalável** no celular (PWA).
- Com o PIX automático ligado, o cliente vê um **QR Code** na página do pedido e a tela **confirma sozinha** quando o pagamento cai. Em *Minha conta* ele escolhe se quer
  receber os avisos do pedido pelo WhatsApp.

### Dashboard (equipe)
- **Visão geral:** primeiros passos, indicadores do dia e do mês, vendas por dia, mais vendidos, formas de pagamento, favoritos e últimos pedidos.
- **Pedidos:** quadro por etapa e lista, busca, filtro por data, avanço rápido, detalhe com mapa, aviso ao cliente pelo **WhatsApp**,
  impressão e **alerta sonoro** de pedido novo. Cada pedido mostra a situação do pagamento (a receber, sinal pago, pago) e permite
  **registrar e estornar pagamentos**.
- **Novo pedido:** lance aqui as encomendas que chegam por WhatsApp, telefone ou balcão (cliente cadastrado ou sem cadastro, itens do cardápio ou avulsos,
  entrega, desconto e sinal). O sistema calcula tudo e o pedido entra na agenda e na produção.
- **Agenda:** calendário do mês com a carga de cada dia, **limite de pedidos por dia** e **datas bloqueadas**.
- **Produção:** o que fazer em cada data (totais por item e roteiro por horário), pronta para **imprimir**.
- **Produtos / Categorias:** cadastro completo com foto(s), opções, alérgenos, limite por dia e período de venda; ligar/desligar na loja; destaque; reordenar.
- **Estoque** (só administrador): **ingredientes** (com medidas caseiras e validade), **receitas** dos produtos e **receitas-base** reutilizáveis, **baixa automática**,
  **previsão de compras**, **custos e preço sugerido**, **lucro real**, **contagem guiada**, **simulador de encomenda** e **aviso por WhatsApp** quando algo vai faltar.
  Veja o passo a passo logo abaixo.
- **Clientes:** histórico de compras, bloquear/desbloquear, **e-mail de redefinição de senha** e **exportação em planilha**.
- **Cupons** (percentual, valor fixo ou frete grátis), **Avaliações** (aprovar e responder), **Favoritos** (ranking).
- **Entrega e mapa**, **Configurações**, **Equipe**, **Atividade** (quem mudou o quê) e **Minha conta**.
- **Exportar** pedidos (por período) e clientes em planilha (CSV, abre no Excel e no Google Planilhas).
- **Envio de fotos com assistente:** ao escolher uma foto (logo, destaque, galeria, produtos) abre uma janela para **enquadrar** (arrastar e dar zoom) na proporção certa
  de cada lugar do site, com avisos ao vivo de foto pequena, escura, com muita luz ou desfocada. Há dicas de fotografia em *Configurações → Imagens*.
- **Integrações** (*Configurações → Integrações*): **pagamento online** pelo Mercado Pago — PIX automático e cartão de crédito/débito, o pedido muda para “pago”
  sozinho (em loja criada pela Central, basta colar o Access Token) — e **avisos automáticos por WhatsApp** oficial
  (Meta) a cada mudança de situação, com histórico e botão “Reenviar aviso” em cada pedido. Ficam desligados até você criar as contas: siga [INTEGRACOES.md](INTEGRACOES.md).
- **Aplicativo**: o painel e a loja podem ser instalados no celular ou no computador, com o nome e as cores da loja. Quando o navegador permite, aparece
  **Instalar o app** (no menu do painel e no rodapé da loja); no iPhone o botão mostra o passo a passo do Safari (Compartilhar → Adicionar à Tela de Início).
- **Domínio** (*Configurações → Domínio*, em loja criada pela Central): um endereço só seu, como `suadoceria.com.br` (e, se quiser, `painel.suadoceria.com.br`).
  Digite o domínio, crie os registros de DNS que aparecem na tela no site onde ele foi comprado e pronto: quando o DNS fica certo, a loja passa a usar o domínio sozinha.

### Estoque, receitas, custos e lucro — passo a passo

1. **Ingredientes** (*Estoque → Ingredientes → Novo ingrediente*): nome, medida (**g**, **ml** ou **un**), quanto tem agora, o **mínimo** que não quer deixar faltar,
   **como compra** (ex.: “lata” com 395 g por R$ 7,00), **onde fica guardado** (Despensa, Geladeira…) e, se quiser, **medidas caseiras** (1 xícara = 120 g) para digitar
   as receitas do seu jeito. O sistema calcula o preço por quilo e o valor parado em estoque. Se você também compra no atacado, abra **“Também compra em fardo ou
   caixa maior?”** e informe quantas embalagens tem o fardo e o preço — o sistema mostra se vale a pena (“economize 16%”) e você passa a poder lançar compras
   **por fardo** (em *Lançar* ou em *Receber compra*), sem precisar converter nada na mão. A lista de ingredientes mostra uma **barrinha de nível** de cada um
   (cheia/baixa/vazia) e, com mais de um local cadastrado, agrupa os itens por onde ficam guardados.
2. **Receitas-base** (*Estoque → Receitas → Receitas-base*): para o que você prepara e usa em vários produtos (massa de brigadeiro, ganache, calda…). Cadastre uma vez,
   com o rendimento do lote e a **perda de preparo** (%), e use-a depois nas receitas dos produtos — mudou o preço de um ingrediente, o custo de tudo que leva aquela
   receita-base atualiza sozinho.
3. **Receitas dos produtos** (*Estoque → Receitas → Criar receita*): escolha ingredientes **e/ou receitas-base** e a quantidade de cada um (na medida do ingrediente
   ou numa medida caseira). A lista já mostra **quanto você tem de cada ingrediente** (“tem 3 kg”), e o botão **+** ao lado de cada linha abre o lançamento de estoque
   na hora, sem sair da receita — a linha atualiza sozinha assim que você registra a compra. Se a receita rende várias unidades, informe o **rendimento**;
   em **Acréscimos por opção**, some o que muda quando o cliente escolhe algo (ex.: tamanho “2 kg” leva +400 g de farinha **por unidade**). A tela mostra o **custo**,
   a **margem** e quantas unidades dá para fazer com o estoque de hoje.
4. **Baixa automática:** quando um pedido vai para **Em preparo**, o que a receita usa sai do estoque sozinho (uma vez só por pedido, abrindo as receitas-base). Se o
   pedido for **cancelado** depois, os ingredientes **voltam** (se já tinham sido usados de verdade, registre uma **perda**). Dá para desligar em *Ingredientes → Como o
   estoque é atualizado*.
5. **Previsão e compras**: o sistema olha os pedidos ainda não preparados dos próximos dias (você escolhe o período) e mostra **o que vai faltar** (e a partir de que
   dia), **o que ficou abaixo do mínimo**, **lotes vencendo** e **quanto comprar**, em embalagens inteiras e com o valor estimado. **Copiar lista** (WhatsApp) ou
   **Imprimir**; **Já comprei** lança a entrada.
6. **Lançamentos e compra em lote**: **Lançar** em cada ingrediente registra compra, contagem ou perda avulsa; **Receber compra** lança de uma vez **vários itens de
   uma nota**, cada um com seu valor e validade. Tudo fica no **Histórico**, com quem fez e o pedido de origem.
7. **Validade** (o ícone de gráfico e o link de validade em cada ingrediente): cada compra com validade vira um **lote** — o que vence primeiro sai primeiro quando a
   receita usa o ingrediente. Lotes vencendo aparecem em destaque na Previsão; **Descartar** lança a perda e some com o lote.
8. **Contagem guiada** (*Ingredientes → Fazer contagem*): passa pelos ingredientes em uso um a um — você confirma ou digita o que tem na prateleira; só o que mudou é
   gravado no final. Boa para usar no celular, andando pela cozinha.
9. **Simulador** (*Ingredientes → Simulador*): monte a lista de uma encomenda grande (“50 brigadeiros para sábado”) e veja o que falta comprar, já contando com o que
   os pedidos agendados vão gastar — sem precisar criar o pedido antes.
10. **Custos e preços** (*Estoque → Custos e preços*): defina a **margem que você quer ganhar**; produtos abaixo dela ganham um **preço sugerido** (aplique com um
    clique). Avisa também quando um **ingrediente fica mais caro** e quais produtos isso afeta.
11. **Lucro** (*Estoque → Lucro*): receita, custo (pelos preços de hoje) e lucro de verdade, por período, por produto e por pedido — não só o que foi vendido, o que
    sobrou depois de pagar os ingredientes. Produto sem receita entra como “sem custo conhecido” e fica fora da conta de lucro.
12. **Aviso por WhatsApp** (*Ingredientes → Aviso de estoque*): ligue e informe seu número para receber um resumo quando algo estiver faltando, abaixo do mínimo ou
    perto de vencer — um por dia, e outro se aparecer algo novo, dentro do horário que você escolher. Precisa da conta do WhatsApp oficial (Meta) configurada: veja
    [INTEGRACOES.md](INTEGRACOES.md); o modelo de mensagem precisa de 2 variáveis ({{1}} seu nome, {{2}} o resumo).

Cuidados: produto **sem receita** não entra nas contas de estoque nem de lucro (o sistema avisa quais são); a receita usa o **nome** da opção, então, se você renomear
“2 kg” em um produto, ajuste também a receita (o editor destaca a opção que deixou de existir); o estoque pode ficar **negativo** — é sinal de que a contagem estava
desatualizada; o custo usa sempre o **preço mais recente**, não o preço de quando o ingrediente foi comprado.

**Papéis da equipe:** o **administrador** vê e altera tudo. O **atendente** só usa Pedidos, Novo pedido, Agenda e Produção
(o banco recusa o resto, mesmo que ele tente pelo endereço). Quem entra na equipe precisa antes criar uma conta na loja;
depois você informa o e-mail em *Equipe* e escolhe o papel.

---

## 4. Como o projeto está organizado

```
Forminha/                (um repositório só, no GitHub: Belin7z/Forminha)
├─ Central/              onde as lojas são criadas, atualizadas e excluídas (forminha.vercel.app)
├─ Loja/                 site do cliente — pasta COMPLETA (publicada sozinha na Vercel)
│  ├─ index.html · package.json · vercel.json · .env.example · README.md
│  ├─ build/             monta a pasta de publicação
│  └─ src/
│     ├─ estilos/        main.css · base/ (cores, botões, formulários…) · layout · componentes · paginas/
│     ├─ scripts/        main.js · base/ (ferramentas gerais + api/ = ponte com o Supabase)
│     │                  · nucleo/ · componentes/ · paginas/
│     ├─ vendor/         bibliotecas de terceiros (supabase-js, Leaflet) — sem CDN
│     └─ imagens/
└─ Dashboard/            site do administrador — pasta COMPLETA, mesma organização, e mais:
   ├─ supabase/          o banco de dados (migrations/ rodam em ordem · seed.sql = configurações iniciais; seed-exemplo.sql = cardápio só para testes)
   ├─ ferramentas/       só para trabalhar no computador: dev.mjs · juntar-sql.mjs · testes/
   └─ docs/              este guia e o passo a passo de publicação
```

Tudo fica num **repositório só** (`Forminha`), com uma pasta para cada parte. Cada loja tem dois projetos na Vercel —
a loja e o painel — apontando para as pastas `Loja` e `Dashboard`; a Central aponta para a pasta `Central`. O banco de dados,
os guias e as ferramentas de teste servem aos dois sites e ficam na pasta `Dashboard`; eles **não vão para o ar** — o build publica só o site.

### Loja e Dashboard são independentes

Os dois sites são publicados em **projetos diferentes da Vercel**, cada um a partir da sua pasta. Por isso cada pasta
tem **tudo** de que o site precisa dentro dela — o próprio código, os próprios estilos, as próprias bibliotecas:

- Não existe pasta "comum" fora deles. O que os dois sites têm parecido (ferramentas gerais em `src/scripts/base`, estilos em
  `src/estilos/base`) é **cópia de cada um**: pode mudar na Loja sem tocar no Dashboard, e vice-versa.
- Uma consequência: se quiser a **mesma mudança nos dois** (por exemplo, um botão novo nos estilos base), é preciso fazer nas duas pastas.
  As cores de cada loja não ficam no código: a dona escolhe o tema em *Configurações → Aparência* (motor em `src/scripts/base/tema.js`).
- O teste automático `ferramentas/testes/sites-independentes.test.js` copia só a pasta de cada site para outro lugar e confere que
  ele monta sozinho e que nenhum arquivo do site aponta para fora dela.
- Quem liga os dois é o banco no Supabase (a única referência direta é a variável `URL_LOJA` do Dashboard).

### Como as peças conversam

```
 navegador (Loja/Dashboard)
    │  src/scripts/base/api/*.js   ← traduz cada tela em chamadas
    ▼
 supabase-js ──►  Auth (login)   ·   Storage (fotos)   ·   funções do banco (regras)
                                                              │
                                                       Postgres (tabelas trancadas)
```

- A loja e o Dashboard **nunca** leem tabelas diretamente: chamam **funções** (`loja_*`, `cliente_*`, `admin_*`) que conferem
  quem está chamando e aplicam as regras.
- As duas telas guardam a sessão em chaves diferentes (`sb-loja-auth` / `sb-painel-auth`) e ficam em endereços diferentes.

### Onde mudar o quê

| Quero mudar… | Arquivo |
|---|---|
| Cores de um site | `src/estilos/base/tokens.css` (dentro da pasta dele) |
| Status do pedido e textos | `src/scripts/base/dominio.js` (dentro da pasta de cada site) |
| Regras de cálculo (frete, cupom, pedido, horários) | `Dashboard/supabase/migrations/…0004_pedidos.sql` (para mudar num projeto já no ar, crie uma migração nova) |
| Uma página da Loja | `Loja/src/scripts/paginas/` e `Loja/src/estilos/paginas/` |
| Uma página do Dashboard | `Dashboard/src/scripts/paginas/` e `Dashboard/src/estilos/` |
| Configurações iniciais (textos, horários…) | `Dashboard/supabase/seed.sql` |
| Cardápio de exemplo (só para testes) | `Dashboard/supabase/seed-exemplo.sql` |
| Cabeçalhos de segurança | `Loja/vercel.json` e `Dashboard/vercel.json` |

Os valores em dinheiro são guardados em **centavos** (R$ 12,50 = 1250) para evitar erros de arredondamento.
Horários usam o fuso de São Paulo.

---

## 5. Segurança (o que já está feito)

- Login pelo **Supabase Auth** (senhas com hash forte, renovação de sessão, recuperação por e-mail).
- **Nenhuma tabela é acessível pelo navegador**; só funções liberadas uma a uma (`…0008_permissoes.sql`). Visitantes só conseguem ler
  o cardápio, a configuração pública e as avaliações aprovadas.
- Cada função confere quem chama: cliente só vê os próprios pedidos/endereços; a gestão exige papel `admin` e o atendimento aceita `admin` ou `atendente`.
  **O papel nunca vem do navegador.**
- **Registro de atividade:** produtos, categorias, cupons, faixas de entrega, configurações, datas bloqueadas, pagamentos e mudanças de acesso ficam
  registrados (quem, quando e o que mudou). Dados de clientes ficam fora do registro.
- **LGPD:** o cliente registra o aceite da política e dos termos no cadastro, pode baixar todos os seus dados e excluir a conta (pedidos antigos ficam
  só como registro de venda, sem nome, telefone e endereço). Os textos legais são editáveis no Dashboard.
- **Limites no banco:** limite de pedidos por dia, datas bloqueadas, limite de unidades por produto e período de venda valem mesmo se alguém tentar
  burlar a tela (e dois clientes pedindo ao mesmo tempo não estouram o limite).
- **Contra flood e robôs:** firewall na Vercel (limite por IP e bloqueio de varreduras), limite de chamadas por minuto no banco (por IP e por conta),
  teto de pedidos em aberto por cliente, recusa de pedidos gigantes, tempo máximo das consultas, armadilha anti-robô no cadastro, freio de login e
  desconexão do Dashboard após 2 h sem uso. Detalhes e limites em [PUBLICAR.md](PUBLICAR.md).
- **Preços, frete, cupom e horário são calculados no banco** — o navegador só envia a intenção do cliente.
- Bloquear um cliente ou desativar um administrador vale imediatamente.
- Fotos: leitura pública, escrita só de administradores, só PNG/JPG/WEBP até 4 MB.
- Todo texto vindo do usuário é escapado ao aparecer na tela (proteção contra XSS) e os sites têm CSP restritiva.
- Limite de pedidos por hora por cliente.

## 6. Testes

```
npm test
```

Sobe um Postgres de verdade com as migrações e usa o `supabase-js` oficial com as mesmas chamadas do site: cadastro, endereço,
orçamento, pedido, Dashboard, status, avaliação, fotos, agenda, produção, pedido manual, sinal, pagamentos, cupom de frete, extras do produto,
atendente, registro de atividade, LGPD, estoque (ingredientes, receitas-base, baixa, previsão, validade, custos e lucro) e regras de segurança (mais de 240 testes).

## 7. Limites conhecidos

- **PIX automático e avisos por WhatsApp já vêm prontos, mas só funcionam depois de você criar as contas** (Mercado Pago e Meta): veja [INTEGRACOES.md](INTEGRACOES.md).
  Enquanto isso, o PIX “copia e cola” (inclusive o do sinal) é conferido e **registrado por você** no pedido, e o Dashboard abre o WhatsApp com a mensagem pronta.
- Cartão online (pagar no site com cartão de crédito) não existe: cartão e dinheiro são na entrega/retirada. Não há aviso por e-mail.
- O estoque não controla **lote nem validade**, não considera perda de preparo (quebra) sozinho e só o administrador o vê (há custos e margens). O custo usa o último preço pago.
- Os textos de privacidade e termos são um **modelo**; revise com um advogado.
- O frete usa o ponto marcado no mapa pelo cliente; o administrador vê o endereço e o mapa no detalhe do pedido.
- Mapa, CEP e busca de endereço usam serviços gratuitos (OpenStreetMap, ViaCEP) e precisam de internet.
- Uma única loja por projeto.
