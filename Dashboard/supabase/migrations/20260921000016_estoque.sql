-- ==========================================================
-- 16) ESTOQUE: INGREDIENTES, RECEITAS E PREVISÃO DE COMPRAS
--     - ingredientes com quantidade em estoque, mínimo e embalagem de compra
--     - receita (ficha técnica) de cada produto, com acréscimos por opção escolhida
--     - baixa automática quando o pedido entra em preparo (e devolução se cancelar)
--     - previsão: compara os pedidos agendados com o estoque e monta a lista de compras
--     - histórico de tudo que entrou e saiu
--
--     Só o administrador vê e mexe (há custos e margens). Quantidades ficam na
--     unidade do ingrediente: g, ml ou un. Valores em centavos.
-- ==========================================================

/* ---------- Tabelas ---------- */
create table public.ingredientes (
  id             bigint generated always as identity primary key,
  nome           text not null,
  unidade        text not null check (unidade in ('g', 'ml', 'un')),
  estoque        numeric(14, 3) not null default 0,
  minimo         numeric(14, 3) not null default 0 check (minimo >= 0),
  embalagem_qtd  numeric(14, 3) not null default 1 check (embalagem_qtd > 0),
  embalagem_nome text not null default 'embalagem',
  embalagem_preco int not null default 0 check (embalagem_preco >= 0),
  fornecedor     text not null default '',
  ativo          boolean not null default true,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
create unique index ingredientes_nome_idx on public.ingredientes (lower(nome));

-- Uma receita por produto. As quantidades da receita (linhas sem opção) valem para `rendimento` unidades vendidas.
create table public.receitas (
  produto_id    bigint primary key references public.produtos (id) on delete cascade,
  rendimento    numeric(10, 3) not null default 1 check (rendimento > 0),
  revisao       int not null default 1,
  atualizado_em timestamptz not null default now()
);

-- Cada linha: quanto de um ingrediente entra na receita. Com opção (grupo + item, como no pedido):
-- é o acréscimo POR UNIDADE quando o cliente escolhe essa opção.
create table public.ficha_itens (
  id             bigint generated always as identity primary key,
  produto_id     bigint not null references public.receitas (produto_id) on delete cascade,
  ingrediente_id bigint not null references public.ingredientes (id) on delete restrict,
  opcao_grupo    text,
  opcao_item     text,
  quantidade     numeric(14, 3) not null check (quantidade > 0),
  check ((opcao_grupo is null) = (opcao_item is null))
);
create unique index ficha_itens_unica_idx on public.ficha_itens (produto_id, ingrediente_id, coalesce(opcao_grupo, ''), coalesce(opcao_item, ''));
create index ficha_itens_ingrediente_idx on public.ficha_itens (ingrediente_id);

-- Tudo que entra (+) e sai (-) do estoque, com o saldo depois do lançamento.
create table public.estoque_movimentos (
  id             bigint generated always as identity primary key,
  ingrediente_id bigint not null references public.ingredientes (id) on delete cascade,
  tipo           text not null check (tipo in ('inicial', 'compra', 'uso', 'devolucao', 'ajuste', 'perda')),
  quantidade     numeric(14, 3) not null,
  saldo          numeric(14, 3) not null,
  valor          int,
  pedido_id      bigint references public.pedidos (id) on delete set null,
  nota           text not null default '',
  usuario_id     uuid references public.perfis (id) on delete set null,
  criado_em      timestamptz not null default now()
);
create index estoque_movimentos_ing_idx on public.estoque_movimentos (ingrediente_id, id desc);
create index estoque_movimentos_pedido_idx on public.estoque_movimentos (pedido_id);

-- O que já saiu do estoque por causa de um pedido (existe enquanto o pedido está "baixado").
create table public.estoque_baixas (
  pedido_id bigint primary key references public.pedidos (id) on delete cascade,
  itens     jsonb not null,
  criado_em timestamptz not null default now()
);

create table public.estoque_config (
  id               int primary key default 1 check (id = 1),
  baixa_automatica boolean not null default true,
  dias_previsao    int not null default 7 check (dias_previsao between 1 and 60)
);
insert into public.estoque_config default values;

alter table public.ingredientes enable row level security;
alter table public.receitas enable row level security;
alter table public.ficha_itens enable row level security;
alter table public.estoque_movimentos enable row level security;
alter table public.estoque_baixas enable row level security;
alter table public.estoque_config enable row level security;
revoke all on public.ingredientes, public.receitas, public.ficha_itens, public.estoque_movimentos, public.estoque_baixas, public.estoque_config
  from anon, authenticated;

/* ---------- Auditoria: quem mexeu em ingredientes, receitas e ajustes ---------- */
-- (a mesma função de antes, agora sabendo dar nome à receita e à configuração do estoque)
create or replace function public._auditar() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid(); nome text; velha jsonb; nova jsonb; ref jsonb; diff jsonb := '{}'::jsonb; k text; texto text;
begin
  if uid is null then return coalesce(new, old); end if;
  velha := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  nova  := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  ref := coalesce(nova, velha);

  if tg_table_name = 'perfis' then
    -- só mudanças de papel ou de acesso (e nunca a exclusão da conta: os dados pessoais saem de vez)
    if tg_op <> 'UPDATE' or (velha ->> 'papel' is not distinct from nova ->> 'papel' and velha ->> 'ativo' is not distinct from nova ->> 'ativo') then
      return coalesce(new, old);
    end if;
    ref := jsonb_build_object('id', ref ->> 'id', 'nome', ref ->> 'nome');
    if velha ->> 'papel' is distinct from nova ->> 'papel' then
      diff := diff || jsonb_build_object('papel', jsonb_build_object('de', velha ->> 'papel', 'para', nova ->> 'papel'));
    end if;
    if velha ->> 'ativo' is distinct from nova ->> 'ativo' then
      diff := diff || jsonb_build_object('ativo', jsonb_build_object('de', velha ->> 'ativo', 'para', nova ->> 'ativo'));
    end if;
  elsif tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(nova) loop
      if k not in ('atualizado_em', 'ultimo_acesso') and nova -> k is distinct from velha -> k then
        diff := diff || jsonb_build_object(k, jsonb_build_object('de', left(coalesce(velha ->> k, ''), 120), 'para', left(coalesce(nova ->> k, ''), 120)));
      end if;
    end loop;
    if diff = '{}'::jsonb then return new; end if;
  end if;

  texto := case tg_table_name
    when 'pagamentos_pedido' then 'Pedido ' || (ref ->> 'pedido_id') || ' — ' || public._brl((ref ->> 'valor')::bigint)
    when 'receitas' then coalesce((select pr.nome from public.produtos pr where pr.id = (ref ->> 'produto_id')::bigint), 'Produto ' || (ref ->> 'produto_id'))
    when 'estoque_config' then 'baixa e previsão'
    else left(coalesce(nullif(ref ->> 'nome', ''), nullif(ref ->> 'codigo', ''), nullif(ref ->> 'chave', ''), nullif(ref ->> 'data', ''), ref ->> 'id', ''), 120) end;
  select p.nome into nome from public.perfis p where p.id = uid;
  insert into public.auditoria (usuario_id, usuario_nome, tabela, operacao, registro, resumo, detalhes)
  values (uid, coalesce(nome, ''), tg_table_name, case tg_op when 'INSERT' then 'criou' when 'UPDATE' then 'alterou' else 'removeu' end,
          coalesce(ref ->> 'id', ref ->> 'produto_id', ref ->> 'chave', ref ->> 'data', ''), texto, diff);
  return coalesce(new, old);
end $$;

-- Só mudanças de cadastro entram na auditoria; a quantidade em estoque muda a toda hora e tem o histórico próprio.
create trigger auditar_ingredientes after insert or delete on public.ingredientes for each row execute function public._auditar();
create trigger auditar_ingredientes_dados after update of nome, unidade, minimo, embalagem_qtd, embalagem_nome, embalagem_preco, fornecedor, ativo
  on public.ingredientes for each row execute function public._auditar();
create trigger auditar_receitas after insert or update or delete on public.receitas for each row execute function public._auditar();
create trigger auditar_estoque_config after update on public.estoque_config for each row execute function public._auditar();

/* ---------- Ajudantes internos (ninguém de fora executa) ---------- */
create function public._ingrediente_json(i public.ingredientes) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', i.id, 'nome', i.nome, 'unidade', i.unidade, 'estoque', i.estoque, 'minimo', i.minimo,
    'embalagem_qtd', i.embalagem_qtd, 'embalagem_nome', i.embalagem_nome, 'embalagem_preco', i.embalagem_preco,
    'fornecedor', i.fornecedor, 'ativo', i.ativo,
    'custo_unit', round(i.embalagem_preco::numeric / i.embalagem_qtd, 6),
    'valor_estoque', round(greatest(i.estoque, 0) * i.embalagem_preco / i.embalagem_qtd),
    'receitas', (select count(distinct f.produto_id) from public.ficha_itens f where f.ingrediente_id = i.id))
$$;

-- Quanto de cada ingrediente os pedidos indicados vão gastar (receita ÷ rendimento × quantidade + acréscimos das opções).
create function public._estoque_consumo(pids bigint[])
returns table (pedido_id bigint, dia date, produto_id bigint, ingrediente_id bigint, quantidade numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  select o.id, o.data_agendada, i.produto_id, f.ingrediente_id,
         round(sum(i.qtd * f.quantidade / case when f.opcao_grupo is null then r.rendimento else 1 end), 3)
    from public.pedidos o
    join public.pedido_itens i on i.pedido_id = o.id
    join public.receitas r on r.produto_id = i.produto_id
    join public.ficha_itens f on f.produto_id = r.produto_id
   where o.id = any (pids)
     and (f.opcao_grupo is null or exists (
            select 1 from jsonb_array_elements(coalesce(i.opcoes, '[]'::jsonb)) g, jsonb_array_elements(coalesce(g -> 'itens', '[]'::jsonb)) it
             where g ->> 'grupo' = f.opcao_grupo and it ->> 'nome' = f.opcao_item))
   group by o.id, o.data_agendada, i.produto_id, f.ingrediente_id
$$;

-- Desconta do estoque o que o pedido usa (uma vez só por pedido).
create function public._estoque_baixar(pid bigint, uid uuid) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare cfg public.estoque_config; r record; ped public.pedidos; saldo_novo numeric; lista jsonb := '[]'::jsonb; quem uuid;
begin
  select pf.id into quem from public.perfis pf where pf.id = uid and pf.papel <> 'cliente';
  select * into cfg from public.estoque_config where id = 1;
  if not cfg.baixa_automatica then return; end if;
  if exists (select 1 from public.estoque_baixas where pedido_id = pid) then return; end if;
  select * into ped from public.pedidos where id = pid;
  for r in select c.ingrediente_id as ing, sum(c.quantidade) as q from public._estoque_consumo(array[pid]) c group by c.ingrediente_id order by c.ingrediente_id loop
    update public.ingredientes set estoque = estoque - r.q, atualizado_em = now() where id = r.ing returning estoque into saldo_novo;
    insert into public.estoque_movimentos (ingrediente_id, tipo, quantidade, saldo, pedido_id, nota, usuario_id)
    values (r.ing, 'uso', -r.q, saldo_novo, pid, 'Pedido ' || coalesce(ped.codigo, pid::text), quem);
    lista := lista || jsonb_build_array(jsonb_build_object('ingrediente_id', r.ing, 'quantidade', r.q));
  end loop;
  if jsonb_array_length(lista) > 0 then
    insert into public.estoque_baixas (pedido_id, itens) values (pid, lista);
  end if;
end $$;

-- Pedido cancelado: o que tinha saído volta para o estoque.
create function public._estoque_devolver(pid bigint, uid uuid) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare lista jsonb; r record; ped public.pedidos; saldo_novo numeric; quem uuid;
begin
  select pf.id into quem from public.perfis pf where pf.id = uid and pf.papel <> 'cliente';
  select b.itens into lista from public.estoque_baixas b where b.pedido_id = pid for update;
  if not found then return; end if;
  select * into ped from public.pedidos where id = pid;
  for r in select (x ->> 'ingrediente_id')::bigint as ing, (x ->> 'quantidade')::numeric as q
             from jsonb_array_elements(lista) x order by 1 loop
    update public.ingredientes set estoque = estoque + r.q, atualizado_em = now() where id = r.ing returning estoque into saldo_novo;
    if found then
      insert into public.estoque_movimentos (ingrediente_id, tipo, quantidade, saldo, pedido_id, nota, usuario_id)
      values (r.ing, 'devolucao', r.q, saldo_novo, pid, 'Pedido ' || coalesce(ped.codigo, pid::text) || ' cancelado', quem);
    end if;
  end loop;
  delete from public.estoque_baixas where pedido_id = pid;
end $$;

-- A mudança de status agora também mexe no estoque (o resto é igual ao que já existia).
create or replace function public._mudar_status(pid bigint, novo text, nota text, uid uuid) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare ped public.pedidos; obs text := left(btrim(coalesce(nota, '')), 300);
begin
  select * into ped from public.pedidos where id = pid for update;
  if not found then perform public._falha(404, 'Pedido não encontrado.'); end if;
  if not (novo = any (public._proximos(ped.status, ped.tipo))) then
    perform public._falha(409, 'Não é possível mudar de "' || public._status_texto(ped.status, ped.tipo)
      || '" para "' || public._status_texto(novo, ped.tipo) || '".');
  end if;
  if novo = 'cancelado' and obs = '' then
    perform public._falha(422, 'Informe o motivo do cancelamento.', 'nota');
  end if;
  update public.pedidos set status = novo, atualizado_em = now(),
         motivo_cancelamento = case when novo = 'cancelado' then obs else motivo_cancelamento end
   where id = pid;
  insert into public.pedido_historico (pedido_id, status, nota, usuario_id) values (pid, novo, nullif(obs, ''), uid);
  -- pedido cancelado devolve o uso do cupom
  if novo = 'cancelado' and ped.cupom is not null then
    update public.cupons set usos = greatest(usos - 1, 0) where upper(codigo) = upper(ped.cupom);
  end if;
  -- estoque: sai quando o preparo começa e volta se o pedido for cancelado
  if novo in ('em_preparo', 'pronto', 'saiu_entrega', 'entregue') then
    perform public._estoque_baixar(pid, uid);
  elsif novo = 'cancelado' then
    perform public._estoque_devolver(pid, uid);
  end if;
end $$;

/* ---------- API: ingredientes ---------- */
create function public.admin_ingredientes(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin(); cfg public.estoque_config;
begin
  perform public._limitar('estoque_ler', 120, 60);
  select * into cfg from public.estoque_config where id = 1;
  return jsonb_build_object(
    'config', jsonb_build_object('baixa_automatica', cfg.baixa_automatica, 'dias_previsao', cfg.dias_previsao),
    'ingredientes', coalesce((select jsonb_agg(public._ingrediente_json(i) order by lower(i.nome)) from public.ingredientes i), '[]'::jsonb));
end $$;

create function public.admin_salvar_ingrediente(p jsonb) returns jsonb
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
  atual public.ingredientes; novo public.ingredientes;
begin
  perform public._limitar('estoque_gravar', 60, 60);
  if exists (select 1 from public.ingredientes where lower(nome) = lower(v_nome) and id is distinct from iid) then
    perform public._falha(409, 'Já existe um ingrediente com esse nome.', 'nome');
  end if;
  if iid is null then
    if (select count(*) from public.ingredientes) >= 1000 then perform public._falha(422, 'Limite de 1000 ingredientes atingido.'); end if;
    insert into public.ingredientes (nome, unidade, estoque, minimo, embalagem_qtd, embalagem_nome, embalagem_preco, fornecedor, ativo)
    values (v_nome, v_un, v_ini, v_min, v_qtd, v_emb, v_preco, v_forn, v_ativo) returning * into novo;
    if v_ini > 0 then
      insert into public.estoque_movimentos (ingrediente_id, tipo, quantidade, saldo, nota, usuario_id)
      values (novo.id, 'inicial', v_ini, v_ini, 'Estoque inicial', adm.id);
    end if;
  else
    select * into atual from public.ingredientes where id = iid for update;
    if not found then perform public._falha(404, 'Ingrediente não encontrado.'); end if;
    if atual.unidade <> v_un and (exists (select 1 from public.ficha_itens where ingrediente_id = iid)
                                  or exists (select 1 from public.estoque_movimentos where ingrediente_id = iid)) then
      perform public._falha(409, 'Não dá para trocar a unidade de um ingrediente que já tem receita ou histórico. Crie outro ingrediente.', 'unidade');
    end if;
    update public.ingredientes set nome = v_nome, unidade = v_un, minimo = v_min, embalagem_qtd = v_qtd, embalagem_nome = v_emb,
           embalagem_preco = v_preco, fornecedor = v_forn, ativo = v_ativo, atualizado_em = now()
     where id = iid returning * into novo;
  end if;
  return jsonb_build_object('ingrediente', public._ingrediente_json(novo));
end $$;

create function public.admin_excluir_ingrediente(p jsonb) returns jsonb
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
  delete from public.ingredientes where id = iid;
  return jsonb_build_object('ok', true);
end $$;

/* ---------- API: entrada, contagem e perda ---------- */
create function public.admin_estoque_movimentar(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  adm public.perfis := public._admin();
  ing public.ingredientes;
  v_tipo text := public._v_opcao(p, 'tipo', array['compra', 'ajuste', 'perda'], 'Tipo de lançamento');
  v_nota text := public._v_txt(p, 'nota', 0, 200, 'Observação');
  delta numeric; emb numeric; valor int; alvo numeric; preco_novo int;
begin
  perform public._limitar('estoque_gravar', 60, 60);
  select * into ing from public.ingredientes where id = public._v_int(p, 'ingrediente_id', 1, 9223372036854775807, 'Ingrediente') for update;
  if not found then perform public._falha(404, 'Ingrediente não encontrado.'); end if;
  preco_novo := ing.embalagem_preco;

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

  update public.ingredientes set estoque = estoque + delta, atualizado_em = now() where id = ing.id returning * into ing;
  -- o preço da embalagem só entra na auditoria quando realmente muda
  if preco_novo <> ing.embalagem_preco then
    update public.ingredientes set embalagem_preco = preco_novo where id = ing.id returning * into ing;
  end if;
  insert into public.estoque_movimentos (ingrediente_id, tipo, quantidade, saldo, valor, nota, usuario_id)
  values (ing.id, v_tipo, delta, ing.estoque, case when v_tipo = 'compra' and valor > 0 then valor end, v_nota, adm.id);
  return jsonb_build_object('ingrediente', public._ingrediente_json(ing));
end $$;

create function public.admin_estoque_historico(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  adm public.perfis := public._admin();
  ing bigint := public._v_int(p, 'ingrediente_id', 1, 9223372036854775807, 'Ingrediente', true);
  lim int := coalesce(public._v_int(p, 'limite', 1, 300, 'Limite', true), 100);
begin
  perform public._limitar('estoque_ler', 120, 60);
  return jsonb_build_object('itens', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', m.id, 'quando', public._fmt(m.criado_em), 'ingrediente_id', m.ingrediente_id, 'ingrediente', i.nome, 'unidade', i.unidade,
             'tipo', m.tipo, 'quantidade', m.quantidade, 'saldo', m.saldo, 'valor', m.valor, 'pedido', o.codigo, 'nota', m.nota, 'usuario', u.nome)
           order by m.id desc)
      from (select * from public.estoque_movimentos x where ing is null or x.ingrediente_id = ing order by x.id desc limit lim) m
      join public.ingredientes i on i.id = m.ingrediente_id
      left join public.pedidos o on o.id = m.pedido_id
      left join public.perfis u on u.id = m.usuario_id), '[]'::jsonb));
end $$;

create function public.admin_estoque_configurar(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin(); cfg public.estoque_config;
begin
  perform public._limitar('estoque_gravar', 60, 60);
  update public.estoque_config
     set baixa_automatica = public._v_bool(p, 'baixa_automatica'),
         dias_previsao = coalesce(public._v_int(p, 'dias_previsao', 1, 60, 'Período da previsão', true), dias_previsao)
   where id = 1 returning * into cfg;
  return jsonb_build_object('config', jsonb_build_object('baixa_automatica', cfg.baixa_automatica, 'dias_previsao', cfg.dias_previsao));
end $$;

/* ---------- API: receitas ---------- */
-- Custo de uma unidade vendida (sem opções), em centavos com casas decimais.
create function public._receita_custo(pid bigint) returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(f.quantidade / r.rendimento * i.embalagem_preco / i.embalagem_qtd), 0)
    from public.receitas r join public.ficha_itens f on f.produto_id = r.produto_id join public.ingredientes i on i.id = f.ingrediente_id
   where r.produto_id = pid and f.opcao_grupo is null
$$;

-- Todos os produtos: tem receita? quanto custa fazer? quanto sobra? dá para fazer quantos com o estoque de hoje?
create function public.admin_receitas(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin();
begin
  perform public._limitar('estoque_ler', 120, 60);
  return jsonb_build_object('produtos', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', pr.id, 'nome', pr.nome, 'categoria', c.nome, 'preco', pr.preco, 'unidade', pr.unidade, 'ativo', pr.ativo,
      'tem_receita', r.produto_id is not null, 'rendimento', r.rendimento, 'linhas', coalesce(x.n, 0),
      'custo_unit', case when x.n_base > 0 then round(x.custo) end,
      'margem', case when x.n_base > 0 then pr.preco - round(x.custo) end,
      'margem_pct', case when x.n_base > 0 and pr.preco > 0 then round((pr.preco - x.custo) * 100 / pr.preco, 1) end,
      'pode_fazer', case when x.n_base > 0 then x.pode end,
      'limitante', case when x.n_base > 0 then x.limitante end) order by lower(pr.nome))
      from public.produtos pr
      join public.categorias c on c.id = pr.categoria_id
      left join public.receitas r on r.produto_id = pr.id
      left join lateral (
        select count(*) as n, count(*) filter (where f.opcao_grupo is null) as n_base,
               sum(f.quantidade / r.rendimento * i.embalagem_preco / i.embalagem_qtd) filter (where f.opcao_grupo is null) as custo,
               min(floor(greatest(i.estoque, 0) / (f.quantidade / r.rendimento))) filter (where f.opcao_grupo is null) as pode,
               (select i2.nome from public.ficha_itens f2 join public.ingredientes i2 on i2.id = f2.ingrediente_id
                 where f2.produto_id = pr.id and f2.opcao_grupo is null
                 order by floor(greatest(i2.estoque, 0) / (f2.quantidade / r.rendimento)), i2.nome limit 1) as limitante
          from public.ficha_itens f join public.ingredientes i on i.id = f.ingrediente_id
         where f.produto_id = pr.id) x on true), '[]'::jsonb));
end $$;

create function public.admin_receita(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin(); pid bigint := public._v_int(p, 'produto_id', 1, 9223372036854775807, 'Produto'); pr public.produtos; r public.receitas;
begin
  perform public._limitar('estoque_ler', 120, 60);
  select * into pr from public.produtos where id = pid;
  if not found then perform public._falha(404, 'Produto não encontrado.'); end if;
  select * into r from public.receitas where produto_id = pid;
  return jsonb_build_object(
    'produto', jsonb_build_object('id', pr.id, 'nome', pr.nome, 'preco', pr.preco, 'unidade', pr.unidade, 'opcoes', pr.opcoes),
    'rendimento', coalesce(r.rendimento, 1),
    'custo_unit', round(public._receita_custo(pid)),
    'linhas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'ingrediente_id', f.ingrediente_id, 'ingrediente', i.nome, 'unidade', i.unidade,
               'opcao_grupo', f.opcao_grupo, 'opcao_item', f.opcao_item, 'quantidade', f.quantidade,
               'opcao_existe', f.opcao_grupo is null or exists (
                  select 1 from jsonb_array_elements(pr.opcoes) g, jsonb_array_elements(coalesce(g -> 'itens', '[]'::jsonb)) it
                   where g ->> 'nome' = f.opcao_grupo and it ->> 'nome' = f.opcao_item))
             order by (f.opcao_grupo is not null), f.id)
        from public.ficha_itens f join public.ingredientes i on i.id = f.ingrediente_id where f.produto_id = pid), '[]'::jsonb));
end $$;

create function public.admin_salvar_receita(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  adm public.perfis := public._admin();
  pid bigint := public._v_int(p, 'produto_id', 1, 9223372036854775807, 'Produto');
  pr public.produtos; l jsonb; linhas jsonb := coalesce(p -> 'linhas', '[]'::jsonb);
  v_rend numeric := round(coalesce(public._v_num(p, 'rendimento', 0.001, 100000, 'Rendimento', true), 1)::numeric, 3);
  ing bigint; grp text; itm text; qtd numeric; nome_ing text;
begin
  perform public._limitar('estoque_gravar', 60, 60);
  select * into pr from public.produtos where id = pid;
  if not found then perform public._falha(404, 'Produto não encontrado.'); end if;
  if jsonb_typeof(linhas) <> 'array' then perform public._falha(422, 'Ingredientes da receita inválidos.', 'linhas'); end if;
  if jsonb_array_length(linhas) > 60 then perform public._falha(422, 'Uma receita pode ter no máximo 60 linhas.', 'linhas'); end if;

  -- confere cada linha antes de gravar qualquer coisa
  for l in select value from jsonb_array_elements(linhas) loop
    ing := public._v_int(l, 'ingrediente_id', 1, 9223372036854775807, 'Ingrediente');
    select nome into nome_ing from public.ingredientes where id = ing;
    if not found then perform public._falha(422, 'Um dos ingredientes não existe mais. Atualize a página.', 'linhas'); end if;
    qtd := public._v_num(l, 'quantidade', 0.001, 10000000, 'Quantidade de ' || nome_ing);
    grp := nullif(btrim(coalesce(l ->> 'opcao_grupo', '')), '');
    itm := nullif(btrim(coalesce(l ->> 'opcao_item', '')), '');
    if (grp is null) <> (itm is null) then perform public._falha(422, 'Opção inválida na linha de ' || nome_ing || '.', 'linhas'); end if;
    if grp is not null and not exists (
         select 1 from jsonb_array_elements(pr.opcoes) g, jsonb_array_elements(coalesce(g -> 'itens', '[]'::jsonb)) it
          where g ->> 'nome' = grp and it ->> 'nome' = itm) then
      perform public._falha(422, 'A opção "' || grp || ' — ' || itm || '" não existe neste produto.', 'linhas');
    end if;
  end loop;
  select x.nome into nome_ing from (
    select i.nome, count(*) n
      from jsonb_array_elements(linhas) l2
      join public.ingredientes i on i.id = (l2 ->> 'ingrediente_id')::bigint
     group by i.nome, coalesce(nullif(btrim(l2 ->> 'opcao_grupo'), ''), ''), coalesce(nullif(btrim(l2 ->> 'opcao_item'), ''), '')) x
   where x.n > 1 limit 1;
  if found then perform public._falha(422, nome_ing || ' aparece duas vezes na mesma situação. Junte as quantidades em uma linha só.', 'linhas'); end if;

  if jsonb_array_length(linhas) = 0 then
    delete from public.receitas where produto_id = pid;
    return jsonb_build_object('ok', true, 'removida', true);
  end if;

  insert into public.receitas (produto_id, rendimento) values (pid, v_rend)
  on conflict (produto_id) do update set rendimento = excluded.rendimento, revisao = public.receitas.revisao + 1, atualizado_em = now();
  delete from public.ficha_itens where produto_id = pid;
  insert into public.ficha_itens (produto_id, ingrediente_id, opcao_grupo, opcao_item, quantidade)
  select pid, (l2 ->> 'ingrediente_id')::bigint, nullif(btrim(l2 ->> 'opcao_grupo'), ''), nullif(btrim(l2 ->> 'opcao_item'), ''),
         round(replace(l2 ->> 'quantidade', ',', '.')::numeric, 3)
    from jsonb_array_elements(linhas) l2;
  return jsonb_build_object('ok', true, 'custo_unit', round(public._receita_custo(pid)));
end $$;

/* ---------- API: previsão e lista de compras ---------- */
-- Olha os pedidos ainda não entregues (e ainda sem baixa) até `dias` à frente, soma o que vão gastar
-- e compara com o estoque. Pedido atrasado conta como de hoje.
create function public.admin_estoque_previsao(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  adm public.perfis := public._admin(); cfg public.estoque_config;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  janela int; fim date; ids bigint[]; n_ped int; lista jsonb; sem jsonb; resumo jsonb;
begin
  perform public._limitar('estoque_ler', 120, 60);
  select * into cfg from public.estoque_config where id = 1;
  janela := coalesce(public._v_int(p, 'dias', 1, 60, 'Período', true), cfg.dias_previsao);
  fim := hoje + janela;

  select coalesce(array_agg(o.id), '{}'::bigint[]) into ids
    from public.pedidos o
   where o.data_agendada <= fim and o.status not in ('cancelado', 'entregue')
     and not exists (select 1 from public.estoque_baixas b where b.pedido_id = o.id);
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
    select i.id, i.nome, i.unidade, i.estoque, i.minimo, i.embalagem_qtd, i.embalagem_nome, i.embalagem_preco, i.ativo,
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
           'id', k.id, 'nome', k.nome, 'unidade', k.unidade, 'estoque', k.estoque, 'minimo', k.minimo,
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
             and not exists (select 1 from public.ficha_itens f where f.produto_id = i.produto_id)
           group by i.produto_id, i.nome) s;

  select jsonb_build_object(
           'faltando', count(*) filter (where x ->> 'situacao' = 'faltando'),
           'baixo', count(*) filter (where x ->> 'situacao' = 'baixo'),
           'ok', count(*) filter (where x ->> 'situacao' = 'ok'),
           'a_comprar', count(*) filter (where (x ->> 'comprar_embalagens')::numeric > 0),
           'valor_compras', coalesce(sum((x ->> 'comprar_valor')::bigint), 0))
    into resumo from jsonb_array_elements(lista) x;

  return jsonb_build_object('de', to_char(hoje, 'YYYY-MM-DD'), 'ate', to_char(fim, 'YYYY-MM-DD'), 'dias', janela, 'pedidos', n_ped,
                            'itens', lista, 'sem_receita', sem, 'resumo', resumo);
end $$;

/* ---------- Permissões (as funções novas nascem trancadas) ---------- */
grant execute on function
  public.admin_ingredientes(jsonb), public.admin_salvar_ingrediente(jsonb), public.admin_excluir_ingrediente(jsonb),
  public.admin_estoque_movimentar(jsonb), public.admin_estoque_historico(jsonb), public.admin_estoque_configurar(jsonb),
  public.admin_receitas(jsonb), public.admin_receita(jsonb), public.admin_salvar_receita(jsonb), public.admin_estoque_previsao(jsonb)
to authenticated;
