# supabase

O banco de dados da loja (Postgres no Supabase). A Loja e o Dashboard **não** leem tabelas: chamam funções.

```
supabase/
├─ migrations/   rodam em ordem (o número no nome é a ordem)
│  ├─ …0001_esquema                     tabelas e o gatilho que cria o perfil ao criar conta
│  ├─ …0002_seguranca_e_ajudantes       RLS ligado, validações, distância/entrega, status
│  ├─ …0003_loja_publico_e_conta        vitrine pública, perfil, endereços, favoritos
│  ├─ …0004_pedidos                     cálculo do pedido (opções, cupom, agenda, frete), criação e cancelamento
│  ├─ …0005_painel_pedidos              funções admin de pedidos e resumo
│  ├─ …0006_painel_cadastros            categorias, produtos, clientes, cupons, avaliações, zonas, config, equipe
│  ├─ …0007_storage                     bucket de fotos "produtos" (leitura pública, escrita só admin)
│  ├─ …0008_permissoes                  quem pode executar o quê (visitante / logado)
│  ├─ …0009_conteudo_visual             bucket "site" (logo, fotos), ícone das categorias, galeria, perguntas e textos legais
│  ├─ …0010_agenda_e_producao           datas bloqueadas, limite de pedidos por dia, lista de produção
│  ├─ …0011_pedidos_avancados           pedido lançado pela equipe, sinal, pagamentos, cupom de frete grátis, exportações
│  ├─ …0012_produtos_extras             alérgenos, fotos extras, limite por dia e período de venda
│  ├─ …0013_equipe_auditoria_lgpd       atendente, registro de atividade, baixar/excluir dados, primeiros passos
│  ├─ …0014_protecao                    limite de chamadas por IP/conta, teto de pedidos em aberto, tamanho máximo, índices
│  ├─ …0015_integracoes                 PIX automático (chave de integração, pagamento do gateway) e avisos por WhatsApp
│  ├─ …0016_estoque                     ingredientes, receitas, baixa automática por pedido, previsão de compras e histórico
│  ├─ …0017_estoque_avancado            receitas-base, perda de preparo, medidas caseiras, validade por lote, compra/contagem em lote, simulador
│  ├─ …0018_estoque_custos_e_avisos     histórico de preço, margem e preço sugerido, lucro real por período e aviso de estoque por WhatsApp
│  ├─ …0019_estoque_fardo               compra em fardo/caixa (além da embalagem), com economia calculada e lançamento em fardo
│  ├─ …0020–0023                        Forminha: aparência, convite, pagamento online, relatórios, assinatura
│  └─ …0024_multiloja                   várias lojas no mesmo banco (loja_id em tudo, trava por loja, numeração por loja)
├─ seed.sql          configurações iniciais de UMA loja (textos, horários, pagamento…) — o cardápio NASCE VAZIO
├─ seed-exemplo.sql  cardápio de exemplo, só para testes e para o `npm run dev` (não entra na instalação)
└─ instalar-tudo.sql   (gerado por `npm run sql`; não vai para o GitHub)
```

- **Instalar num projeto novo:** `npm run sql` (na pasta `Dashboard`) e colar `instalar-tudo.sql` no SQL Editor do Supabase (veja `../docs/PUBLICAR.md`).
- **Mudar algo num projeto que já está no ar:** crie uma migração **nova** (número maior). Não edite as antigas.
- **Função nova da API:** inclua-a na lista de permissões (nova migração com `grant execute … to authenticated`), senão o navegador não a enxerga.
- **Tabela nova:** ligue o RLS (`alter table … enable row level security`) e não crie permissões diretas para visitantes.
- **Várias lojas no mesmo banco (desde a 0024):** a loja da chamada vem do cabeçalho `x-loja` (código ou endereço do site),
  de `forminha.loja` (a Central) ou, num banco de uma loja só, da única loja. Nas migrações novas:
  - tabela nova: `loja_id uuid not null default public._loja_atual() references public.lojas (id) on delete cascade`,
    a política `so_da_loja` (copie da 0024) e chaves únicas **com** `loja_id`;
  - função nova com `security definer`: `alter function … owner to forminha_app` (o papel que só vê a loja da vez),
    entre `grant create on schema public to forminha_app;` e `revoke create on schema public from forminha_app;`
    (o Postgres exige; no Supabase quem roda as migrações não é superusuário — os testes rodam do mesmo jeito);
  - dentro das funções: `public._uid()` no lugar de `auth.uid()` e `on conflict (loja_id, chave)`.
  O teste `multiloja.test.js` confere tudo isso e tenta ver dados de uma loja pela outra.
- Os testes (`npm test`) aplicam essas mesmas migrações num Postgres local e conferem as regras.
- **functions/** — funções do servidor (Edge Functions): `pix-criar`, `pix-webhook` e `whatsapp-avisar`. Guardam as chaves do Mercado Pago e da Meta nos *Secrets* do
  Supabase (nunca no código). Publicação e guia: `../docs/INTEGRACOES.md`.
