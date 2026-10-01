-- ==========================================================
-- 32) ENCOMENDA POR ORÇAMENTO — para o que não está no cardápio
-- (bolo de festa, tema, kit personalizado):
--   1. o cliente descreve o que quer, a data, para quantos, se
--      entrega ou retira, e manda até 3 fotos de referência;
--   2. a dona responde no painel com o valor, o sinal, a data e o
--      horário (ou recusa);
--   3. o cliente aceita em "Minha conta": vira um pedido de verdade
--      (origem "orcamento"), com o pagamento de sempre.
-- As fotos ficam no banco, pequenas (o navegador reduz antes de
-- mandar) e só a loja e o próprio cliente as veem.
-- Liga/desliga: configuração "orcamento" { ativo, texto } (ligado se nunca mexeram).
-- ==========================================================

create table public.orcamentos (
  loja_id          uuid not null default public._loja_atual() references public.lojas (id) on delete cascade,
  id               bigint generated always as identity (start with 101) primary key,
  usuario_id       uuid not null,
  cliente_nome     text not null,
  cliente_telefone text,
  descricao        text not null check (char_length(descricao) between 10 and 1500),
  quantidade       text not null default '' check (char_length(quantidade) <= 80),
  verba            text not null default '' check (char_length(verba) <= 60),
  data_desejada    date not null,
  tipo             text not null check (tipo in ('retirada', 'entrega')),
  endereco         jsonb,
  lat              double precision,
  lng              double precision,
  fotos            jsonb not null default '[]'::jsonb,
  status           text not null default 'novo' check (status in ('novo', 'respondido', 'aceito', 'recusado', 'cancelado')),
  resposta         jsonb,
  pedido_id        bigint,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),
  constraint orcamentos_loja_id_id_key unique (loja_id, id),
  constraint orcamentos_usuario_id_fkey foreign key (loja_id, usuario_id) references public.perfis (loja_id, id) on delete cascade,
  constraint orcamentos_pedido_id_fkey foreign key (loja_id, pedido_id) references public.pedidos (loja_id, id) on delete set null (pedido_id)
);
create index orcamentos_status_idx on public.orcamentos (loja_id, status, criado_em desc);
create index orcamentos_usuario_idx on public.orcamentos (loja_id, usuario_id, criado_em desc);
alter table public.orcamentos enable row level security;
create policy so_da_loja on public.orcamentos for all to forminha_app
  using (loja_id = (select public._loja())) with check (loja_id = (select public._loja()));
grant select, insert, update, delete on public.orcamentos to forminha_app;

-- o pedido que nasce de um orçamento tem origem própria (e o sinal combinado, não o automático)
alter table public.pedidos drop constraint if exists pedidos_origem_check;
alter table public.pedidos add constraint pedidos_origem_check check (origem in ('loja', 'manual', 'orcamento'));

/* ---------- ajudantes ---------- */
create function public._orcamento_json(o public.orcamentos, com_fotos boolean default false) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'id', o.id, 'cliente', jsonb_build_object('nome', o.cliente_nome, 'telefone', coalesce(o.cliente_telefone, '')),
    'descricao', o.descricao, 'quantidade', o.quantidade, 'verba', o.verba,
    'data_desejada', to_char(o.data_desejada, 'YYYY-MM-DD'), 'tipo', o.tipo, 'endereco', o.endereco,
    'fotos', case when com_fotos then o.fotos else '[]'::jsonb end, 'n_fotos', jsonb_array_length(o.fotos),
    'status', o.status, 'resposta', o.resposta,
    'pedido', (select jsonb_build_object('id', p.id, 'codigo', p.codigo, 'status', p.status) from public.pedidos p where p.id = o.pedido_id),
    'criado_em', o.criado_em, 'atualizado_em', o.atualizado_em)
$$;

/** Ligado, a menos que a dona tenha desligado. */
create function public._orcamento_ativo() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select (valor ->> 'ativo')::boolean from public.configuracoes where chave = 'orcamento'), true)
$$;
revoke all on function public._orcamento_ativo() from public, anon, authenticated;

/* ---------- a configuração pública passa a dizer se a loja recebe orçamentos ---------- */
do $$
declare def text; novo text;
begin
  def := pg_get_functiondef('public._base_loja_config(jsonb)'::regprocedure);
  if position('''orcamento''' in def) > 0 then return; end if;
  novo := replace(def, '''legal'', coalesce(cfg -> ''legal'', ''{}''::jsonb),',
    '''legal'', coalesce(cfg -> ''legal'', ''{}''::jsonb), ''orcamento'', jsonb_build_object(''ativo'', public._orcamento_ativo(), ''texto'', coalesce(cfg #>> ''{orcamento,texto}'', '''')),');
  if novo = def then raise exception '_base_loja_config: o trecho de "legal" não foi encontrado'; end if;
  execute novo;
end $$;

/* ---------- a contagem do menu do painel ganha os orçamentos novos ---------- */
do $$
declare def text; novo text;
begin
  def := pg_get_functiondef('public.admin_pedidos_contagem(jsonb)'::regprocedure);
  if position('orcamentos' in def) > 0 then return; end if;
  novo := replace(def, 'jsonb_build_object(''ativos'',', 'jsonb_build_object(''orcamentos'', (select count(*) from public.orcamentos where status = ''novo''), ''ativos'',');
  if novo = def then raise exception 'admin_pedidos_contagem: o trecho de "ativos" não foi encontrado'; end if;
  execute novo;
end $$;

/* ==========================================================
   CLIENTE
   ========================================================== */
create function public.cliente_pedir_orcamento(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  u public.perfis := public._cliente(); cfg jsonb := public._cfg();
  v_desc text; v_qtd text; v_verba text; v_data date; v_tipo text; e public.enderecos; v_end jsonb; f text; v_fotos jsonb := '[]'::jsonb; oid bigint;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if pg_column_size(p) > 1500000 then perform public._falha(413, 'As fotos estão grandes demais. Tente com menos fotos.'); end if;
  perform public._limitar('cliente_pedir_orcamento', 6, 3600);
  if not public._orcamento_ativo() then perform public._falha(409, 'Esta loja não está recebendo pedidos de orçamento no momento.'); end if;
  if public._loja_suspensa() then perform public._falha(423, 'No momento não estamos recebendo pedidos pelo site. Fale com a gente pelo WhatsApp.'); end if;
  if (select count(*) from public.orcamentos where usuario_id = u.id and status in ('novo', 'respondido')) >= 5 then
    perform public._falha(409, 'Você já tem orçamentos em aberto. Aguarde a resposta da loja ou cancele algum em “Minha conta”.');
  end if;

  v_desc := public._v_par(p, 'descricao', 1500, 'Descrição');
  if length(v_desc) < 10 then perform public._falha(422, 'Conte um pouco mais do que você quer (pelo menos 10 letras).', 'descricao'); end if;
  v_qtd := public._v_txt(p, 'quantidade', 0, 80, 'Quantidade');
  v_verba := public._v_txt(p, 'verba', 0, 60, 'Quanto pretende gastar');
  v_data := public._v_data(p, 'data_desejada');
  if v_data < hoje then perform public._falha(422, 'Escolha uma data a partir de hoje.', 'data_desejada'); end if;
  if v_data > hoje + 365 then perform public._falha(422, 'Escolha uma data em até um ano.', 'data_desejada'); end if;
  v_tipo := public._v_opcao(p, 'tipo', array['retirada', 'entrega'], 'Como receber');
  if v_tipo = 'entrega' and not coalesce((cfg #>> '{entrega,entrega_ativa}')::boolean, false) then
    perform public._falha(422, 'Esta loja não faz entregas no momento.', 'tipo');
  end if;
  if v_tipo = 'retirada' and not coalesce((cfg #>> '{entrega,retirada_ativa}')::boolean, true) then
    perform public._falha(422, 'Esta loja não tem retirada no momento.', 'tipo');
  end if;
  if v_tipo = 'entrega' then
    select * into e from public.enderecos where id::text = p ->> 'endereco_id' and usuario_id = u.id;
    if not found then perform public._falha(422, 'Escolha o endereço de entrega.', 'endereco_id'); end if;
    v_end := jsonb_build_object('apelido', e.apelido, 'cep', e.cep, 'rua', e.rua, 'numero', e.numero, 'complemento', e.complemento,
      'bairro', e.bairro, 'cidade', e.cidade, 'uf', e.uf, 'referencia', e.referencia);
  end if;

  if p ? 'fotos' then
    if jsonb_typeof(p -> 'fotos') is distinct from 'array' or jsonb_array_length(p -> 'fotos') > 3 then
      perform public._falha(422, 'Envie até 3 fotos de referência.', 'fotos');
    end if;
    for f in select jsonb_array_elements_text(p -> 'fotos') loop
      if f !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$' or length(f) > 450000 then
        perform public._falha(422, 'Uma das fotos não pôde ser usada. Tente outra (JPG ou PNG).', 'fotos');
      end if;
      v_fotos := v_fotos || to_jsonb(f);
    end loop;
  end if;

  insert into public.orcamentos (usuario_id, cliente_nome, cliente_telefone, descricao, quantidade, verba, data_desejada, tipo, endereco, lat, lng, fotos)
  values (u.id, u.nome, u.telefone, v_desc, v_qtd, v_verba, v_data, v_tipo, v_end, e.lat, e.lng, v_fotos)
  returning id into oid;
  return jsonb_build_object('orcamento', (select public._orcamento_json(o) from public.orcamentos o where o.id = oid));
end $$;

create function public.cliente_orcamentos(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare u public.perfis := public._cliente();
begin
  return jsonb_build_object('orcamentos', coalesce((select jsonb_agg(public._orcamento_json(o) order by o.criado_em desc)
    from public.orcamentos o where o.usuario_id = u.id), '[]'::jsonb)); -- sem as fotos (só a loja precisa delas)
end $$;

create function public.cliente_cancelar_orcamento(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare u public.perfis := public._cliente(); o public.orcamentos;
begin
  select * into o from public.orcamentos where id::text = p ->> 'id' and usuario_id = u.id for update;
  if not found then perform public._falha(404, 'Orçamento não encontrado.'); end if;
  if o.status not in ('novo', 'respondido') then perform public._falha(409, 'Este orçamento não pode mais ser cancelado.'); end if;
  update public.orcamentos set status = 'cancelado', atualizado_em = now() where id = o.id returning * into o;
  return jsonb_build_object('orcamento', public._orcamento_json(o));
end $$;

/** Aceitar a proposta: vira um pedido confirmado, com o valor, a data, o horário e o sinal combinados. */
create function public.cliente_aceitar_orcamento(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  u public.perfis := public._cliente(); cfg jsonb := public._cfg(); o public.orcamentos; r jsonb; forma text;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date; valor int; taxa int; pid bigint;
begin
  perform public._limitar('cliente_aceitar_orcamento', 10, 60);
  select * into o from public.orcamentos where id::text = p ->> 'id' and usuario_id = u.id for update;
  if not found then perform public._falha(404, 'Orçamento não encontrado.'); end if;
  if o.status <> 'respondido' then perform public._falha(409, 'Este orçamento não está esperando a sua resposta.'); end if;
  r := o.resposta;
  if (r ->> 'valido_ate')::date < hoje then perform public._falha(409, 'A proposta venceu. Peça para a loja atualizar o valor.'); end if;
  if public._loja_suspensa() then perform public._falha(423, 'No momento não estamos recebendo pedidos pelo site. Fale com a gente pelo WhatsApp.'); end if;

  forma := public._v_opcao(p, 'pagamento', array['pix', 'dinheiro', 'cartao_entrega'], 'Forma de pagamento');
  if (forma = 'pix' and not ((coalesce((cfg #>> '{pagamento,pix_ativo}')::boolean, false) and coalesce(cfg #>> '{pagamento,pix_chave}', '') <> '')
                              or coalesce((cfg #>> '{gateway,ativo}')::boolean, false)))
     or (forma = 'dinheiro' and not coalesce((cfg #>> '{pagamento,dinheiro_ativo}')::boolean, false))
     or (forma = 'cartao_entrega' and not coalesce((cfg #>> '{pagamento,cartao_ativo}')::boolean, false)) then
    perform public._falha(422, 'Esta forma de pagamento não está disponível.', 'pagamento');
  end if;

  valor := (r ->> 'valor')::int;
  taxa := case when o.tipo = 'entrega' then coalesce((r ->> 'taxa_entrega')::int, 0) else 0 end;
  insert into public.pedidos (usuario_id, cliente_nome, cliente_telefone, status, tipo, endereco, lat, lng, data_agendada, hora_agendada, pagamento,
      subtotal, taxa_entrega, desconto, total, observacoes, origem, sinal)
  values (u.id, u.nome, u.telefone, 'confirmado', o.tipo, o.endereco, o.lat, o.lng, (r ->> 'data')::date, r ->> 'hora', forma,
      valor, taxa, 0, valor + taxa, left('Orçamento #' || o.id || ': ' || o.descricao, 500), 'orcamento', least(coalesce((r ->> 'sinal')::int, 0), valor + taxa))
  returning id into pid;
  update public.pedidos set codigo = public._codigo_pedido() where id = pid;
  insert into public.pedido_itens (pedido_id, produto_id, nome, unidade, preco_unit, qtd, opcoes, obs, total)
  values (pid, null, left(coalesce(nullif(r ->> 'titulo', ''), 'Encomenda personalizada'), 80), 'un', valor, 1, '[]'::jsonb,
          nullif(left(o.descricao, 200), ''), valor);
  insert into public.pedido_historico (pedido_id, status, nota, usuario_id) values (pid, 'confirmado', 'Orçamento #' || o.id || ' aceito pelo cliente', u.id);
  update public.orcamentos set status = 'aceito', pedido_id = pid, atualizado_em = now() where id = o.id;

  return jsonb_build_object('pedido', jsonb_build_object('codigo', (select codigo from public.pedidos where id = pid)));
end $$;

/* ==========================================================
   PAINEL
   ========================================================== */
create function public.admin_orcamentos(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare staff public.perfis := public._staff(); filtro text := coalesce(nullif(p ->> 'status', ''), 'todos');
begin
  if filtro not in ('todos', 'novo', 'respondido', 'aceito', 'recusado', 'cancelado') then perform public._falha(422, 'Filtro inválido.'); end if;
  return jsonb_build_object(
    'orcamentos', coalesce((select jsonb_agg(public._orcamento_json(o) order by (o.status = 'novo') desc, o.criado_em desc)
                              from public.orcamentos o
                             where o.id in (select id from public.orcamentos where filtro = 'todos' or status = filtro order by criado_em desc limit 300)), '[]'::jsonb),
    'contagem', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) as n from public.orcamentos group by status) t), '{}'::jsonb),
    'ativo', public._orcamento_ativo(),
    'texto', coalesce(public._cfg() #>> '{orcamento,texto}', ''));
end $$;

create function public.admin_orcamento(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare staff public.perfis := public._staff(); o public.orcamentos;
begin
  select * into o from public.orcamentos where id::text = p ->> 'id';
  if not found then perform public._falha(404, 'Orçamento não encontrado.'); end if;
  return jsonb_build_object('orcamento', public._orcamento_json(o, true));
end $$;

create function public.admin_responder_orcamento(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  staff public.perfis := public._staff(); o public.orcamentos; valor int; taxa int; sinal int; v_data date; v_hora text; dias int;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  select * into o from public.orcamentos where id::text = p ->> 'id' for update;
  if not found then perform public._falha(404, 'Orçamento não encontrado.'); end if;
  if o.status not in ('novo', 'respondido') then perform public._falha(409, 'Este orçamento já foi encerrado.'); end if;
  valor := public._v_int(p, 'valor', 100, 100000000, 'Valor');
  taxa := case when o.tipo = 'entrega' then coalesce(public._v_int(p, 'taxa_entrega', 0, 1000000, 'Taxa de entrega', true), 0) else 0 end;
  sinal := coalesce(public._v_int(p, 'sinal', 0, 100000000, 'Sinal', true), 0);
  if sinal > valor + taxa then perform public._falha(422, 'O sinal não pode passar do total.', 'sinal'); end if;
  v_data := public._v_data(p, 'data');
  if v_data < hoje then perform public._falha(422, 'Escolha uma data a partir de hoje.', 'data'); end if;
  v_hora := coalesce(p ->> 'hora', '');
  if v_hora !~ '^([01]\d|2[0-3]):[0-5]\d$' then perform public._falha(422, 'Informe o horário.', 'hora'); end if;
  dias := coalesce(public._v_int(p, 'validade_dias', 1, 60, 'Validade da proposta', true), 7);
  update public.orcamentos set status = 'respondido', atualizado_em = now(), resposta = jsonb_build_object(
      'titulo', public._v_txt(p, 'titulo', 0, 80, 'Nome da encomenda'),
      'valor', valor, 'taxa_entrega', taxa, 'sinal', sinal, 'total', valor + taxa,
      'data', to_char(v_data, 'YYYY-MM-DD'), 'hora', v_hora,
      'mensagem', public._v_par(p, 'mensagem', 1000, 'Mensagem'),
      'valido_ate', to_char(hoje + dias, 'YYYY-MM-DD'), 'respondido_em', now())
   where id = o.id returning * into o;
  return jsonb_build_object('orcamento', public._orcamento_json(o, true));
end $$;

create function public.admin_recusar_orcamento(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare staff public.perfis := public._staff(); o public.orcamentos;
begin
  select * into o from public.orcamentos where id::text = p ->> 'id' for update;
  if not found then perform public._falha(404, 'Orçamento não encontrado.'); end if;
  if o.status not in ('novo', 'respondido') then perform public._falha(409, 'Este orçamento já foi encerrado.'); end if;
  update public.orcamentos set status = 'recusado', atualizado_em = now(),
         resposta = coalesce(resposta, '{}'::jsonb) || jsonb_build_object('mensagem', public._v_par(p, 'mensagem', 1000, 'Mensagem'), 'respondido_em', now())
   where id = o.id returning * into o;
  return jsonb_build_object('orcamento', public._orcamento_json(o, true));
end $$;

create function public.admin_salvar_orcamento_config(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin(); novo jsonb;
begin
  novo := jsonb_build_object('ativo', public._v_bool(p, 'ativo'), 'texto', public._v_txt(p, 'texto', 0, 200, 'Texto do convite'));
  insert into public.configuracoes (chave, valor) values ('orcamento', novo)
  on conflict (loja_id, chave) do update set valor = excluded.valor;
  return jsonb_build_object('ativo', novo -> 'ativo', 'texto', novo -> 'texto');
end $$;

/* ---------- quem pode chamar, e o papel que só vê a loja da vez ---------- */
revoke all on function public._orcamento_json(public.orcamentos, boolean) from public, anon, authenticated;
grant execute on function public.cliente_pedir_orcamento(jsonb), public.cliente_orcamentos(jsonb), public.cliente_cancelar_orcamento(jsonb),
  public.cliente_aceitar_orcamento(jsonb), public.admin_orcamentos(jsonb), public.admin_orcamento(jsonb), public.admin_responder_orcamento(jsonb),
  public.admin_recusar_orcamento(jsonb), public.admin_salvar_orcamento_config(jsonb) to authenticated;
revoke execute on function public.cliente_pedir_orcamento(jsonb), public.cliente_orcamentos(jsonb), public.cliente_cancelar_orcamento(jsonb),
  public.cliente_aceitar_orcamento(jsonb), public.admin_orcamentos(jsonb), public.admin_orcamento(jsonb), public.admin_responder_orcamento(jsonb),
  public.admin_recusar_orcamento(jsonb), public.admin_salvar_orcamento_config(jsonb) from anon, public;

grant create on schema public to forminha_app;
alter function public._orcamento_ativo() owner to forminha_app;
alter function public.cliente_pedir_orcamento(jsonb) owner to forminha_app;
alter function public.cliente_orcamentos(jsonb) owner to forminha_app;
alter function public.cliente_cancelar_orcamento(jsonb) owner to forminha_app;
alter function public.cliente_aceitar_orcamento(jsonb) owner to forminha_app;
alter function public.admin_orcamentos(jsonb) owner to forminha_app;
alter function public.admin_orcamento(jsonb) owner to forminha_app;
alter function public.admin_responder_orcamento(jsonb) owner to forminha_app;
alter function public.admin_recusar_orcamento(jsonb) owner to forminha_app;
alter function public.admin_salvar_orcamento_config(jsonb) owner to forminha_app;
revoke create on schema public from forminha_app;
