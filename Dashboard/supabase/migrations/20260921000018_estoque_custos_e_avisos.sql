-- ==========================================================
-- 18) CUSTOS, PREÇO SUGERIDO, LUCRO REAL E AVISO DE ESTOQUE
--     - histórico de preço de cada ingrediente (e alerta quando sobe)
--     - margem de cada produto, margem desejada e preço sugerido
--     - lucro por pedido, por produto e por período
--     - aviso automático (WhatsApp) para a dona quando algo vai faltar
--     Só o administrador vê e mexe.
-- ==========================================================

/* ---------- Histórico de preço ---------- */
create table public.ingrediente_precos (
  id              bigint generated always as identity primary key,
  ingrediente_id  bigint not null references public.ingredientes (id) on delete cascade,
  embalagem_preco int not null,
  embalagem_qtd   numeric(14, 3) not null,
  custo_unit      numeric(14, 6) not null,
  criado_em       timestamptz not null default now()
);
create index ingrediente_precos_ing_idx on public.ingrediente_precos (ingrediente_id, criado_em desc, id desc);

create function public._registrar_preco() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.embalagem_preco > 0 and (tg_op = 'INSERT' or new.embalagem_preco is distinct from old.embalagem_preco or new.embalagem_qtd is distinct from old.embalagem_qtd) then
    insert into public.ingrediente_precos (ingrediente_id, embalagem_preco, embalagem_qtd, custo_unit)
    values (new.id, new.embalagem_preco, new.embalagem_qtd, new.embalagem_preco::numeric / new.embalagem_qtd);
  end if;
  return new;
end $$;
create trigger ingredientes_preco after insert or update of embalagem_preco, embalagem_qtd on public.ingredientes
  for each row execute function public._registrar_preco();

-- quem já tem ingredientes cadastrados começa o histórico com o preço de hoje
insert into public.ingrediente_precos (ingrediente_id, embalagem_preco, embalagem_qtd, custo_unit)
select id, embalagem_preco, embalagem_qtd, embalagem_preco::numeric / embalagem_qtd from public.ingredientes where embalagem_preco > 0;

/* ---------- Configuração: margem desejada, alerta de alta e aviso por WhatsApp ---------- */
alter table public.estoque_config
  add column margem_alvo       int not null default 60 check (margem_alvo between 0 and 95),
  add column alerta_alta_pct   int not null default 5 check (alerta_alta_pct between 1 and 100),
  add column aviso_ativo       boolean not null default false,
  add column aviso_telefone    text not null default '',
  add column aviso_modelo      text not null default 'estoque_alerta',
  add column aviso_das         int not null default 7 check (aviso_das between 0 and 23),
  add column aviso_ate         int not null default 21 check (aviso_ate between 1 and 24),
  add column aviso_tentativa_em timestamptz,
  add column aviso_ultimo_em   timestamptz,
  add column aviso_itens       text[] not null default '{}';

-- só as opções entram na atividade (as datas de envio mudam a toda hora)
drop trigger auditar_estoque_config on public.estoque_config;
create trigger auditar_estoque_config after update of baixa_automatica, dias_previsao, dias_validade, margem_alvo, alerta_alta_pct, aviso_ativo, aviso_telefone, aviso_modelo, aviso_das, aviso_ate
  on public.estoque_config for each row execute function public._auditar();

create table public.estoque_avisos (
  id         bigint generated always as identity primary key,
  estado     text not null check (estado in ('enviado', 'erro')),
  resumo     text not null default '',
  detalhe    text not null default '',
  usuario_id uuid references public.perfis (id) on delete set null,
  criado_em  timestamptz not null default now()
);
alter table public.ingrediente_precos enable row level security;
alter table public.estoque_avisos enable row level security;
revoke all on public.ingrediente_precos, public.estoque_avisos from anon, authenticated;

/* ==========================================================
   API: preços, custos e margens
   ========================================================== */
create function public.admin_ingrediente_precos(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin(); iid bigint := public._v_int(p, 'ingrediente_id', 1, 9223372036854775807, 'Ingrediente'); i public.ingredientes;
begin
  perform public._limitar('estoque_ler', 120, 60);
  select * into i from public.ingredientes where id = iid;
  if not found then perform public._falha(404, 'Ingrediente não encontrado.'); end if;
  return jsonb_build_object('ingrediente', jsonb_build_object('id', i.id, 'nome', i.nome, 'unidade', i.unidade, 'embalagem_nome', i.embalagem_nome),
    'precos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'quando', public._fmt(x.criado_em), 'embalagem_preco', x.embalagem_preco, 'embalagem_qtd', x.embalagem_qtd, 'custo_unit', x.custo_unit,
               'variacao_pct', case when x.anterior > 0 then round((x.custo_unit - x.anterior) * 100 / x.anterior, 1) end) order by x.criado_em desc, x.id desc)
        from (select h.*, lag(h.custo_unit) over (order by h.criado_em, h.id) as anterior
                from public.ingrediente_precos h where h.ingrediente_id = iid) x), '[]'::jsonb));
end $$;

create function public.admin_estoque_custos_configurar(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin(); cfg public.estoque_config;
begin
  perform public._limitar('estoque_gravar', 60, 60);
  update public.estoque_config
     set margem_alvo = public._v_int(p, 'margem_alvo', 0, 95, 'Margem desejada'),
         alerta_alta_pct = coalesce(public._v_int(p, 'alerta_alta_pct', 1, 100, 'Alerta de alta', true), alerta_alta_pct)
   where id = 1 returning * into cfg;
  return jsonb_build_object('margem_alvo', cfg.margem_alvo, 'alerta_alta_pct', cfg.alerta_alta_pct);
end $$;

-- Margem de cada produto com receita, preço sugerido e os ingredientes que ficaram mais caros.
create function public.admin_estoque_custos(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin(); cfg public.estoque_config; produtos_json jsonb; altas_json jsonb;
begin
  perform public._limitar('estoque_ler', 120, 60);
  select * into cfg from public.estoque_config where id = 1;

  with custos as (
    select pr.id, pr.nome, c.nome as categoria, pr.preco, pr.ativo, public._receita_custo(pr.id) as custo
      from public.produtos pr join public.categorias c on c.id = pr.categoria_id join public.receitas r on r.produto_id = pr.id
  ), calc as (
    select k.*, case when k.preco > 0 then (k.preco - k.custo) * 100 / k.preco end as margem_pct from custos k where k.custo > 0
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'nome', c.nome, 'categoria', c.categoria, 'preco', c.preco, 'ativo', c.ativo,
           'custo_unit', round(c.custo), 'margem', c.preco - round(c.custo), 'margem_pct', round(c.margem_pct, 1),
           'abaixo', coalesce(c.margem_pct < cfg.margem_alvo, true),
           'preco_sugerido', (ceil(c.custo / (1 - cfg.margem_alvo / 100.0) / 50) * 50)::int)
         order by c.margem_pct nulls first, lower(c.nome)), '[]'::jsonb)
    into produtos_json from calc c;

  select coalesce(jsonb_agg(jsonb_build_object(
           'ingrediente_id', a.id, 'nome', a.nome, 'unidade', a.unidade, 'de', round(a.ref, 6), 'para', round(a.atual, 6),
           'variacao_pct', round((a.atual - a.ref) * 100 / a.ref, 1), 'desde', to_char(a.ref_em, 'YYYY-MM-DD'),
           'produtos', coalesce((select jsonb_agg(jsonb_build_object('id', pr.id, 'nome', pr.nome,
                                   'margem_pct', round((pr.preco - public._receita_custo(pr.id)) * 100 / nullif(pr.preco, 0), 1)) order by pr.nome)
                                   from public.produtos pr
                                  where exists (select 1 from public._receita_base(pr.id) b where b.ingrediente_id = a.id)), '[]'::jsonb))
         order by (a.atual - a.ref) / a.ref desc), '[]'::jsonb)
    into altas_json
    from (
      select i.id, i.nome, i.unidade,
             (select h.custo_unit from public.ingrediente_precos h where h.ingrediente_id = i.id order by h.criado_em desc, h.id desc limit 1) as atual,
             coalesce(
               (select h.custo_unit from public.ingrediente_precos h where h.ingrediente_id = i.id and h.criado_em <= now() - interval '30 days' order by h.criado_em desc, h.id desc limit 1),
               (select h.custo_unit from public.ingrediente_precos h where h.ingrediente_id = i.id order by h.criado_em, h.id limit 1)) as ref,
             coalesce(
               (select h.criado_em from public.ingrediente_precos h where h.ingrediente_id = i.id and h.criado_em <= now() - interval '30 days' order by h.criado_em desc, h.id desc limit 1),
               (select h.criado_em from public.ingrediente_precos h where h.ingrediente_id = i.id order by h.criado_em, h.id limit 1)) as ref_em
        from public.ingredientes i where i.ativo) a
   where a.ref > 0 and a.atual > a.ref and (a.atual - a.ref) * 100 / a.ref >= cfg.alerta_alta_pct;

  return jsonb_build_object('margem_alvo', cfg.margem_alvo, 'alerta_alta_pct', cfg.alerta_alta_pct, 'produtos', produtos_json, 'altas', altas_json);
end $$;

-- Aplica o preço sugerido (ou outro) direto no produto.
create function public.admin_ajustar_preco_produto(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin(); pr public.produtos;
begin
  perform public._limitar('estoque_gravar', 60, 60);
  update public.produtos set preco = public._v_int(p, 'preco', 1, 10000000, 'Preço'), atualizado_em = now()
   where id = public._v_int(p, 'id', 1, 9223372036854775807, 'Produto') returning * into pr;
  if not found then perform public._falha(404, 'Produto não encontrado.'); end if;
  return jsonb_build_object('produto', jsonb_build_object('id', pr.id, 'nome', pr.nome, 'preco', pr.preco));
end $$;

/* ==========================================================
   API: lucro real por período
   ========================================================== */
-- Custo pelos preços de hoje. Descontos são repartidos entre os itens; o frete não entra.
-- O que é vendido sem receita não tem custo conhecido: aparece à parte e fica fora do lucro.
create function public.admin_estoque_lucro(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  adm public.perfis := public._admin(); hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_de date := coalesce(public._v_data(p, 'de', true), hoje - 29); v_ate date := coalesce(public._v_data(p, 'ate', true), hoje);
  so_ent boolean := public._v_bool(p, 'so_entregues'); r jsonb;
begin
  perform public._limitar('estoque_lucro', 30, 60);
  if v_ate < v_de then perform public._falha(422, 'A data final vem antes da inicial.', 'ate'); end if;
  if v_ate - v_de > 366 then perform public._falha(422, 'Escolha um período de até 1 ano.', 'ate'); end if;

  with it as (
    select i.id as item_id, o.id as pid, o.codigo, o.cliente_nome, o.data_agendada as dia, i.produto_id, i.nome, i.qtd,
           i.total * (1 - case when o.subtotal > 0 then o.desconto::numeric / o.subtotal else 0 end) as receita,
           exists (select 1 from public.receitas rc where rc.produto_id = i.produto_id) as tem,
           coalesce((select sum(c.quantidade * g.embalagem_preco / g.embalagem_qtd)
                       from public._consumo_item(i.produto_id, i.qtd, i.opcoes) c join public.ingredientes g on g.id = c.ingrediente_id), 0) as custo
      from public.pedidos o join public.pedido_itens i on i.pedido_id = o.id
     where o.data_agendada between v_de and v_ate and o.status <> 'cancelado' and (not so_ent or o.status = 'entregue')
  )
  select jsonb_build_object(
    'de', to_char(v_de, 'YYYY-MM-DD'), 'ate', to_char(v_ate, 'YYYY-MM-DD'), 'so_entregues', so_ent,
    'totais', (select jsonb_build_object(
        'pedidos', count(distinct pid),
        'receita', coalesce(round(sum(receita)), 0),
        'receita_com_custo', coalesce(round(sum(receita) filter (where tem)), 0),
        'receita_sem_custo', coalesce(round(sum(receita) filter (where not tem)), 0),
        'custo', coalesce(round(sum(custo) filter (where tem)), 0),
        'lucro', coalesce(round(sum(receita) filter (where tem) - sum(custo) filter (where tem)), 0),
        'margem_pct', case when coalesce(sum(receita) filter (where tem), 0) > 0
                           then round((sum(receita) filter (where tem) - sum(custo) filter (where tem)) * 100 / (sum(receita) filter (where tem)), 1) end)
      from it),
    'serie', (select coalesce(jsonb_agg(jsonb_build_object('dia', to_char(s.dia, 'YYYY-MM-DD'), 'receita', s.receita, 'custo', s.custo, 'lucro', s.receita - s.custo) order by s.dia), '[]'::jsonb)
                from (select dia, round(coalesce(sum(receita) filter (where tem), 0)) as receita, round(coalesce(sum(custo) filter (where tem), 0)) as custo
                        from it group by dia) s),
    'produtos', (select coalesce(jsonb_agg(jsonb_build_object(
                    'produto_id', x.produto_id, 'nome', x.nome, 'qtd', x.qtd, 'receita', x.receita, 'receita_sem_custo', x.receita_sem_custo, 'custo', x.custo,
                    'lucro', x.receita - x.receita_sem_custo - x.custo,
                    'margem_pct', case when x.receita - x.receita_sem_custo > 0 then round((x.receita - x.receita_sem_custo - x.custo) * 100 / (x.receita - x.receita_sem_custo), 1) end)
                  order by (x.receita - x.receita_sem_custo - x.custo) desc, x.nome), '[]'::jsonb)
                 from (select produto_id, nome, sum(qtd) as qtd, round(sum(receita)) as receita, round(coalesce(sum(receita) filter (where not tem), 0)) as receita_sem_custo,
                              round(coalesce(sum(custo) filter (where tem), 0)) as custo
                         from it group by produto_id, nome) x),
    'pedidos', (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', y.pid, 'codigo', y.codigo, 'dia', to_char(y.dia, 'YYYY-MM-DD'), 'cliente', y.cliente_nome, 'receita', y.receita, 'custo', y.custo,
                    'lucro', y.receita_cc - y.custo, 'parcial', y.parcial,
                    'margem_pct', case when y.receita_cc > 0 then round((y.receita_cc - y.custo) * 100 / y.receita_cc, 1) end)
                  order by y.dia desc, y.pid desc), '[]'::jsonb)
                 from (select pid, codigo, cliente_nome, dia, round(sum(receita)) as receita, coalesce(sum(receita) filter (where tem), 0) as receita_cc,
                              round(coalesce(sum(custo) filter (where tem), 0)) as custo, bool_or(not tem) as parcial
                         from it group by pid, codigo, cliente_nome, dia order by dia desc, pid desc limit 200) y))
    into r;
  return r;
end $$;

/* ==========================================================
   API: aviso de estoque por WhatsApp
   ========================================================== */
create function public.admin_estoque_aviso_config(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin(); cfg public.estoque_config; v_modelo text; v_fone text; v_das int; v_ate int;
begin
  perform public._limitar('estoque_gravar', 60, 60);
  if p ? 'aviso_ativo' then
    v_das := coalesce(public._v_int(p, 'aviso_das', 0, 23, 'Hora inicial', true), 7);
    v_ate := coalesce(public._v_int(p, 'aviso_ate', 1, 24, 'Hora final', true), 21);
    if v_das >= v_ate then perform public._falha(422, 'A hora final precisa ser depois da inicial.', 'aviso_ate'); end if;
    v_fone := public._v_tel(p, 'aviso_telefone', false);
    v_modelo := coalesce(nullif(btrim(p ->> 'aviso_modelo'), ''), 'estoque_alerta');
    if v_modelo !~ '^[a-z0-9_]{1,100}$' then
      perform public._falha(422, 'Nome do modelo: só letras minúsculas, números e _ (é o nome que você deu no Meta).', 'aviso_modelo');
    end if;
    if public._v_bool(p, 'aviso_ativo') and v_fone = '' then perform public._falha(422, 'Informe o seu WhatsApp para receber o aviso.', 'aviso_telefone'); end if;
    update public.estoque_config set aviso_ativo = public._v_bool(p, 'aviso_ativo'), aviso_telefone = v_fone, aviso_modelo = v_modelo, aviso_das = v_das, aviso_ate = v_ate where id = 1;
  end if;
  select * into cfg from public.estoque_config where id = 1;
  return jsonb_build_object('aviso_ativo', cfg.aviso_ativo, 'aviso_telefone', cfg.aviso_telefone, 'aviso_modelo', cfg.aviso_modelo, 'aviso_das', cfg.aviso_das, 'aviso_ate', cfg.aviso_ate,
    'ultimo_em', public._fmt(cfg.aviso_ultimo_em),
    'avisos', coalesce((select jsonb_agg(jsonb_build_object('quando', public._fmt(a.criado_em), 'estado', a.estado, 'resumo', a.resumo, 'detalhe', a.detalhe) order by a.id desc)
                          from (select * from public.estoque_avisos order by id desc limit 10) a), '[]'::jsonb));
end $$;

-- A função whatsapp-avisar pergunta aqui se há aviso a mandar e com que texto. Quem decide é o banco.
create function public.admin_estoque_aviso_dados(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  adm public.perfis := public._admin(); cfg public.estoque_config; hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  hora int := extract(hour from now() at time zone 'America/Sao_Paulo')::int;
  prev jsonb; falta text; baixo text; venc int; atuais text[]; novo_dia boolean; tem_novo boolean; partes text[] := '{}'; resumo text;
begin
  perform public._limitar('estoque_aviso', 30, 60);
  select * into cfg from public.estoque_config where id = 1;
  if not cfg.aviso_ativo then return jsonb_build_object('enviar', false, 'motivo', 'desligado'); end if;
  if length(cfg.aviso_telefone) not in (10, 11) then return jsonb_build_object('enviar', false, 'motivo', 'sem_telefone'); end if;
  if hora < cfg.aviso_das or hora >= cfg.aviso_ate then return jsonb_build_object('enviar', false, 'motivo', 'fora_do_horario'); end if;
  if cfg.aviso_tentativa_em is not null and cfg.aviso_tentativa_em > now() - interval '1 hour' then return jsonb_build_object('enviar', false, 'motivo', 'aguardando'); end if;

  prev := public.admin_estoque_previsao(jsonb_build_object('dias', cfg.dias_previsao));
  select string_agg(x ->> 'nome', ', ') filter (where x ->> 'situacao' = 'faltando'), string_agg(x ->> 'nome', ', ') filter (where x ->> 'situacao' = 'baixo'),
         array_agg('i' || (x ->> 'id')) filter (where x ->> 'situacao' in ('faltando', 'baixo'))
    into falta, baixo, atuais from jsonb_array_elements(prev -> 'itens') x;
  venc := (prev -> 'resumo' ->> 'vencidos')::int + (prev -> 'resumo' ->> 'vencendo')::int;
  atuais := coalesce(atuais, '{}') || coalesce((select array_agg('v' || (v ->> 'id')) from jsonb_array_elements(prev -> 'vencimentos') v), '{}');
  if cardinality(atuais) = 0 then return jsonb_build_object('enviar', false, 'motivo', 'nada'); end if;

  novo_dia := cfg.aviso_ultimo_em is null or (cfg.aviso_ultimo_em at time zone 'America/Sao_Paulo')::date < hoje;
  tem_novo := not (atuais <@ cfg.aviso_itens);
  if not (novo_dia or tem_novo) then return jsonb_build_object('enviar', false, 'motivo', 'ja_avisado'); end if;

  if falta is not null then partes := partes || ('vão faltar: ' || falta); end if;
  if baixo is not null then partes := partes || ('abaixo do mínimo: ' || baixo); end if;
  if venc > 0 then partes := partes || (venc || case when venc = 1 then ' lote vence' else ' lotes vencem' end || ' em breve'); end if;
  resumo := left(array_to_string(partes, '; '), 600);
  return jsonb_build_object('enviar', true, 'telefone', '55' || cfg.aviso_telefone, 'modelo', cfg.aviso_modelo, 'idioma', 'pt_BR',
    'variaveis', jsonb_build_array(split_part(adm.nome, ' ', 1), resumo), 'resumo', resumo, 'itens', to_jsonb(atuais));
end $$;

create function public.admin_estoque_aviso_registrar(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin(); est text := public._v_opcao(p, 'estado', array['enviado', 'erro'], 'Estado'); v_itens text[];
begin
  perform public._limitar('estoque_aviso', 30, 60);
  insert into public.estoque_avisos (estado, resumo, detalhe, usuario_id) values (est, left(coalesce(p ->> 'resumo', ''), 600), left(coalesce(p ->> 'detalhe', ''), 300), adm.id);
  if est = 'enviado' then
    select coalesce(array_agg(x), '{}') into v_itens from jsonb_array_elements_text(coalesce(p -> 'itens', '[]'::jsonb)) x;
    update public.estoque_config set aviso_tentativa_em = now(), aviso_ultimo_em = now(), aviso_itens = v_itens where id = 1;
  else
    update public.estoque_config set aviso_tentativa_em = now() where id = 1;
  end if;
  return jsonb_build_object('ok', true);
end $$;

/* ---------- Permissões (as funções novas nascem trancadas) ---------- */
grant execute on function
  public.admin_ingrediente_precos(jsonb), public.admin_estoque_custos_configurar(jsonb), public.admin_estoque_custos(jsonb),
  public.admin_ajustar_preco_produto(jsonb), public.admin_estoque_lucro(jsonb),
  public.admin_estoque_aviso_config(jsonb), public.admin_estoque_aviso_dados(jsonb), public.admin_estoque_aviso_registrar(jsonb)
to authenticated;
