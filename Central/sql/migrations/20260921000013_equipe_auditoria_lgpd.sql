-- ==========================================================
-- 13) EQUIPE, REGISTRO DE ATIVIDADE, LGPD E PRIMEIROS PASSOS
--     Papel "atendente" (só pedidos, agenda e produção), registro
--     de quem mudou o quê, baixar/excluir os dados do cliente e a
--     lista de primeiros passos da loja.
-- ==========================================================

/* ---------- Papéis ---------- */
do $$
declare c text;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.perfis'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%papel%' loop
    execute format('alter table public.perfis drop constraint %I', c);
  end loop;
end $$;
alter table public.perfis add constraint perfis_papel_check check (papel in ('cliente', 'admin', 'atendente'));
alter table public.perfis add column aceite_termos_em timestamptz;

/* O atendente trabalha com pedidos: essas funções passam a aceitar administrador OU atendente.
   A definição atual é lida do banco e só o "porteiro" muda (_admin -> _staff). */
do $$
declare f record; def text;
begin
  for f in select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
              and p.proname in ('admin_pedidos', 'admin_pedidos_contagem', 'admin_pedidos_novos', 'admin_pedido', 'admin_mudar_status',
                                'admin_produtos', 'admin_categorias', 'admin_clientes', 'admin_atualizar_perfil') loop
    def := pg_get_functiondef(f.oid);
    if position('public._admin()' in def) = 0 then raise exception 'a função % não usa _admin(); revise a migração', f.proname; end if;
    execute replace(def, 'public._admin()', 'public._staff()');
  end loop;
end $$;

/* ---------- Equipe: administradores e atendentes ---------- */
create or replace function public.admin_equipe(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin();
begin
  return jsonb_build_object('equipe', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'nome', u.nome, 'email', u.email, 'ativo', u.ativo, 'papel', u.papel,
      'criado_em', public._fmt(u.criado_em), 'ultimo_acesso', public._fmt(u.ultimo_acesso)) order by u.criado_em)
      from public.perfis u where u.papel in ('admin', 'atendente')), '[]'::jsonb));
end $$;

/** Define o papel de quem já tem conta: administrador, atendente ou de volta a cliente. */
create or replace function public.admin_equipe_papel(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin(); v_email text; v_papel text; alvo public.perfis;
begin
  v_email := public._v_email(p, 'email');
  v_papel := public._v_opcao(p, 'papel', array['admin', 'atendente', 'cliente'], 'Papel');
  select * into alvo from public.perfis where lower(email) = v_email;
  if not found then
    perform public._falha(404, 'Não achamos uma conta com este e-mail. Peça para a pessoa criar uma conta na loja primeiro.', 'email');
  end if;
  if alvo.id = adm.id and v_papel <> 'admin' then perform public._falha(409, 'Você não pode alterar o seu próprio acesso.'); end if;
  if alvo.papel = 'admin' and v_papel <> 'admin' and (select count(*) from public.perfis where papel = 'admin' and ativo) <= 1 then
    perform public._falha(422, 'É preciso manter ao menos um administrador ativo.');
  end if;
  update public.perfis set papel = v_papel where id = alvo.id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_equipe_ativo(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin(); alvo public.perfis; v boolean := public._v_bool(p, 'ativo');
begin
  select * into alvo from public.perfis where id::text = p ->> 'id' and papel in ('admin', 'atendente');
  if not found then perform public._falha(404, 'Usuário não encontrado.'); end if;
  if alvo.id = adm.id then perform public._falha(409, 'Você não pode desativar a própria conta.'); end if;
  if not v and alvo.papel = 'admin' and (select count(*) from public.perfis where papel = 'admin' and ativo) <= 1 then
    perform public._falha(422, 'É preciso manter ao menos um administrador ativo.');
  end if;
  update public.perfis set ativo = v where id = alvo.id;
  return jsonb_build_object('ok', true);
end $$;

/* ---------- Registro de atividade ---------- */
create table public.auditoria (
  id           bigint generated always as identity primary key,
  criado_em    timestamptz not null default now(),
  usuario_id   uuid,
  usuario_nome text not null default '',
  tabela       text not null,
  operacao     text not null check (operacao in ('criou', 'alterou', 'removeu')),
  registro     text not null default '',
  resumo       text not null default '',
  detalhes     jsonb not null default '{}'::jsonb
);
create index auditoria_criado_idx on public.auditoria (id desc);
alter table public.auditoria enable row level security;
revoke all on public.auditoria from anon, authenticated;

/* Grava quem mexeu em produtos, cupons, configurações etc. Só registra ações de quem está logado
   (importações e migrações não entram) e nunca guarda dados de clientes. */
create function public._auditar() returns trigger
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
    else left(coalesce(nullif(ref ->> 'nome', ''), nullif(ref ->> 'codigo', ''), nullif(ref ->> 'chave', ''), nullif(ref ->> 'data', ''), ref ->> 'id', ''), 120) end;
  select p.nome into nome from public.perfis p where p.id = uid;
  insert into public.auditoria (usuario_id, usuario_nome, tabela, operacao, registro, resumo, detalhes)
  values (uid, coalesce(nome, ''), tg_table_name, case tg_op when 'INSERT' then 'criou' when 'UPDATE' then 'alterou' else 'removeu' end,
          coalesce(ref ->> 'id', ref ->> 'chave', ref ->> 'data', ''), texto, diff);
  return coalesce(new, old);
end $$;

create trigger auditar_produtos          after insert or update or delete on public.produtos          for each row execute function public._auditar();
create trigger auditar_categorias        after insert or update or delete on public.categorias        for each row execute function public._auditar();
create trigger auditar_cupons            after insert or update or delete on public.cupons            for each row execute function public._auditar();
create trigger auditar_zonas             after insert or update or delete on public.zonas_entrega     for each row execute function public._auditar();
create trigger auditar_configuracoes     after insert or update or delete on public.configuracoes     for each row execute function public._auditar();
create trigger auditar_datas_bloqueadas  after insert or update or delete on public.datas_bloqueadas  for each row execute function public._auditar();
create trigger auditar_pagamentos        after insert or update or delete on public.pagamentos_pedido for each row execute function public._auditar();
create trigger auditar_perfis            after update on public.perfis                                for each row execute function public._auditar();

create function public.admin_auditoria(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin(); lim int := coalesce(public._v_int(p, 'limite', 1, 300, 'Limite', true), 100);
begin
  return jsonb_build_object('itens', coalesce((
    select jsonb_agg(jsonb_build_object('id', a.id, 'quando', public._fmt(a.criado_em), 'usuario', a.usuario_nome, 'tabela', a.tabela,
             'operacao', a.operacao, 'resumo', a.resumo, 'detalhes', a.detalhes) order by a.id desc)
      from (select * from public.auditoria order by id desc limit lim) a), '[]'::jsonb));
end $$;

/* ---------- LGPD: o cliente baixa e exclui os próprios dados ---------- */
create or replace function public.novo_usuario() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.perfis (id, nome, email, telefone, aceite_termos_em)
  values (
    new.id,
    left(coalesce(nullif(btrim(coalesce(new.raw_user_meta_data ->> 'nome', '')), ''), split_part(coalesce(new.email, ''), '@', 1)), 80),
    coalesce(new.email, ''),
    nullif(left(regexp_replace(coalesce(new.raw_user_meta_data ->> 'telefone', ''), '\D', '', 'g'), 11), ''),
    case when new.raw_user_meta_data ->> 'aceite' = 'true' then now() end
  )
  on conflict (id) do nothing;
  return new;
end $$;

create function public.cliente_exportar_dados(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare u public.perfis := public._cliente();
begin
  return jsonb_build_object(
    'gerado_em', public._fmt(now()),
    'perfil', jsonb_build_object('nome', u.nome, 'email', u.email, 'telefone', u.telefone, 'criado_em', public._fmt(u.criado_em),
                                 'aceite_termos_em', case when u.aceite_termos_em is null then null else public._fmt(u.aceite_termos_em) end),
    'enderecos', coalesce((select jsonb_agg(public._endereco_json(e) order by e.id) from public.enderecos e where e.usuario_id = u.id), '[]'::jsonb),
    'pedidos', coalesce((select jsonb_agg(public._pedido_completo(o.id) order by o.id) from public.pedidos o where o.usuario_id = u.id), '[]'::jsonb),
    'favoritos', coalesce((select jsonb_agg(pr.nome order by pr.nome) from public.favoritos f join public.produtos pr on pr.id = f.produto_id
                            where f.usuario_id = u.id), '[]'::jsonb),
    'avaliacoes', coalesce((select jsonb_agg(jsonb_build_object('nota', a.nota, 'comentario', a.comentario, 'criado_em', public._fmt(a.criado_em)) order by a.id)
                             from public.avaliacoes a where a.usuario_id = u.id), '[]'::jsonb));
end $$;

/** Exclui a conta. Pedidos antigos ficam só como registro de venda, sem nome, telefone nem endereço. */
create function public.cliente_excluir_conta(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare u public.perfis := public._cliente();
begin
  if exists (select 1 from public.pedidos where usuario_id = u.id and status not in ('entregue', 'cancelado')) then
    perform public._falha(409, 'Você tem pedidos em andamento. Depois que forem entregues (ou cancelados), poderá excluir a conta.');
  end if;
  update public.pedidos set usuario_id = null, cliente_nome = 'Cliente removido', cliente_telefone = null, endereco = null,
         lat = null, lng = null, observacoes = null where usuario_id = u.id;
  update public.pedido_historico set usuario_id = null where usuario_id = u.id;
  delete from auth.users where id = u.id; -- leva junto o perfil, os endereços, os favoritos e as avaliações
  return jsonb_build_object('ok', true);
end $$;

/* ---------- Primeiros passos da loja ---------- */
create function public.admin_checklist(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin(); cfg jsonb := public._cfg();
begin
  return jsonb_build_object('itens', jsonb_build_array(
    jsonb_build_object('id', 'produtos', 'titulo', 'Cadastrar seus produtos', 'dica', 'Foto, preço e descrição de cada doce.', 'link', '/produtos',
      'feito', exists (select 1 from public.produtos where ativo)),
    jsonb_build_object('id', 'loja', 'titulo', 'Conferir os dados da loja', 'dica', 'Nome, WhatsApp e endereço aparecem no site.', 'link', '/configuracoes/loja',
      'feito', coalesce(cfg #>> '{loja,whatsapp}', '') <> '' and coalesce(cfg #>> '{loja,endereco}', '') <> ''),
    jsonb_build_object('id', 'imagens', 'titulo', 'Enviar a logo e a foto de destaque', 'dica', 'Deixa o site com a sua cara.', 'link', '/configuracoes/imagens',
      'feito', coalesce(cfg #>> '{loja,logo}', '') <> '' and coalesce(cfg #>> '{textos,hero_imagem}', '') <> ''),
    jsonb_build_object('id', 'mapa', 'titulo', 'Marcar a loja no mapa', 'dica', 'Necessário para calcular o frete.', 'link', '/entrega',
      'feito', (cfg #>> '{loja,lat}') is not null and (cfg #>> '{loja,lng}') is not null),
    jsonb_build_object('id', 'zonas', 'titulo', 'Definir as faixas de entrega', 'dica', 'Distância, taxa e prazo de cada região.', 'link', '/entrega',
      'feito', exists (select 1 from public.zonas_entrega where ativa)),
    jsonb_build_object('id', 'pix', 'titulo', 'Configurar o PIX', 'dica', 'Para o cliente pagar (e para pedir sinal).', 'link', '/configuracoes/pagamento',
      'feito', coalesce((cfg #>> '{pagamento,pix_ativo}')::boolean, false) and coalesce(cfg #>> '{pagamento,pix_chave}', '') <> ''),
    jsonb_build_object('id', 'legal', 'titulo', 'Revisar política de privacidade e termos', 'dica', 'Ajuste os textos à sua realidade (de preferência com um advogado).', 'link', '/configuracoes/legal',
      'feito', coalesce(cfg #>> '{legal,privacidade}', '') <> '')));
end $$;

/* ---------- Permissões (as funções novas nascem trancadas) ---------- */
grant execute on function
  public.admin_auditoria(jsonb), public.admin_checklist(jsonb), public.cliente_exportar_dados(jsonb), public.cliente_excluir_conta(jsonb)
to authenticated;
