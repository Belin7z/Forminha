-- ==========================================================
-- 3) LOJA — conteúdo público e conta do cliente
-- Convenção: cada função da API recebe um único jsonb `p` e devolve
-- exatamente o corpo de resposta que a tela espera.
-- ==========================================================

-- ---------- Serializadores (internos) ----------
create function public._produto_json(pr public.produtos) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'id', pr.id, 'categoria_id', pr.categoria_id, 'nome', pr.nome, 'descricao', pr.descricao, 'preco', pr.preco,
    'unidade', pr.unidade, 'min_qtd', pr.min_qtd, 'emoji', pr.emoji, 'imagem', pr.imagem, 'tag', pr.tag,
    'opcoes', pr.opcoes, 'antecedencia_horas', pr.antecedencia_horas, 'ativo', pr.ativo,
    'destaque', pr.destaque, 'ordem', pr.ordem)
$$;

create function public._endereco_json(e public.enderecos) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'id', e.id, 'apelido', e.apelido, 'cep', e.cep, 'rua', e.rua, 'numero', e.numero,
    'complemento', coalesce(e.complemento, ''), 'bairro', e.bairro, 'cidade', e.cidade, 'uf', e.uf,
    'referencia', coalesce(e.referencia, ''), 'lat', e.lat, 'lng', e.lng, 'principal', e.principal)
$$;

create function public._perfil_json(u public.perfis) returns jsonb
language sql stable as $$
  select jsonb_build_object('id', u.id, 'nome', u.nome, 'email', u.email, 'telefone', coalesce(u.telefone, ''),
    'papel', u.papel, 'ativo', u.ativo, 'criado_em', public._fmt(u.criado_em))
$$;

-- ---------- Perfil de quem está logado (loja e painel) ----------
create function public.perfil_atual(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare u public.perfis;
begin
  if auth.uid() is null then return null; end if;
  select * into u from public.perfis where id = auth.uid();
  if not found then return null; end if;
  update public.perfis set ultimo_acesso = now()
   where id = u.id and (ultimo_acesso is null or ultimo_acesso < now() - interval '10 minutes');
  return public._perfil_json(u);
end $$;

-- ---------- Configuração pública (sem a chave PIX) ----------
create function public.loja_config(p jsonb default '{}'::jsonb) returns jsonb
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
  return jsonb_build_object(
    'loja', coalesce(cfg -> 'loja', '{}'::jsonb), 'textos', coalesce(cfg -> 'textos', '{}'::jsonb),
    'horarios', coalesce(cfg -> 'horarios', '{}'::jsonb), 'pedidos', coalesce(cfg -> 'pedidos', '{}'::jsonb),
    'entrega', coalesce(cfg -> 'entrega', '{}'::jsonb), 'pagamento', pag,
    'zonas', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'ate_km', ate_km, 'taxa', taxa, 'prazo_min', prazo_min) order by ate_km)
                         from public.zonas_entrega where ativa), '[]'::jsonb),
    'aberta_agora', aberta);
end $$;

-- ---------- Catálogo (só categorias e produtos ativos) ----------
create function public.loja_catalogo(p jsonb default '{}'::jsonb) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'categorias', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'emoji', emoji, 'ordem', ordem, 'ativa', ativa) order by ordem, id)
                              from public.categorias where ativa), '[]'::jsonb),
    'produtos', coalesce((
      select jsonb_agg(public._produto_json(pr) || jsonb_build_object('vendidos', coalesce(v.n, 0)) order by pr.ordem, pr.id)
        from public.produtos pr
        join public.categorias c on c.id = pr.categoria_id and c.ativa
        left join (select i.produto_id, sum(i.qtd) as n from public.pedido_itens i
                     join public.pedidos o on o.id = i.pedido_id
                    where o.status <> 'cancelado' and i.produto_id is not null group by i.produto_id) v on v.produto_id = pr.id
       where pr.ativo), '[]'::jsonb),
    'favoritos', coalesce((select jsonb_agg(produto_id) from public.favoritos where usuario_id = auth.uid()), '[]'::jsonb))
$$;

-- ---------- Avaliações aprovadas (aparecem na página inicial) ----------
create function public.loja_avaliacoes(p jsonb default '{}'::jsonb) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'avaliacoes', coalesce((
      select jsonb_agg(jsonb_build_object('nota', a.nota, 'comentario', a.comentario, 'resposta', a.resposta,
                                          'criado_em', public._fmt(a.criado_em), 'nome', split_part(u.nome, ' ', 1)) order by a.id desc)
        from (select * from public.avaliacoes where aprovada and coalesce(comentario, '') <> '' order by id desc limit 12) a
        join public.perfis u on u.id = a.usuario_id), '[]'::jsonb),
    'media', (select round(avg(nota)::numeric, 1) from public.avaliacoes where aprovada),
    'total', (select count(*) from public.avaliacoes where aprovada))
$$;

-- ---------- Conta do cliente ----------
create function public.cliente_atualizar_perfil(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare u public.perfis := public._cliente(); v_nome text; v_tel text;
begin
  v_nome := public._v_txt(p, 'nome', 2, 80, 'Nome');
  v_tel  := public._v_tel(p, 'telefone');
  update public.perfis set nome = v_nome, telefone = v_tel where id = u.id returning * into u;
  return jsonb_build_object('usuario', public._perfil_json(u));
end $$;

-- ---------- Endereços ----------
create function public._enderecos_do(uid uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(public._endereco_json(e) order by e.principal desc, e.id), '[]'::jsonb)
    from public.enderecos e where e.usuario_id = uid
$$;

create function public.cliente_enderecos(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare u public.perfis := public._cliente();
begin
  return jsonb_build_object('enderecos', public._enderecos_do(u.id));
end $$;

/** Cria (sem `id`) ou atualiza (com `id`) um endereço do cliente. */
create function public.cliente_salvar_endereco(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  u public.perfis := public._cliente();
  eid bigint := nullif(p ->> 'id', '')::bigint;
  v_apelido text; v_cep text; v_rua text; v_numero text; v_compl text; v_bairro text; v_cidade text; v_uf text; v_ref text;
  v_lat double precision; v_lng double precision; v_principal boolean;
begin
  v_apelido := public._v_txt(p, 'apelido', 1, 30, 'Apelido');
  v_cep     := public._v_cep(p, 'cep');
  v_rua     := public._v_txt(p, 'rua', 2, 120, 'Rua');
  v_numero  := public._v_txt(p, 'numero', 1, 10, 'Número');
  v_compl   := public._v_txt(p, 'complemento', 0, 60, 'Complemento');
  v_bairro  := public._v_txt(p, 'bairro', 2, 80, 'Bairro');
  v_cidade  := public._v_txt(p, 'cidade', 2, 80, 'Cidade');
  v_uf      := upper(public._v_txt(p, 'uf', 2, 2, 'UF'));
  v_ref     := public._v_txt(p, 'referencia', 0, 120, 'Ponto de referência');
  v_lat     := public._v_num(p, 'lat', -90, 90, 'Latitude', true);
  v_lng     := public._v_num(p, 'lng', -180, 180, 'Longitude', true);
  v_principal := public._v_bool(p, 'principal');

  if eid is null then
    if (select count(*) from public.enderecos where usuario_id = u.id) >= 10 then
      perform public._falha(409, 'Você pode salvar até 10 endereços.');
    end if;
    -- o primeiro endereço da conta é sempre o principal
    v_principal := v_principal or not exists (select 1 from public.enderecos where usuario_id = u.id);
    if v_principal then update public.enderecos set principal = false where usuario_id = u.id; end if;
    insert into public.enderecos (usuario_id, apelido, cep, rua, numero, complemento, bairro, cidade, uf, referencia, lat, lng, principal)
    values (u.id, v_apelido, v_cep, v_rua, v_numero, v_compl, v_bairro, v_cidade, v_uf, v_ref, v_lat, v_lng, v_principal);
  else
    if not exists (select 1 from public.enderecos where id = eid and usuario_id = u.id) then
      perform public._falha(404, 'Endereço não encontrado.');
    end if;
    if v_principal then update public.enderecos set principal = false where usuario_id = u.id; end if;
    update public.enderecos set apelido = v_apelido, cep = v_cep, rua = v_rua, numero = v_numero, complemento = v_compl,
           bairro = v_bairro, cidade = v_cidade, uf = v_uf, referencia = v_ref, lat = v_lat, lng = v_lng, principal = v_principal
     where id = eid and usuario_id = u.id;
  end if;
  return jsonb_build_object('enderecos', public._enderecos_do(u.id));
end $$;

create function public.cliente_excluir_endereco(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare u public.perfis := public._cliente(); eid bigint := (p ->> 'id')::bigint; era_principal boolean;
begin
  select principal into era_principal from public.enderecos where id = eid and usuario_id = u.id;
  if not found then perform public._falha(404, 'Endereço não encontrado.'); end if;
  delete from public.enderecos where id = eid and usuario_id = u.id;
  -- se removeu o principal, promove o mais antigo que restar
  if era_principal then
    update public.enderecos set principal = true
     where id = (select id from public.enderecos where usuario_id = u.id order by id limit 1);
  end if;
  return jsonb_build_object('enderecos', public._enderecos_do(u.id));
end $$;

-- ---------- Favoritos ----------
create function public.cliente_favorito(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare u public.perfis := public._cliente(); pid bigint := (p ->> 'produto_id')::bigint; ligar boolean := public._v_bool(p, 'ligado');
begin
  if not exists (select 1 from public.produtos where id = pid) then perform public._falha(404, 'Produto não encontrado.'); end if;
  if ligar then
    insert into public.favoritos (usuario_id, produto_id) values (u.id, pid) on conflict do nothing;
  else
    delete from public.favoritos where usuario_id = u.id and produto_id = pid;
  end if;
  return jsonb_build_object('favorito', ligar);
end $$;
