-- ==========================================================
-- 1) ESQUEMA — tabelas da loja e do painel
-- Valores em dinheiro ficam em CENTAVOS (R$ 12,50 = 1250).
-- Os horários são gravados em UTC (timestamptz) e exibidos no
-- fuso de São Paulo pelas funções da API.
-- ==========================================================

-- Um perfil para cada usuário do Supabase Auth (cliente ou administrador).
create table public.perfis (
  id            uuid primary key references auth.users (id) on delete cascade,
  nome          text not null default '',
  email         text not null,
  telefone      text,
  papel         text not null default 'cliente' check (papel in ('cliente', 'admin')),
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now(),
  ultimo_acesso timestamptz
);
create unique index perfis_email_idx on public.perfis (lower(email));

create table public.enderecos (
  id          bigint generated always as identity primary key,
  usuario_id  uuid not null references public.perfis (id) on delete cascade,
  apelido     text not null,
  cep         text not null,
  rua         text not null,
  numero      text not null,
  complemento text,
  bairro      text not null,
  cidade      text not null,
  uf          text not null,
  referencia  text,
  lat         double precision,
  lng         double precision,
  principal   boolean not null default false,
  criado_em   timestamptz not null default now()
);
create index enderecos_usuario_idx on public.enderecos (usuario_id);

create table public.categorias (
  id     bigint generated always as identity primary key,
  nome   text not null,
  emoji  text not null default '🍰',
  ordem  int  not null default 0,
  ativa  boolean not null default true
);

create table public.produtos (
  id                 bigint generated always as identity primary key,
  categoria_id       bigint not null references public.categorias (id),
  nome               text not null,
  descricao          text not null default '',
  preco              int  not null check (preco >= 0),
  unidade            text not null default 'unidade',
  min_qtd            int  not null default 1 check (min_qtd >= 1),
  emoji              text not null default '🍰',
  imagem             text,
  tag                text,
  opcoes             jsonb not null default '[]'::jsonb,
  antecedencia_horas int,
  ativo              boolean not null default true,
  destaque           boolean not null default false,
  ordem              int  not null default 0,
  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now()
);
create index produtos_categoria_idx on public.produtos (categoria_id);

create table public.favoritos (
  usuario_id uuid   not null references public.perfis (id) on delete cascade,
  produto_id bigint not null references public.produtos (id) on delete cascade,
  criado_em  timestamptz not null default now(),
  primary key (usuario_id, produto_id)
);

create table public.cupons (
  id              bigint generated always as identity primary key,
  codigo          text not null,
  descricao       text not null default '',
  tipo            text not null check (tipo in ('percentual', 'valor')),
  valor           int  not null check (valor > 0),
  minimo          int  not null default 0,
  validade        date,
  limite_uso      int,
  usos            int  not null default 0,
  primeira_compra boolean not null default false,
  ativo           boolean not null default true
);
create unique index cupons_codigo_idx on public.cupons (upper(codigo));

create table public.zonas_entrega (
  id        bigint generated always as identity primary key,
  nome      text not null,
  ate_km    double precision not null check (ate_km > 0),
  taxa      int  not null default 0,
  prazo_min int  not null default 60,
  ativa     boolean not null default true
);

-- O código do pedido (LA1001…) sai da própria numeração.
create table public.pedidos (
  id                  bigint generated always as identity (start with 1001) primary key,
  codigo              text unique,
  usuario_id          uuid not null references public.perfis (id),
  cliente_nome        text not null,
  cliente_telefone    text,
  status              text not null default 'novo'
                      check (status in ('novo','confirmado','em_preparo','pronto','saiu_entrega','entregue','cancelado')),
  tipo                text not null check (tipo in ('entrega', 'retirada')),
  endereco            jsonb,
  lat                 double precision,
  lng                 double precision,
  distancia_km        double precision,
  data_agendada       date not null,
  hora_agendada       text not null,
  pagamento           text not null,
  troco_para          int,
  subtotal            int not null,
  taxa_entrega        int not null default 0,
  desconto            int not null default 0,
  total               int not null,
  cupom               text,
  observacoes         text,
  motivo_cancelamento text,
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now()
);
create index pedidos_usuario_idx on public.pedidos (usuario_id);
create index pedidos_status_idx  on public.pedidos (status);
create index pedidos_criado_idx  on public.pedidos (criado_em);

create table public.pedido_itens (
  id         bigint generated always as identity primary key,
  pedido_id  bigint not null references public.pedidos (id) on delete cascade,
  produto_id bigint references public.produtos (id) on delete set null,
  nome       text not null,
  unidade    text not null,
  preco_unit int  not null,
  qtd        int  not null,
  opcoes     jsonb not null default '[]'::jsonb,
  obs        text,
  total      int  not null
);
create index pedido_itens_pedido_idx on public.pedido_itens (pedido_id);

create table public.pedido_historico (
  id         bigint generated always as identity primary key,
  pedido_id  bigint not null references public.pedidos (id) on delete cascade,
  status     text not null,
  nota       text,
  usuario_id uuid references public.perfis (id),
  criado_em  timestamptz not null default now()
);
create index pedido_historico_pedido_idx on public.pedido_historico (pedido_id);

create table public.avaliacoes (
  id         bigint generated always as identity primary key,
  pedido_id  bigint not null unique references public.pedidos (id) on delete cascade,
  usuario_id uuid not null references public.perfis (id) on delete cascade,
  nota       int  not null check (nota between 1 and 5),
  comentario text,
  aprovada   boolean not null default false,
  resposta   text,
  criado_em  timestamptz not null default now()
);

-- Configurações da loja: uma linha por seção (loja, textos, horarios, pedidos, entrega, pagamento).
create table public.configuracoes (
  chave text primary key,
  valor jsonb not null
);

-- Quando alguém cria conta no Supabase Auth, nasce o perfil (sempre como "cliente").
-- O papel NUNCA vem dos metadados enviados pelo navegador.
create function public.novo_usuario() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.perfis (id, nome, email, telefone)
  values (
    new.id,
    -- sem nome informado (ex.: usuário criado pelo painel do Supabase), usa a parte do e-mail antes do @
    left(coalesce(nullif(btrim(coalesce(new.raw_user_meta_data ->> 'nome', '')), ''), split_part(coalesce(new.email, ''), '@', 1)), 80),
    coalesce(new.email, ''),
    nullif(left(regexp_replace(coalesce(new.raw_user_meta_data ->> 'telefone', ''), '\D', '', 'g'), 11), '')
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger ao_criar_usuario after insert on auth.users
for each row execute function public.novo_usuario();
