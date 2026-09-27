-- ==========================================================
-- 15) INTEGRAÇÕES
--     PIX automático (Mercado Pago) e avisos por WhatsApp (Meta).
--     As chaves dos serviços NUNCA ficam aqui: vivem nos "Secrets"
--     das funções do Supabase. O banco guarda só a configuração,
--     um hash da chave de integração e o histórico de avisos.
-- ==========================================================

/* ---------- Pagamentos vindos do gateway ---------- */
alter table public.pagamentos_pedido add column id_externo text;
create unique index pagamentos_id_externo_idx on public.pagamentos_pedido (id_externo) where id_externo is not null;

do $$
declare c text;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.pagamentos_pedido'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%transferencia%' loop
    execute format('alter table public.pagamentos_pedido drop constraint %I', c);
  end loop;
end $$;
alter table public.pagamentos_pedido add constraint pagamentos_pedido_forma_check
  check (forma in ('pix', 'dinheiro', 'cartao', 'transferencia', 'pix_auto'));

create or replace function public._forma_recebida_texto(forma text) returns text language sql immutable as $$
  select case forma when 'pix' then 'PIX' when 'pix_auto' then 'PIX (automático)' when 'dinheiro' then 'Dinheiro'
                    when 'cartao' then 'Cartão' when 'transferencia' then 'Transferência' else forma end
$$;

/* ---------- Preferência do cliente ---------- */
alter table public.perfis add column avisos_whatsapp boolean not null default true;

create or replace function public._perfil_json(u public.perfis) returns jsonb
language sql stable as $$
  select jsonb_build_object('id', u.id, 'nome', u.nome, 'email', u.email, 'telefone', coalesce(u.telefone, ''),
    'papel', u.papel, 'ativo', u.ativo, 'criado_em', public._fmt(u.criado_em), 'avisos_whatsapp', u.avisos_whatsapp)
$$;

create function public.cliente_preferencias(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare u public.perfis := public._cliente();
begin
  perform public._limitar('cliente_preferencias', 20, 60);
  if not (p ? 'avisos_whatsapp') then perform public._falha(422, 'Informe a preferência.', 'avisos_whatsapp'); end if;
  update public.perfis set avisos_whatsapp = public._v_bool(p, 'avisos_whatsapp') where id = u.id returning * into u;
  return jsonb_build_object('usuario', public._perfil_json(u));
end $$;

/* ---------- PIX automático: configuração e chave de integração ---------- */
create function public.admin_gateway(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin(); g jsonb := coalesce(public._cfg() -> 'gateway', '{}'::jsonb);
begin
  return jsonb_build_object('provedor', 'mercadopago', 'ativo', coalesce((g ->> 'ativo')::boolean, false),
                            'tem_chave', coalesce(g ->> 'segredo_hash', '') <> '');
end $$;

create function public.admin_salvar_gateway(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin(); g jsonb := coalesce(public._cfg() -> 'gateway', '{}'::jsonb); v boolean := public._v_bool(p, 'ativo');
begin
  if v and coalesce(g ->> 'segredo_hash', '') = '' then
    perform public._falha(422, 'Gere a chave de integração antes de ligar o PIX automático.', 'ativo');
  end if;
  insert into public.configuracoes (chave, valor) values ('gateway', g || jsonb_build_object('ativo', v))
  on conflict (chave) do update set valor = excluded.valor;
  return public.admin_gateway();
end $$;

/** Gera uma chave nova e a devolve UMA vez. O banco guarda só o hash; gerar outra desliga o PIX automático até você religar. */
create function public.admin_gerar_segredo_gateway(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin(); segredo text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  insert into public.configuracoes (chave, valor)
  values ('gateway', jsonb_build_object('ativo', false, 'segredo_hash', encode(sha256(convert_to(segredo, 'UTF8')), 'hex')))
  on conflict (chave) do update set valor = excluded.valor;
  return jsonb_build_object('segredo', segredo);
end $$;

/** Chamada só pela função pix-webhook (depois de conferir o pagamento no Mercado Pago). Protegida pela chave de integração. */
create function public.gateway_registrar_pagamento(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  g jsonb := coalesce(public._cfg() -> 'gateway', '{}'::jsonb); ped public.pedidos; id_ext text := btrim(coalesce(p ->> 'id_externo', ''));
  v bigint; aplicar int;
begin
  perform public._limitar('gateway_registrar_pagamento', 120, 60);
  if not coalesce((g ->> 'ativo')::boolean, false) or coalesce(g ->> 'segredo_hash', '') = ''
     or encode(sha256(convert_to(coalesce(p ->> 'segredo', ''), 'UTF8')), 'hex') <> (g ->> 'segredo_hash') then
    perform public._falha(403, 'Acesso negado.');
  end if;
  if id_ext = '' or length(id_ext) > 80 then perform public._falha(422, 'Identificador do pagamento inválido.'); end if;
  if coalesce(p ->> 'valor', '') !~ '^\d{1,9}$' or (p ->> 'valor')::bigint < 1 then perform public._falha(422, 'Valor inválido.'); end if;
  v := (p ->> 'valor')::bigint;

  select * into ped from public.pedidos where codigo = p ->> 'codigo' for update;
  if not found then perform public._falha(404, 'Pedido não encontrado.'); end if;
  if exists (select 1 from public.pagamentos_pedido where id_externo = id_ext) then
    return jsonb_build_object('ok', true, 'duplicado', true);
  end if;
  if ped.status = 'cancelado' then return jsonb_build_object('ok', false, 'motivo', 'cancelado'); end if;

  aplicar := least(v, greatest(ped.total - ped.pago, 0))::int; -- nunca passa do total
  if aplicar <= 0 then return jsonb_build_object('ok', true, 'ignorado', true); end if;
  insert into public.pagamentos_pedido (pedido_id, valor, forma, id_externo) values (ped.id, aplicar, 'pix_auto', id_ext);
  update public.pedidos set pago = pago + aplicar, atualizado_em = now() where id = ped.id;
  select * into ped from public.pedidos where id = ped.id;
  return jsonb_build_object('ok', true, 'aplicado', aplicar, 'situacao', public._pagamento_situacao(ped));
end $$;

/* A vitrine passa a saber se o PIX automático está ligado (só o "sim/não", nunca a chave). */
create or replace function public._base_loja_config(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  cfg jsonb := public._cfg(); agora timestamp := now() at time zone 'America/Sao_Paulo';
  janela jsonb; aberta boolean; pag jsonb;
begin
  janela := cfg -> 'horarios' -> (extract(dow from agora)::int)::text;
  aberta := coalesce((janela ->> 'aberto')::boolean, false)
        and to_char(agora, 'HH24:MI') >= coalesce(janela ->> 'abre', '00:00')
        and to_char(agora, 'HH24:MI') <= coalesce(janela ->> 'fecha', '00:00');
  pag := coalesce(cfg -> 'pagamento', '{}'::jsonb) - 'pix_chave' - 'pix_nome' - 'pix_cidade';
  pag := jsonb_set(pag, '{pix_ativo}', to_jsonb(coalesce((cfg #>> '{pagamento,pix_ativo}')::boolean, false)
                                                and coalesce(cfg #>> '{pagamento,pix_chave}', '') <> ''));
  pag := pag || jsonb_build_object('pix_automatico', coalesce((cfg #>> '{gateway,ativo}')::boolean, false));
  return jsonb_build_object(
    'loja', coalesce(cfg -> 'loja', '{}'::jsonb), 'textos', coalesce(cfg -> 'textos', '{}'::jsonb),
    'horarios', coalesce(cfg -> 'horarios', '{}'::jsonb), 'pedidos', coalesce(cfg -> 'pedidos', '{}'::jsonb),
    'entrega', coalesce(cfg -> 'entrega', '{}'::jsonb), 'pagamento', pag,
    'sinal', coalesce(cfg -> 'sinal', '{"percentual":0,"acima_de":0}'::jsonb),
    'galeria', coalesce(cfg #> '{galeria,itens}', '[]'::jsonb),
    'faq', coalesce(cfg #> '{faq,itens}', '[]'::jsonb),
    'legal', coalesce(cfg -> 'legal', '{}'::jsonb),
    'zonas', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'ate_km', ate_km, 'taxa', taxa, 'prazo_min', prazo_min) order by ate_km)
                         from public.zonas_entrega where ativa), '[]'::jsonb),
    'aberta_agora', aberta);
end $$;

/* ---------- Avisos por WhatsApp ---------- */
create table public.avisos_log (
  id         bigint generated always as identity primary key,
  pedido_id  bigint not null references public.pedidos (id) on delete cascade,
  evento     text not null,
  canal      text not null default 'whatsapp',
  estado     text not null check (estado in ('enviado', 'erro')),
  detalhe    text not null default '',
  usuario_id uuid references public.perfis (id) on delete set null,
  criado_em  timestamptz not null default now()
);
create index avisos_log_pedido_idx on public.avisos_log (pedido_id, id);
alter table public.avisos_log enable row level security;
revoke all on public.avisos_log from anon, authenticated;

/* Configuração com os padrões preenchidos: quais mudanças de status avisam e o nome do modelo de mensagem de cada uma. */
create function public._avisos_cfg() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'whatsapp_ativo', coalesce((c #>> '{whatsapp_ativo}')::boolean, false),
    'idioma', coalesce(nullif(c ->> 'idioma', ''), 'pt_BR'),
    'eventos', '{"confirmado":true,"em_preparo":false,"pronto":true,"saiu_entrega":true,"entregue":false,"cancelado":true}'::jsonb
               || coalesce(c -> 'eventos', '{}'::jsonb),
    'modelos', '{"confirmado":"pedido_confirmado","em_preparo":"pedido_em_preparo","pronto":"pedido_pronto","saiu_entrega":"pedido_saiu_entrega","entregue":"pedido_entregue","cancelado":"pedido_cancelado"}'::jsonb
               || coalesce(c -> 'modelos', '{}'::jsonb))
  from (select coalesce(public._cfg() -> 'avisos', '{}'::jsonb) as c) x
$$;

create function public.admin_avisos(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin();
begin
  return public._avisos_cfg();
end $$;

create function public.admin_salvar_avisos(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  adm public.perfis := public._admin(); ev text; eventos jsonb := '{}'::jsonb; modelos jsonb := '{}'::jsonb; nome text;
  base jsonb := public._avisos_cfg();
begin
  foreach ev in array array['confirmado', 'em_preparo', 'pronto', 'saiu_entrega', 'entregue', 'cancelado'] loop
    eventos := eventos || jsonb_build_object(ev, public._v_bool(coalesce(p -> 'eventos', '{}'::jsonb), ev));
    nome := coalesce(nullif(btrim(p -> 'modelos' ->> ev), ''), base -> 'modelos' ->> ev);
    if nome !~ '^[a-z0-9_]{1,100}$' then
      perform public._falha(422, 'Nome do modelo: só letras minúsculas, números e _ (é o nome que você deu no Meta).', 'modelo_' || ev);
    end if;
    modelos := modelos || jsonb_build_object(ev, nome);
  end loop;
  insert into public.configuracoes (chave, valor)
  values ('avisos', jsonb_build_object('whatsapp_ativo', public._v_bool(p, 'whatsapp_ativo'), 'idioma', 'pt_BR', 'eventos', eventos, 'modelos', modelos))
  on conflict (chave) do update set valor = excluded.valor;
  return public._avisos_cfg();
end $$;

/** O que a função whatsapp-avisar precisa para mandar (ou o motivo de não mandar). Só equipe. */
create function public.admin_aviso_dados(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  staff public.perfis := public._staff(); cfg jsonb := public._avisos_cfg(); ped public.pedidos; u public.perfis;
  ev text := coalesce(p ->> 'evento', ''); fone text; dias text[] := array['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
begin
  perform public._limitar('admin_aviso_dados', 120, 60);
  select * into ped from public.pedidos where id::text = p ->> 'id';
  if not found then perform public._falha(404, 'Pedido não encontrado.'); end if;
  if not (cfg -> 'eventos' ? ev) then perform public._falha(422, 'Situação inválida.', 'evento'); end if;
  if not (cfg ->> 'whatsapp_ativo')::boolean then return jsonb_build_object('enviar', false, 'motivo', 'desligado'); end if;
  if not (cfg -> 'eventos' ->> ev)::boolean then return jsonb_build_object('enviar', false, 'motivo', 'evento_desligado'); end if;
  if ped.status <> ev then return jsonb_build_object('enviar', false, 'motivo', 'status_mudou'); end if;
  if ped.usuario_id is not null then
    select * into u from public.perfis where id = ped.usuario_id;
    if found and not u.avisos_whatsapp then return jsonb_build_object('enviar', false, 'motivo', 'cliente_recusou'); end if;
  end if;
  fone := regexp_replace(coalesce(ped.cliente_telefone, ''), '\D', '', 'g');
  if length(fone) not in (10, 11) then return jsonb_build_object('enviar', false, 'motivo', 'sem_telefone'); end if;
  if not public._v_bool(p, 'forcar')
     and exists (select 1 from public.avisos_log where pedido_id = ped.id and evento = ev and estado = 'enviado') then
    return jsonb_build_object('enviar', false, 'motivo', 'ja_enviado');
  end if;
  return jsonb_build_object('enviar', true, 'telefone', '55' || fone, 'modelo', cfg -> 'modelos' ->> ev, 'idioma', cfg ->> 'idioma', 'codigo', ped.codigo,
    'variaveis', jsonb_build_array(split_part(ped.cliente_nome, ' ', 1), ped.codigo,
      dias[extract(dow from ped.data_agendada)::int + 1] || ', ' || to_char(ped.data_agendada, 'DD/MM') || ' às ' || ped.hora_agendada));
end $$;

create function public.admin_aviso_registrar(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  staff public.perfis := public._staff(); ev text := public._v_opcao(p, 'evento', array['confirmado', 'em_preparo', 'pronto', 'saiu_entrega', 'entregue', 'cancelado'], 'Situação');
  est text := public._v_opcao(p, 'estado', array['enviado', 'erro'], 'Estado');
begin
  perform public._limitar('admin_aviso_registrar', 120, 60);
  if not exists (select 1 from public.pedidos where id::text = p ->> 'pedido_id') then perform public._falha(404, 'Pedido não encontrado.'); end if;
  insert into public.avisos_log (pedido_id, evento, estado, detalhe, usuario_id)
  values ((p ->> 'pedido_id')::bigint, ev, est, left(coalesce(p ->> 'detalhe', ''), 300), staff.id);
  return jsonb_build_object('ok', true);
end $$;

create function public.admin_avisos_pedido(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare staff public.perfis := public._staff();
begin
  return jsonb_build_object('avisos', coalesce((
    select jsonb_agg(jsonb_build_object('evento', a.evento, 'evento_texto', public._status_texto(a.evento, 'entrega'), 'estado', a.estado,
             'detalhe', a.detalhe, 'quando', public._fmt(a.criado_em), 'usuario', coalesce(u.nome, '')) order by a.id desc)
      from (select * from public.avisos_log where pedido_id::text = p ->> 'id' order by id desc limit 10) a
      left join public.perfis u on u.id = a.usuario_id), '[]'::jsonb));
end $$;

/* ---------- Permissões (as funções novas nascem trancadas) ---------- */
grant execute on function
  public.cliente_preferencias(jsonb),
  public.admin_gateway(jsonb), public.admin_salvar_gateway(jsonb), public.admin_gerar_segredo_gateway(jsonb),
  public.admin_avisos(jsonb), public.admin_salvar_avisos(jsonb), public.admin_aviso_dados(jsonb),
  public.admin_aviso_registrar(jsonb), public.admin_avisos_pedido(jsonb)
to authenticated;
grant execute on function public.gateway_registrar_pagamento(jsonb) to anon, authenticated;

/* ---------- Pagamento confirmado pelo Mercado Pago não se apaga aqui ---------- */
-- A devolução do dinheiro é feita no Mercado Pago. Apagar a linha aqui permitiria que um aviso repetido do gateway a registrasse de novo.
create or replace function public.admin_excluir_pagamento(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare staff public.perfis := public._staff(); g public.pagamentos_pedido;
begin
  select * into g from public.pagamentos_pedido where id = public._v_int(p, 'id', 1, 999999999999, 'Pagamento');
  if not found then perform public._falha(404, 'Pagamento não encontrado.'); end if;
  if g.forma = 'pix_auto' then
    perform public._falha(409, 'Este pagamento foi confirmado automaticamente pelo Mercado Pago. Para devolver o valor, faça o estorno no Mercado Pago.');
  end if;
  delete from public.pagamentos_pedido where id = g.id;
  update public.pedidos set pago = greatest(pago - g.valor, 0), atualizado_em = now() where id = g.pedido_id;
  return jsonb_build_object('pedido', public._pedido_completo(g.pedido_id));
end $$;
