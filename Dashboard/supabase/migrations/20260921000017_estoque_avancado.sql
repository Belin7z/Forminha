-- ==========================================================
-- 17) ESTOQUE AVANÇADO
--     - receitas-base (massa de brigadeiro, ganache…) usadas em várias receitas
--     - perda de preparo (quebra) em receitas e receitas-base
--     - medidas caseiras por ingrediente (xícara, colher) e local de guarda
--     - validade por lote (o mais antigo sai primeiro) e alerta de vencimento
--     - compra recebida em lote (vários itens de uma nota) e contagem em lote
--     - simulador: "quanto preciso para fazer isto?"
--     - lista de compras com fornecedor
--     Só o administrador vê e mexe. Quantidades na unidade do ingrediente.
-- ==========================================================

/* ---------- Ingredientes: medidas caseiras e local ---------- */
alter table public.ingredientes
  add column medidas jsonb not null default '[]'::jsonb,
  add column local text not null default '';

/* ---------- Receitas-base ---------- */
-- Uma receita-base rende `rendimento` (na sua unidade) por lote; as linhas são a quantidade de cada
-- ingrediente para o lote inteiro. Só ingredientes (sem receita-base dentro de receita-base).
create table public.preparos (
  id            bigint generated always as identity primary key,
  nome          text not null,
  unidade       text not null check (unidade in ('g', 'ml', 'un')),
  rendimento    numeric(14, 3) not null default 1 check (rendimento > 0),
  perda_pct     numeric(5, 2) not null default 0 check (perda_pct between 0 and 50),
  revisao       int not null default 1,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index preparos_nome_idx on public.preparos (lower(nome));

create table public.preparo_itens (
  id             bigint generated always as identity primary key,
  preparo_id     bigint not null references public.preparos (id) on delete cascade,
  ingrediente_id bigint not null references public.ingredientes (id) on delete restrict,
  quantidade     numeric(14, 3) not null check (quantidade > 0),
  unique (preparo_id, ingrediente_id)
);
create index preparo_itens_ingrediente_idx on public.preparo_itens (ingrediente_id);

-- A linha de uma receita agora pode ser um ingrediente OU uma receita-base.
alter table public.ficha_itens alter column ingrediente_id drop not null;
alter table public.ficha_itens add column preparo_id bigint references public.preparos (id) on delete restrict;
alter table public.ficha_itens add constraint ficha_itens_um_so check ((ingrediente_id is null) <> (preparo_id is null));
drop index public.ficha_itens_unica_idx;
create unique index ficha_itens_unica_idx on public.ficha_itens
  (produto_id, coalesce(ingrediente_id, 0), coalesce(preparo_id, 0), coalesce(opcao_grupo, ''), coalesce(opcao_item, ''));
create index ficha_itens_preparo_idx on public.ficha_itens (preparo_id);

-- Perda de preparo da receita: gasta essa porcentagem a mais de tudo.
alter table public.receitas add column perda_pct numeric(5, 2) not null default 0 check (perda_pct between 0 and 50);

/* ---------- Lotes com validade ---------- */
create table public.estoque_lotes (
  id                 bigint generated always as identity primary key,
  ingrediente_id     bigint not null references public.ingredientes (id) on delete cascade,
  quantidade         numeric(14, 3) not null check (quantidade > 0),
  quantidade_inicial numeric(14, 3) not null,
  validade           date not null,
  criado_em          timestamptz not null default now()
);
create index estoque_lotes_ing_idx on public.estoque_lotes (ingrediente_id, validade, id);
create index estoque_lotes_validade_idx on public.estoque_lotes (validade);

alter table public.estoque_config add column dias_validade int not null default 7 check (dias_validade between 1 and 90);

alter table public.preparos enable row level security;
alter table public.preparo_itens enable row level security;
alter table public.estoque_lotes enable row level security;
revoke all on public.preparos, public.preparo_itens, public.estoque_lotes from anon, authenticated;

/* ---------- Auditoria ---------- */
drop trigger auditar_ingredientes_dados on public.ingredientes;
create trigger auditar_ingredientes_dados after update of nome, unidade, minimo, embalagem_qtd, embalagem_nome, embalagem_preco, fornecedor, ativo, medidas, local
  on public.ingredientes for each row execute function public._auditar();
create trigger auditar_preparos after insert or update or delete on public.preparos for each row execute function public._auditar();

/* ==========================================================
   Ajudantes internos (ninguém de fora executa)
   ========================================================== */

-- Todas as linhas de receita já traduzidas para ingredientes (a receita-base vira os ingredientes dela).
-- Linhas-base: quantidade para a receita inteira. Linhas de opção: quantidade por unidade.
create function public._ficha_expandida()
returns table (produto_id bigint, opcao_grupo text, opcao_item text, ingrediente_id bigint, quantidade numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  select f.produto_id, f.opcao_grupo, f.opcao_item, f.ingrediente_id, f.quantidade
    from public.ficha_itens f where f.ingrediente_id is not null
  union all
  select f.produto_id, f.opcao_grupo, f.opcao_item, pi.ingrediente_id,
         f.quantidade / p.rendimento * pi.quantidade * (1 + p.perda_pct / 100)
    from public.ficha_itens f
    join public.preparos p on p.id = f.preparo_id
    join public.preparo_itens pi on pi.preparo_id = p.id
$$;

-- O que uma unidade vendida (sem opções) usa de cada ingrediente, já com a perda de preparo.
create function public._receita_base(pid bigint) returns table (ingrediente_id bigint, por_unidade numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  select x.ingrediente_id, sum(x.quantidade) / r.rendimento * (1 + r.perda_pct / 100)
    from public.receitas r join public._ficha_expandida() x on x.produto_id = r.produto_id
   where r.produto_id = pid and x.opcao_grupo is null
   group by x.ingrediente_id, r.rendimento, r.perda_pct
$$;

-- Quanto `qtd` unidades de um produto (com as opções escolhidas, no formato do pedido) gastam de cada ingrediente.
create function public._consumo_item(prod bigint, qtd numeric, opcoes jsonb) returns table (ingrediente_id bigint, quantidade numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  select x.ingrediente_id,
         sum(qtd * x.quantidade / case when x.opcao_grupo is null then r.rendimento else 1 end * (1 + r.perda_pct / 100))
    from public.receitas r
    join public._ficha_expandida() x on x.produto_id = r.produto_id
   where r.produto_id = prod
     and (x.opcao_grupo is null or exists (
            select 1 from jsonb_array_elements(coalesce(opcoes, '[]'::jsonb)) g, jsonb_array_elements(coalesce(g -> 'itens', '[]'::jsonb)) it
             where g ->> 'grupo' = x.opcao_grupo and it ->> 'nome' = x.opcao_item))
   group by x.ingrediente_id
$$;

create or replace function public._estoque_consumo(pids bigint[])
returns table (pedido_id bigint, dia date, produto_id bigint, ingrediente_id bigint, quantidade numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  select o.id, o.data_agendada, i.produto_id, c.ingrediente_id, round(sum(c.quantidade), 3)
    from public.pedidos o
    join public.pedido_itens i on i.pedido_id = o.id
    cross join lateral public._consumo_item(i.produto_id, i.qtd, i.opcoes) c
   where o.id = any (pids)
   group by o.id, o.data_agendada, i.produto_id, c.ingrediente_id
$$;

-- Pedidos que ainda vão gastar ingredientes: não entregues, não cancelados, sem baixa, com data até `fim`.
create function public._estoque_pedidos_pendentes(fim date) returns bigint[]
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(o.id), '{}'::bigint[])
    from public.pedidos o
   where o.data_agendada <= fim and o.status not in ('cancelado', 'entregue')
     and not exists (select 1 from public.estoque_baixas b where b.pedido_id = o.id)
$$;

create or replace function public._receita_custo(pid bigint) returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(b.por_unidade * i.embalagem_preco / i.embalagem_qtd), 0)
    from public._receita_base(pid) b join public.ingredientes i on i.id = b.ingrediente_id
$$;

-- Tira `q` dos lotes com validade, do que vence primeiro para o que vence depois.
create function public._lotes_consumir(ing bigint, q numeric) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare l record; resta numeric := q; tira numeric;
begin
  for l in select id, quantidade from public.estoque_lotes where ingrediente_id = ing order by validade, id for update loop
    exit when resta <= 0;
    tira := least(l.quantidade, resta);
    if tira >= l.quantidade then delete from public.estoque_lotes where id = l.id;
    else update public.estoque_lotes set quantidade = quantidade - tira where id = l.id; end if;
    resta := resta - tira;
  end loop;
end $$;

-- Único caminho para mexer na quantidade: atualiza o estoque, o preço (se mudou), os lotes e o histórico.
create function public._estoque_lancar(
  ing_id bigint, v_tipo text, delta numeric, uid uuid, v_valor int default null, v_nota text default '',
  v_validade date default null, preco_novo int default null, pid bigint default null, consumir_lotes boolean default true
) returns public.ingredientes
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare ing public.ingredientes;
begin
  update public.ingredientes set estoque = estoque + delta, atualizado_em = now() where id = ing_id returning * into ing;
  if not found then perform public._falha(404, 'Ingrediente não encontrado.'); end if;
  -- o preço da embalagem só entra na auditoria e no histórico quando realmente muda
  if preco_novo is not null and preco_novo <> ing.embalagem_preco then
    update public.ingredientes set embalagem_preco = preco_novo where id = ing_id returning * into ing;
  end if;
  insert into public.estoque_movimentos (ingrediente_id, tipo, quantidade, saldo, valor, pedido_id, nota, usuario_id)
  values (ing_id, v_tipo, delta, ing.estoque, v_valor, pid, v_nota, uid);
  if delta < 0 and consumir_lotes and v_tipo in ('uso', 'perda', 'ajuste') then
    perform public._lotes_consumir(ing_id, -delta);
  elsif delta > 0 and v_validade is not null and v_tipo in ('compra', 'inicial') then
    insert into public.estoque_lotes (ingrediente_id, quantidade, quantidade_inicial, validade) values (ing_id, delta, delta, v_validade);
  end if;
  return ing;
end $$;

create or replace function public._ingrediente_json(i public.ingredientes) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', i.id, 'nome', i.nome, 'unidade', i.unidade, 'estoque', i.estoque, 'minimo', i.minimo,
    'embalagem_qtd', i.embalagem_qtd, 'embalagem_nome', i.embalagem_nome, 'embalagem_preco', i.embalagem_preco,
    'fornecedor', i.fornecedor, 'ativo', i.ativo, 'medidas', i.medidas, 'local', i.local,
    'custo_unit', round(i.embalagem_preco::numeric / i.embalagem_qtd, 6),
    'valor_estoque', round(greatest(i.estoque, 0) * i.embalagem_preco / i.embalagem_qtd),
    'proxima_validade', (select to_char(min(l.validade), 'YYYY-MM-DD') from public.estoque_lotes l where l.ingrediente_id = i.id),
    'receitas', (select count(distinct x.produto_id) from public._ficha_expandida() x where x.ingrediente_id = i.id),
    'preparos', (select count(*) from public.preparo_itens pi where pi.ingrediente_id = i.id))
$$;

-- Baixa e devolução agora passam pelo caminho único (e pelos lotes).
create or replace function public._estoque_baixar(pid bigint, uid uuid) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare cfg public.estoque_config; r record; ped public.pedidos; lista jsonb := '[]'::jsonb; quem uuid;
begin
  select pf.id into quem from public.perfis pf where pf.id = uid and pf.papel <> 'cliente';
  select * into cfg from public.estoque_config where id = 1;
  if not cfg.baixa_automatica then return; end if;
  if exists (select 1 from public.estoque_baixas where pedido_id = pid) then return; end if;
  select * into ped from public.pedidos where id = pid;
  for r in select c.ingrediente_id as ing, sum(c.quantidade) as q from public._estoque_consumo(array[pid]) c group by c.ingrediente_id order by c.ingrediente_id loop
    perform public._estoque_lancar(r.ing, 'uso', -r.q, quem, null, 'Pedido ' || coalesce(ped.codigo, pid::text), null, null, pid);
    lista := lista || jsonb_build_array(jsonb_build_object('ingrediente_id', r.ing, 'quantidade', r.q));
  end loop;
  if jsonb_array_length(lista) > 0 then
    insert into public.estoque_baixas (pedido_id, itens) values (pid, lista);
  end if;
end $$;

create or replace function public._estoque_devolver(pid bigint, uid uuid) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare lista jsonb; r record; ped public.pedidos; quem uuid;
begin
  select pf.id into quem from public.perfis pf where pf.id = uid and pf.papel <> 'cliente';
  select b.itens into lista from public.estoque_baixas b where b.pedido_id = pid for update;
  if not found then return; end if;
  select * into ped from public.pedidos where id = pid;
  for r in select (x ->> 'ingrediente_id')::bigint as ing, (x ->> 'quantidade')::numeric as q
             from jsonb_array_elements(lista) x order by 1 loop
    if exists (select 1 from public.ingredientes where id = r.ing) then
      perform public._estoque_lancar(r.ing, 'devolucao', r.q, quem, null, 'Pedido ' || coalesce(ped.codigo, pid::text) || ' cancelado', null, null, pid);
    end if;
  end loop;
  delete from public.estoque_baixas where pedido_id = pid;
end $$;

/* ==========================================================
   API: ingredientes
   ========================================================== */
create or replace function public.admin_ingredientes(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin(); cfg public.estoque_config;
begin
  perform public._limitar('estoque_ler', 120, 60);
  select * into cfg from public.estoque_config where id = 1;
  return jsonb_build_object(
    'config', jsonb_build_object('baixa_automatica', cfg.baixa_automatica, 'dias_previsao', cfg.dias_previsao, 'dias_validade', cfg.dias_validade),
    'ingredientes', coalesce((select jsonb_agg(public._ingrediente_json(i) order by lower(i.nome)) from public.ingredientes i), '[]'::jsonb));
end $$;

create or replace function public.admin_salvar_ingrediente(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  adm public.perfis := public._admin();
  iid bigint := public._v_int(p, 'id', 1, 9223372036854775807, 'Ingrediente', true);
  v_nome text := public._v_txt(p, 'nome', 1, 80, 'Nome');
  v_un text := public._v_opcao(p, 'unidade', array['g', 'ml', 'un'], 'Unidade');
  v_min numeric := round(coalesce(public._v_num(p, 'minimo', 0, 10000000, 'Estoque mínimo', true), 0)::numeric, 3);
  v_qtd numeric := round(coalesce(public._v_num(p, 'embalagem_qtd', 0.001, 10000000, 'Quantidade da embalagem', true), 1)::numeric, 3);
  v_emb text := coalesce(nullif(public._v_txt(p, 'embalagem_nome', 0, 30, 'Nome da embalagem'), ''), 'embalagem');
  v_preco int := coalesce(public._v_int(p, 'embalagem_preco', 0, 100000000, 'Preço da embalagem', true), 0);
  v_forn text := public._v_txt(p, 'fornecedor', 0, 80, 'Fornecedor');
  v_ativo boolean := case when p ? 'ativo' then public._v_bool(p, 'ativo') else true end;
  v_ini numeric := round(coalesce(public._v_num(p, 'estoque', 0, 10000000, 'Estoque atual', true), 0)::numeric, 3);
  v_val date := public._v_data(p, 'validade', true);
  v_local text := case when p ? 'local' then public._v_txt(p, 'local', 0, 40, 'Local') end;
  v_med jsonb;
  atual public.ingredientes; novo public.ingredientes;
begin
  perform public._limitar('estoque_gravar', 60, 60);
  if p ? 'medidas' then
    if jsonb_typeof(p -> 'medidas') <> 'array' or jsonb_array_length(p -> 'medidas') > 8 then
      perform public._falha(422, 'Medidas caseiras: no máximo 8.', 'medidas');
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('nome', public._v_txt(m, 'nome', 1, 20, 'Nome da medida'),
                                                 'qtd', round(public._v_num(m, 'qtd', 0.001, 10000000, 'Quantidade da medida')::numeric, 3))), '[]'::jsonb)
      into v_med from jsonb_array_elements(p -> 'medidas') m;
  end if;
  if exists (select 1 from public.ingredientes where lower(nome) = lower(v_nome) and id is distinct from iid) then
    perform public._falha(409, 'Já existe um ingrediente com esse nome.', 'nome');
  end if;
  if iid is null then
    if (select count(*) from public.ingredientes) >= 1000 then perform public._falha(422, 'Limite de 1000 ingredientes atingido.'); end if;
    insert into public.ingredientes (nome, unidade, estoque, minimo, embalagem_qtd, embalagem_nome, embalagem_preco, fornecedor, ativo, medidas, local)
    values (v_nome, v_un, 0, v_min, v_qtd, v_emb, v_preco, v_forn, v_ativo, coalesce(v_med, '[]'::jsonb), coalesce(v_local, '')) returning * into novo;
    if v_ini > 0 then
      novo := public._estoque_lancar(novo.id, 'inicial', v_ini, adm.id, null, 'Estoque inicial', v_val);
    end if;
  else
    select * into atual from public.ingredientes where id = iid for update;
    if not found then perform public._falha(404, 'Ingrediente não encontrado.'); end if;
    if atual.unidade <> v_un and (exists (select 1 from public.ficha_itens where ingrediente_id = iid)
                                  or exists (select 1 from public.preparo_itens where ingrediente_id = iid)
                                  or exists (select 1 from public.estoque_movimentos where ingrediente_id = iid)) then
      perform public._falha(409, 'Não dá para trocar a unidade de um ingrediente que já tem receita ou histórico. Crie outro ingrediente.', 'unidade');
    end if;
    update public.ingredientes set nome = v_nome, unidade = v_un, minimo = v_min, embalagem_qtd = v_qtd, embalagem_nome = v_emb,
           embalagem_preco = v_preco, fornecedor = v_forn, ativo = v_ativo, medidas = coalesce(v_med, atual.medidas),
           local = coalesce(v_local, atual.local), atualizado_em = now()
     where id = iid returning * into novo;
  end if;
  return jsonb_build_object('ingrediente', public._ingrediente_json(novo));
end $$;

create or replace function public.admin_excluir_ingrediente(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin(); iid bigint := public._v_int(p, 'id', 1, 9223372036854775807, 'Ingrediente'); em text;
begin
  perform public._limitar('estoque_gravar', 60, 60);
  if not exists (select 1 from public.ingredientes where id = iid) then perform public._falha(404, 'Ingrediente não encontrado.'); end if;
  select string_agg(x.nome, ', ') into em from (
    select distinct pr.nome from public.ficha_itens f join public.produtos pr on pr.id = f.produto_id where f.ingrediente_id = iid order by 1 limit 5) x;
  if em is not null then
    perform public._falha(409, 'Este ingrediente é usado na receita de: ' || em || '. Tire-o da receita antes de excluir (ou desative-o).');
  end if;
  select string_agg(x.nome, ', ') into em from (
    select distinct pp.nome from public.preparo_itens pi join public.preparos pp on pp.id = pi.preparo_id where pi.ingrediente_id = iid order by 1 limit 5) x;
  if em is not null then
    perform public._falha(409, 'Este ingrediente é usado na receita-base: ' || em || '. Tire-o de lá antes de excluir (ou desative-o).');
  end if;
  delete from public.ingredientes where id = iid;
  return jsonb_build_object('ok', true);
end $$;

/* ---------- Lançamentos: compra, contagem e perda ---------- */
create or replace function public.admin_estoque_movimentar(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  adm public.perfis := public._admin();
  ing public.ingredientes;
  v_tipo text := public._v_opcao(p, 'tipo', array['compra', 'ajuste', 'perda'], 'Tipo de lançamento');
  v_nota text := public._v_txt(p, 'nota', 0, 200, 'Observação');
  v_val date := public._v_data(p, 'validade', true);
  delta numeric; emb numeric; valor int; alvo numeric; preco_novo int;
begin
  perform public._limitar('estoque_gravar', 60, 60);
  select * into ing from public.ingredientes where id = public._v_int(p, 'ingrediente_id', 1, 9223372036854775807, 'Ingrediente') for update;
  if not found then perform public._falha(404, 'Ingrediente não encontrado.'); end if;

  if v_tipo = 'compra' then
    emb := round(public._v_num(p, 'embalagens', 0.001, 100000, 'Quantidade comprada')::numeric, 3);
    delta := round(emb * ing.embalagem_qtd, 3);
    valor := public._v_int(p, 'valor', 0, 1000000000, 'Valor pago', true);
    if valor is not null and valor > 0 then preco_novo := greatest(round(valor::numeric / emb)::int, 0); end if;
  elsif v_tipo = 'perda' then
    delta := -round(public._v_num(p, 'quantidade', 0.001, 10000000, 'Quantidade perdida')::numeric, 3);
  else
    alvo := round(public._v_num(p, 'novo_estoque', 0, 10000000, 'Quantidade contada')::numeric, 3);
    delta := alvo - ing.estoque;
    if delta = 0 then return jsonb_build_object('ingrediente', public._ingrediente_json(ing), 'sem_mudanca', true); end if;
  end if;

  ing := public._estoque_lancar(ing.id, v_tipo, delta, adm.id, case when v_tipo = 'compra' and valor > 0 then valor end, v_nota, v_val, preco_novo);
  return jsonb_build_object('ingrediente', public._ingrediente_json(ing));
end $$;

-- Compra recebida: vários itens de uma nota de uma vez (tudo ou nada).
create function public.admin_estoque_receber_compra(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  adm public.perfis := public._admin(); itens jsonb := coalesce(p -> 'itens', '[]'::jsonb); it jsonb;
  v_nota text := public._v_txt(p, 'nota', 0, 120, 'Nota ou fornecedor');
  ing public.ingredientes; emb numeric; valor int; preco_novo int; total bigint := 0; n int := 0; vistos bigint[] := '{}'; iid bigint;
begin
  perform public._limitar('estoque_gravar', 60, 60);
  if jsonb_typeof(itens) <> 'array' or jsonb_array_length(itens) = 0 then perform public._falha(422, 'Informe pelo menos um item comprado.', 'itens'); end if;
  if jsonb_array_length(itens) > 60 then perform public._falha(422, 'No máximo 60 itens por compra.', 'itens'); end if;
  for it in select value from jsonb_array_elements(itens) loop
    iid := public._v_int(it, 'ingrediente_id', 1, 9223372036854775807, 'Ingrediente');
    if iid = any (vistos) then perform public._falha(422, 'O mesmo ingrediente aparece duas vezes na compra. Junte em uma linha.', 'itens'); end if;
    vistos := vistos || iid;
    select * into ing from public.ingredientes where id = iid for update;
    if not found then perform public._falha(404, 'Um dos ingredientes não existe mais. Atualize a página.', 'itens'); end if;
    emb := round(public._v_num(it, 'embalagens', 0.001, 100000, 'Quantidade de ' || ing.nome)::numeric, 3);
    valor := public._v_int(it, 'valor', 0, 1000000000, 'Valor de ' || ing.nome, true);
    preco_novo := case when valor is not null and valor > 0 then greatest(round(valor::numeric / emb)::int, 0) end;
    perform public._estoque_lancar(ing.id, 'compra', round(emb * ing.embalagem_qtd, 3), adm.id, case when valor > 0 then valor end, v_nota,
                                   public._v_data(it, 'validade', true), preco_novo);
    total := total + coalesce(valor, 0);
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'itens', n, 'total', total);
end $$;

-- Contagem em lote (contagem guiada): só grava o que mudou.
create function public.admin_estoque_contagem(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  adm public.perfis := public._admin(); itens jsonb := coalesce(p -> 'itens', '[]'::jsonb); r record;
  v_nota text := coalesce(nullif(public._v_txt(p, 'nota', 0, 120, 'Observação'), ''), 'Contagem guiada');
  ing public.ingredientes; alvo numeric; ajustados int := 0; iguais int := 0;
begin
  perform public._limitar('estoque_gravar', 60, 60);
  if jsonb_typeof(itens) <> 'array' or jsonb_array_length(itens) = 0 then perform public._falha(422, 'Nenhuma quantidade contada.', 'itens'); end if;
  if jsonb_array_length(itens) > 400 then perform public._falha(422, 'No máximo 400 itens por contagem.', 'itens'); end if;
  -- em ordem de id, para duas contagens ao mesmo tempo não se travarem
  for r in select (x ->> 'ingrediente_id')::bigint as iid, x as dado
             from jsonb_array_elements(itens) x where (x ->> 'ingrediente_id') ~ '^\d{1,15}$' order by 1 loop
    select * into ing from public.ingredientes where id = r.iid for update;
    if not found then continue; end if;
    alvo := round(public._v_num(r.dado, 'novo_estoque', 0, 10000000, 'Quantidade de ' || ing.nome)::numeric, 3);
    if alvo = ing.estoque then iguais := iguais + 1; continue; end if;
    perform public._estoque_lancar(ing.id, 'ajuste', alvo - ing.estoque, adm.id, null, v_nota);
    ajustados := ajustados + 1;
  end loop;
  return jsonb_build_object('ok', true, 'ajustados', ajustados, 'iguais', iguais);
end $$;

create or replace function public.admin_estoque_configurar(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin(); cfg public.estoque_config;
begin
  perform public._limitar('estoque_gravar', 60, 60);
  update public.estoque_config
     set baixa_automatica = public._v_bool(p, 'baixa_automatica'),
         dias_previsao = coalesce(public._v_int(p, 'dias_previsao', 1, 60, 'Período da previsão', true), dias_previsao),
         dias_validade = coalesce(public._v_int(p, 'dias_validade', 1, 90, 'Aviso de validade', true), dias_validade)
   where id = 1 returning * into cfg;
  return jsonb_build_object('config', jsonb_build_object('baixa_automatica', cfg.baixa_automatica, 'dias_previsao', cfg.dias_previsao, 'dias_validade', cfg.dias_validade));
end $$;

/* ---------- Lotes e validade ---------- */
create function public.admin_estoque_lotes(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  adm public.perfis := public._admin(); cfg public.estoque_config; hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  ing bigint := public._v_int(p, 'ingrediente_id', 1, 9223372036854775807, 'Ingrediente', true);
begin
  perform public._limitar('estoque_ler', 120, 60);
  select * into cfg from public.estoque_config where id = 1;
  return jsonb_build_object('lotes', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', l.id, 'ingrediente_id', i.id, 'ingrediente', i.nome, 'unidade', i.unidade, 'quantidade', l.quantidade,
             'validade', to_char(l.validade, 'YYYY-MM-DD'), 'dias', l.validade - hoje,
             'situacao', case when l.validade < hoje then 'vencido' when l.validade <= hoje + cfg.dias_validade then 'vencendo' else 'ok' end)
           order by l.validade, l.id)
      from public.estoque_lotes l join public.ingredientes i on i.id = l.ingrediente_id
     where ing is null or l.ingrediente_id = ing), '[]'::jsonb));
end $$;

-- Lote vencido ou estragado: sai do estoque como perda.
create function public.admin_estoque_descartar_lote(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin(); l public.estoque_lotes; ing public.ingredientes;
begin
  perform public._limitar('estoque_gravar', 60, 60);
  select * into l from public.estoque_lotes where id = public._v_int(p, 'id', 1, 9223372036854775807, 'Lote') for update;
  if not found then perform public._falha(404, 'Lote não encontrado.'); end if;
  perform 1 from public.ingredientes where id = l.ingrediente_id for update;
  ing := public._estoque_lancar(l.ingrediente_id, 'perda', -l.quantidade, adm.id, null, 'Lote descartado (validade ' || to_char(l.validade, 'DD/MM/YYYY') || ')', null, null, null, false);
  delete from public.estoque_lotes where id = l.id;
  return jsonb_build_object('ingrediente', public._ingrediente_json(ing));
end $$;

/* ==========================================================
   API: receitas-base
   ========================================================== */
create function public._preparo_json(pid bigint) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', p.id, 'nome', p.nome, 'unidade', p.unidade, 'rendimento', p.rendimento, 'perda_pct', p.perda_pct,
    'linhas', coalesce((select jsonb_agg(jsonb_build_object('ingrediente_id', pi.ingrediente_id, 'ingrediente', i.nome, 'unidade', i.unidade, 'quantidade', pi.quantidade) order by pi.id)
                          from public.preparo_itens pi join public.ingredientes i on i.id = pi.ingrediente_id where pi.preparo_id = p.id), '[]'::jsonb),
    'custo_lote', coalesce((select round(sum(pi.quantidade * i.embalagem_preco / i.embalagem_qtd) * (1 + p.perda_pct / 100))
                              from public.preparo_itens pi join public.ingredientes i on i.id = pi.ingrediente_id where pi.preparo_id = p.id), 0),
    'custo_unit', coalesce((select sum(pi.quantidade * i.embalagem_preco / i.embalagem_qtd) * (1 + p.perda_pct / 100) / p.rendimento
                              from public.preparo_itens pi join public.ingredientes i on i.id = pi.ingrediente_id where pi.preparo_id = p.id), 0),
    'usado_em', (select count(distinct f.produto_id) from public.ficha_itens f where f.preparo_id = p.id))
  from public.preparos p where p.id = pid
$$;

create function public.admin_preparos(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin();
begin
  perform public._limitar('estoque_ler', 120, 60);
  return jsonb_build_object('preparos', coalesce((select jsonb_agg(public._preparo_json(x.id) order by lower(x.nome)) from public.preparos x), '[]'::jsonb));
end $$;

create function public.admin_salvar_preparo(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  adm public.perfis := public._admin();
  pid bigint := public._v_int(p, 'id', 1, 9223372036854775807, 'Receita-base', true);
  v_nome text := public._v_txt(p, 'nome', 1, 80, 'Nome');
  v_un text := public._v_opcao(p, 'unidade', array['g', 'ml', 'un'], 'Unidade');
  v_rend numeric := round(coalesce(public._v_num(p, 'rendimento', 0.001, 10000000, 'Rendimento', true), 1)::numeric, 3);
  v_perda numeric := round(coalesce(public._v_num(p, 'perda_pct', 0, 50, 'Perda de preparo', true), 0)::numeric, 2);
  linhas jsonb := coalesce(p -> 'linhas', '[]'::jsonb); l jsonb; iid bigint; nome_ing text; dup text;
begin
  perform public._limitar('estoque_gravar', 60, 60);
  if jsonb_typeof(linhas) <> 'array' or jsonb_array_length(linhas) = 0 then perform public._falha(422, 'Adicione pelo menos um ingrediente.', 'linhas'); end if;
  if jsonb_array_length(linhas) > 40 then perform public._falha(422, 'No máximo 40 ingredientes por receita-base.', 'linhas'); end if;
  if exists (select 1 from public.preparos where lower(nome) = lower(v_nome) and id is distinct from pid) then
    perform public._falha(409, 'Já existe uma receita-base com esse nome.', 'nome');
  end if;
  if pid is not null then
    if not exists (select 1 from public.preparos where id = pid) then perform public._falha(404, 'Receita-base não encontrada.'); end if;
    if exists (select 1 from public.preparos x where x.id = pid and x.unidade <> v_un) and exists (select 1 from public.ficha_itens where preparo_id = pid) then
      perform public._falha(409, 'Não dá para trocar a medida de uma receita-base que já está em receitas de produtos.', 'unidade');
    end if;
  end if;
  for l in select value from jsonb_array_elements(linhas) loop
    iid := public._v_int(l, 'ingrediente_id', 1, 9223372036854775807, 'Ingrediente');
    select nome into nome_ing from public.ingredientes where id = iid;
    if not found then perform public._falha(422, 'Um dos ingredientes não existe mais. Atualize a página.', 'linhas'); end if;
    perform public._v_num(l, 'quantidade', 0.001, 10000000, 'Quantidade de ' || nome_ing);
  end loop;
  select i.nome into dup from jsonb_array_elements(linhas) l2 join public.ingredientes i on i.id = (l2 ->> 'ingrediente_id')::bigint
   group by i.nome having count(*) > 1 limit 1;
  if found then perform public._falha(422, dup || ' aparece duas vezes. Junte as quantidades em uma linha só.', 'linhas'); end if;

  if pid is null then
    if (select count(*) from public.preparos) >= 300 then perform public._falha(422, 'Limite de 300 receitas-base atingido.'); end if;
    insert into public.preparos (nome, unidade, rendimento, perda_pct) values (v_nome, v_un, v_rend, v_perda) returning id into pid;
  else
    update public.preparos set nome = v_nome, unidade = v_un, rendimento = v_rend, perda_pct = v_perda, revisao = revisao + 1, atualizado_em = now() where id = pid;
    delete from public.preparo_itens where preparo_id = pid;
  end if;
  insert into public.preparo_itens (preparo_id, ingrediente_id, quantidade)
  select pid, (l2 ->> 'ingrediente_id')::bigint, round(replace(l2 ->> 'quantidade', ',', '.')::numeric, 3) from jsonb_array_elements(linhas) l2;
  return jsonb_build_object('preparo', public._preparo_json(pid));
end $$;

create function public.admin_excluir_preparo(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin(); pid bigint := public._v_int(p, 'id', 1, 9223372036854775807, 'Receita-base'); em text;
begin
  perform public._limitar('estoque_gravar', 60, 60);
  if not exists (select 1 from public.preparos where id = pid) then perform public._falha(404, 'Receita-base não encontrada.'); end if;
  select string_agg(x.nome, ', ') into em from (
    select distinct pr.nome from public.ficha_itens f join public.produtos pr on pr.id = f.produto_id where f.preparo_id = pid order by 1 limit 5) x;
  if em is not null then perform public._falha(409, 'Esta receita-base é usada em: ' || em || '. Tire-a de lá antes de excluir.'); end if;
  delete from public.preparos where id = pid;
  return jsonb_build_object('ok', true);
end $$;

/* ==========================================================
   API: receitas dos produtos (agora com receita-base e perda)
   ========================================================== */
create or replace function public.admin_receitas(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin();
begin
  perform public._limitar('estoque_ler', 120, 60);
  return jsonb_build_object('produtos', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', pr.id, 'nome', pr.nome, 'categoria', c.nome, 'preco', pr.preco, 'unidade', pr.unidade, 'ativo', pr.ativo,
      'tem_receita', r.produto_id is not null, 'rendimento', r.rendimento, 'perda_pct', r.perda_pct,
      'linhas', (select count(*) from public.ficha_itens f where f.produto_id = pr.id),
      'custo_unit', case when x.n_base > 0 then round(x.custo) end,
      'margem', case when x.n_base > 0 then pr.preco - round(x.custo) end,
      'margem_pct', case when x.n_base > 0 and pr.preco > 0 then round((pr.preco - x.custo) * 100 / pr.preco, 1) end,
      'pode_fazer', case when x.n_base > 0 then x.pode end,
      'limitante', case when x.n_base > 0 then x.limitante end) order by lower(pr.nome))
      from public.produtos pr
      join public.categorias c on c.id = pr.categoria_id
      left join public.receitas r on r.produto_id = pr.id
      left join lateral (
        select count(*) as n_base,
               sum(b.por_unidade * i.embalagem_preco / i.embalagem_qtd) as custo,
               min(floor(greatest(i.estoque, 0) / b.por_unidade)) as pode,
               (select i2.nome from public._receita_base(pr.id) b2 join public.ingredientes i2 on i2.id = b2.ingrediente_id
                 order by floor(greatest(i2.estoque, 0) / b2.por_unidade), i2.nome limit 1) as limitante
          from public._receita_base(pr.id) b join public.ingredientes i on i.id = b.ingrediente_id) x on true), '[]'::jsonb));
end $$;

create or replace function public.admin_receita(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin(); pid bigint := public._v_int(p, 'produto_id', 1, 9223372036854775807, 'Produto'); pr public.produtos; r public.receitas;
begin
  perform public._limitar('estoque_ler', 120, 60);
  select * into pr from public.produtos where id = pid;
  if not found then perform public._falha(404, 'Produto não encontrado.'); end if;
  select * into r from public.receitas where produto_id = pid;
  return jsonb_build_object(
    'produto', jsonb_build_object('id', pr.id, 'nome', pr.nome, 'preco', pr.preco, 'unidade', pr.unidade, 'opcoes', pr.opcoes),
    'rendimento', coalesce(r.rendimento, 1), 'perda_pct', coalesce(r.perda_pct, 0),
    'custo_unit', round(public._receita_custo(pid)),
    'linhas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'ingrediente_id', f.ingrediente_id, 'preparo_id', f.preparo_id,
               'nome', coalesce(i.nome, pp.nome), 'unidade', coalesce(i.unidade, pp.unidade),
               'opcao_grupo', f.opcao_grupo, 'opcao_item', f.opcao_item, 'quantidade', f.quantidade,
               'opcao_existe', f.opcao_grupo is null or exists (
                  select 1 from jsonb_array_elements(pr.opcoes) g, jsonb_array_elements(coalesce(g -> 'itens', '[]'::jsonb)) it
                   where g ->> 'nome' = f.opcao_grupo and it ->> 'nome' = f.opcao_item))
             order by (f.opcao_grupo is not null), f.id)
        from public.ficha_itens f
        left join public.ingredientes i on i.id = f.ingrediente_id
        left join public.preparos pp on pp.id = f.preparo_id
       where f.produto_id = pid), '[]'::jsonb));
end $$;

create or replace function public.admin_salvar_receita(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  adm public.perfis := public._admin();
  pid bigint := public._v_int(p, 'produto_id', 1, 9223372036854775807, 'Produto');
  pr public.produtos; l jsonb; linhas jsonb := coalesce(p -> 'linhas', '[]'::jsonb);
  v_rend numeric := round(coalesce(public._v_num(p, 'rendimento', 0.001, 100000, 'Rendimento', true), 1)::numeric, 3);
  v_perda numeric := round(coalesce(public._v_num(p, 'perda_pct', 0, 50, 'Perda de preparo', true), 0)::numeric, 2);
  ing bigint; prep bigint; grp text; itm text; nome_ref text; dup text;
begin
  perform public._limitar('estoque_gravar', 60, 60);
  select * into pr from public.produtos where id = pid;
  if not found then perform public._falha(404, 'Produto não encontrado.'); end if;
  if jsonb_typeof(linhas) <> 'array' then perform public._falha(422, 'Ingredientes da receita inválidos.', 'linhas'); end if;
  if jsonb_array_length(linhas) > 60 then perform public._falha(422, 'Uma receita pode ter no máximo 60 linhas.', 'linhas'); end if;

  -- confere cada linha antes de gravar qualquer coisa
  for l in select value from jsonb_array_elements(linhas) loop
    ing := case when coalesce(l ->> 'ingrediente_id', '') <> '' then public._v_int(l, 'ingrediente_id', 1, 9223372036854775807, 'Ingrediente') end;
    prep := case when coalesce(l ->> 'preparo_id', '') <> '' then public._v_int(l, 'preparo_id', 1, 9223372036854775807, 'Receita-base') end;
    if (ing is null) = (prep is null) then perform public._falha(422, 'Cada linha precisa de um ingrediente ou de uma receita-base.', 'linhas'); end if;
    if ing is not null then select nome into nome_ref from public.ingredientes where id = ing;
    else select nome into nome_ref from public.preparos where id = prep; end if;
    if not found then perform public._falha(422, 'Um dos itens da receita não existe mais. Atualize a página.', 'linhas'); end if;
    perform public._v_num(l, 'quantidade', 0.001, 10000000, 'Quantidade de ' || nome_ref);
    grp := nullif(btrim(coalesce(l ->> 'opcao_grupo', '')), '');
    itm := nullif(btrim(coalesce(l ->> 'opcao_item', '')), '');
    if (grp is null) <> (itm is null) then perform public._falha(422, 'Opção inválida na linha de ' || nome_ref || '.', 'linhas'); end if;
    if grp is not null and not exists (
         select 1 from jsonb_array_elements(pr.opcoes) g, jsonb_array_elements(coalesce(g -> 'itens', '[]'::jsonb)) it
          where g ->> 'nome' = grp and it ->> 'nome' = itm) then
      perform public._falha(422, 'A opção "' || grp || ' — ' || itm || '" não existe neste produto.', 'linhas');
    end if;
  end loop;
  select x.nome into dup from (
    select coalesce(i.nome, pp.nome) as nome, count(*) as n
      from jsonb_array_elements(linhas) l2
      left join public.ingredientes i on i.id = nullif(l2 ->> 'ingrediente_id', '')::bigint
      left join public.preparos pp on pp.id = nullif(l2 ->> 'preparo_id', '')::bigint
     group by coalesce('i' || (l2 ->> 'ingrediente_id'), 'p' || (l2 ->> 'preparo_id')), coalesce(i.nome, pp.nome),
              coalesce(nullif(btrim(l2 ->> 'opcao_grupo'), ''), ''), coalesce(nullif(btrim(l2 ->> 'opcao_item'), ''), '')) x
   where x.n > 1 limit 1;
  if found then perform public._falha(422, dup || ' aparece duas vezes na mesma situação. Junte as quantidades em uma linha só.', 'linhas'); end if;

  if jsonb_array_length(linhas) = 0 then
    delete from public.receitas where produto_id = pid;
    return jsonb_build_object('ok', true, 'removida', true);
  end if;

  insert into public.receitas (produto_id, rendimento, perda_pct) values (pid, v_rend, v_perda)
  on conflict (produto_id) do update set rendimento = excluded.rendimento, perda_pct = excluded.perda_pct, revisao = public.receitas.revisao + 1, atualizado_em = now();
  delete from public.ficha_itens where produto_id = pid;
  insert into public.ficha_itens (produto_id, ingrediente_id, preparo_id, opcao_grupo, opcao_item, quantidade)
  select pid, nullif(l2 ->> 'ingrediente_id', '')::bigint, nullif(l2 ->> 'preparo_id', '')::bigint,
         nullif(btrim(l2 ->> 'opcao_grupo'), ''), nullif(btrim(l2 ->> 'opcao_item'), ''), round(replace(l2 ->> 'quantidade', ',', '.')::numeric, 3)
    from jsonb_array_elements(linhas) l2;
  return jsonb_build_object('ok', true, 'custo_unit', round(public._receita_custo(pid)));
end $$;

/* ==========================================================
   API: previsão (agora com fornecedor e validades)
   ========================================================== */
create or replace function public.admin_estoque_previsao(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  adm public.perfis := public._admin(); cfg public.estoque_config;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  janela int; fim date; ids bigint[]; n_ped int; lista jsonb; sem jsonb; venc jsonb; resumo jsonb;
begin
  perform public._limitar('estoque_ler', 120, 60);
  select * into cfg from public.estoque_config where id = 1;
  janela := coalesce(public._v_int(p, 'dias', 1, 60, 'Período', true), cfg.dias_previsao);
  fim := hoje + janela;
  ids := public._estoque_pedidos_pendentes(fim);
  n_ped := coalesce(array_length(ids, 1), 0);

  with c as (
    select x.produto_id, x.ingrediente_id, greatest(x.dia, hoje) as dia, x.quantidade from public._estoque_consumo(ids) x
  ), por_dia as (
    select ingrediente_id, dia, sum(quantidade) as q from c group by ingrediente_id, dia
  ), acum as (
    select ingrediente_id, dia, q, sum(q) over (partition by ingrediente_id order by dia) as a from por_dia
  ), tot as (
    select ingrediente_id, sum(q) as necessario,
           jsonb_agg(jsonb_build_object('data', to_char(dia, 'YYYY-MM-DD'), 'qtd', q, 'acumulado', a) order by dia) as dias_uso
      from acum group by ingrediente_id
  ), prods as (
    select s.ingrediente_id, jsonb_agg(jsonb_build_object('nome', pr.nome, 'qtd', s.q) order by s.q desc, pr.nome) as usado_em
      from (select ingrediente_id, produto_id, sum(quantidade) as q from c group by ingrediente_id, produto_id) s
      join public.produtos pr on pr.id = s.produto_id
     group by s.ingrediente_id
  ), linhas as (
    select i.id, i.nome, i.unidade, i.estoque, i.minimo, i.embalagem_qtd, i.embalagem_nome, i.embalagem_preco, i.fornecedor, i.ativo,
           coalesce(t.necessario, 0) as necessario, coalesce(t.dias_uso, '[]'::jsonb) as dias_uso, coalesce(pd.usado_em, '[]'::jsonb) as usado_em,
           i.estoque - coalesce(t.necessario, 0) as saldo,
           (select min(a2.dia) from acum a2 where a2.ingrediente_id = i.id and a2.a > i.estoque) as falta_dia
      from public.ingredientes i
      left join tot t on t.ingrediente_id = i.id
      left join prods pd on pd.ingrediente_id = i.id
     where i.ativo or t.necessario is not null
  ), calc as (
    select l.*,
           case when l.saldo < 0 then 'faltando' when l.minimo > 0 and l.saldo < l.minimo then 'baixo' else 'ok' end as situacao,
           ceil(greatest(0, l.minimo + l.necessario - l.estoque) / l.embalagem_qtd) as embalagens
      from linhas l
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', k.id, 'nome', k.nome, 'unidade', k.unidade, 'estoque', k.estoque, 'minimo', k.minimo, 'fornecedor', k.fornecedor,
           'necessario', k.necessario, 'saldo', k.saldo, 'situacao', k.situacao,
           'falta_em', case when k.falta_dia is not null then to_char(k.falta_dia, 'YYYY-MM-DD') end,
           'embalagem_nome', k.embalagem_nome, 'embalagem_qtd', k.embalagem_qtd, 'embalagem_preco', k.embalagem_preco,
           'comprar_embalagens', k.embalagens, 'comprar_qtd', k.embalagens * k.embalagem_qtd,
           'comprar_valor', (k.embalagens * k.embalagem_preco)::bigint,
           'dias', k.dias_uso, 'usado_em', k.usado_em)
         order by case k.situacao when 'faltando' then 0 when 'baixo' then 1 else 2 end, lower(k.nome)), '[]'::jsonb)
    into lista from calc k;

  select coalesce(jsonb_agg(jsonb_build_object('produto_id', s.produto_id, 'nome', s.nome, 'qtd', s.q) order by s.q desc, s.nome), '[]'::jsonb) into sem
    from (select i.produto_id, i.nome, sum(i.qtd) as q
            from public.pedido_itens i
           where i.pedido_id = any (ids)
             and not exists (select 1 from public.receitas r where r.produto_id = i.produto_id)
           group by i.produto_id, i.nome) s;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', l.id, 'ingrediente_id', i.id, 'ingrediente', i.nome, 'unidade', i.unidade, 'quantidade', l.quantidade,
           'validade', to_char(l.validade, 'YYYY-MM-DD'), 'dias', l.validade - hoje) order by l.validade, i.nome), '[]'::jsonb)
    into venc
    from public.estoque_lotes l join public.ingredientes i on i.id = l.ingrediente_id
   where l.validade <= hoje + cfg.dias_validade;

  select jsonb_build_object(
           'faltando', count(*) filter (where x ->> 'situacao' = 'faltando'),
           'baixo', count(*) filter (where x ->> 'situacao' = 'baixo'),
           'ok', count(*) filter (where x ->> 'situacao' = 'ok'),
           'a_comprar', count(*) filter (where (x ->> 'comprar_embalagens')::numeric > 0),
           'valor_compras', coalesce(sum((x ->> 'comprar_valor')::bigint), 0),
           'vencidos', (select count(*) from jsonb_array_elements(venc) v where (v ->> 'dias')::int < 0),
           'vencendo', (select count(*) from jsonb_array_elements(venc) v where (v ->> 'dias')::int >= 0))
    into resumo from jsonb_array_elements(lista) x;

  return jsonb_build_object('de', to_char(hoje, 'YYYY-MM-DD'), 'ate', to_char(fim, 'YYYY-MM-DD'), 'dias', janela, 'pedidos', n_ped,
                            'dias_validade', cfg.dias_validade, 'itens', lista, 'sem_receita', sem, 'vencimentos', venc, 'resumo', resumo);
end $$;

/* ==========================================================
   API: simulador — "quanto preciso para fazer isto?"
   ========================================================== */
create function public.admin_estoque_simular(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  adm public.perfis := public._admin(); cfg public.estoque_config; hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  itens jsonb := coalesce(p -> 'itens', '[]'::jsonb); it jsonb; ids bigint[]; lista jsonb; prods jsonb; sem jsonb; total_custo numeric; total_compra bigint;
begin
  perform public._limitar('estoque_ler', 120, 60);
  select * into cfg from public.estoque_config where id = 1;
  if jsonb_typeof(itens) <> 'array' or jsonb_array_length(itens) = 0 then perform public._falha(422, 'Adicione pelo menos um produto.', 'itens'); end if;
  if jsonb_array_length(itens) > 30 then perform public._falha(422, 'No máximo 30 produtos por simulação.', 'itens'); end if;
  for it in select value from jsonb_array_elements(itens) loop
    perform public._v_int(it, 'produto_id', 1, 9223372036854775807, 'Produto');
    perform public._v_num(it, 'qtd', 0.001, 100000, 'Quantidade');
    if not exists (select 1 from public.produtos where id = (it ->> 'produto_id')::bigint) then perform public._falha(404, 'Um dos produtos não existe mais. Atualize a página.', 'itens'); end if;
  end loop;
  ids := public._estoque_pedidos_pendentes(hoje + cfg.dias_previsao);

  with pedido as (
    select (x ->> 'produto_id')::bigint as prod, replace(x ->> 'qtd', ',', '.')::numeric as qtd, coalesce(x -> 'opcoes', '[]'::jsonb) as opcoes
      from jsonb_array_elements(itens) x
  ), cons as (
    select c.ingrediente_id, sum(c.quantidade) as q
      from pedido pe cross join lateral public._consumo_item(pe.prod, pe.qtd, pe.opcoes) c group by c.ingrediente_id
  ), comp as (
    select c.ingrediente_id, sum(c.quantidade) as q from public._estoque_consumo(ids) c group by c.ingrediente_id
  ), calc as (
    select i.*, cons.q as necessario, coalesce(comp.q, 0) as comprometido, i.estoque - coalesce(comp.q, 0) as livre,
           greatest(0, cons.q - greatest(i.estoque - coalesce(comp.q, 0), 0)) as falta
      from cons join public.ingredientes i on i.id = cons.ingrediente_id left join comp on comp.ingrediente_id = i.id
  ), fim as (
    select k.*, ceil(k.falta / k.embalagem_qtd) as embalagens, k.necessario * k.embalagem_preco / k.embalagem_qtd as custo from calc k
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', f.id, 'nome', f.nome, 'unidade', f.unidade, 'necessario', round(f.necessario, 3), 'estoque', f.estoque, 'comprometido', round(f.comprometido, 3),
           'livre', round(f.livre, 3), 'falta', round(f.falta, 3), 'fornecedor', f.fornecedor,
           'embalagem_nome', f.embalagem_nome, 'embalagem_qtd', f.embalagem_qtd, 'embalagem_preco', f.embalagem_preco,
           'comprar_embalagens', f.embalagens, 'comprar_qtd', f.embalagens * f.embalagem_qtd,
           'comprar_valor', (f.embalagens * f.embalagem_preco)::bigint, 'custo', round(f.custo))
         order by (f.falta > 0) desc, lower(f.nome)), '[]'::jsonb),
         coalesce(round(sum(f.custo)), 0), coalesce(sum((f.embalagens * f.embalagem_preco)::bigint), 0)
    into lista, total_custo, total_compra from fim f;

  select coalesce(jsonb_agg(jsonb_build_object(
           'produto_id', pr.id, 'nome', pr.nome, 'qtd', x.qtd, 'tem_receita', r.produto_id is not null,
           'custo', (select round(sum(c.quantidade * i.embalagem_preco / i.embalagem_qtd))
                       from public._consumo_item(pr.id, x.qtd, x.opcoes) c join public.ingredientes i on i.id = c.ingrediente_id))), '[]'::jsonb)
    into prods
    from (select (e ->> 'produto_id')::bigint as prod, replace(e ->> 'qtd', ',', '.')::numeric as qtd, coalesce(e -> 'opcoes', '[]'::jsonb) as opcoes
            from jsonb_array_elements(itens) e) x
    join public.produtos pr on pr.id = x.prod
    left join public.receitas r on r.produto_id = pr.id;

  select coalesce(jsonb_agg(x ->> 'nome'), '[]'::jsonb) into sem from jsonb_array_elements(prods) x where (x ->> 'tem_receita')::boolean = false;

  return jsonb_build_object('itens', lista, 'produtos', prods, 'sem_receita', sem, 'custo_total', total_custo, 'comprar_valor', total_compra,
                            'faltam', (select count(*) from jsonb_array_elements(lista) x where (x ->> 'falta')::numeric > 0),
                            'dias_previsao', cfg.dias_previsao);
end $$;

/* ---------- Permissões (as funções novas nascem trancadas) ---------- */
grant execute on function
  public.admin_estoque_receber_compra(jsonb), public.admin_estoque_contagem(jsonb),
  public.admin_estoque_lotes(jsonb), public.admin_estoque_descartar_lote(jsonb),
  public.admin_preparos(jsonb), public.admin_salvar_preparo(jsonb), public.admin_excluir_preparo(jsonb),
  public.admin_estoque_simular(jsonb)
to authenticated;
