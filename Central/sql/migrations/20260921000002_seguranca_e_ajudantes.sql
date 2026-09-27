-- ==========================================================
-- 2) SEGURANÇA E AJUDANTES
-- Modelo: as tabelas ficam TRANCADAS (RLS ligada, sem políticas e
-- sem permissões para anon/authenticated). Todo acesso passa por
-- funções (RPC) que conferem quem está chamando com auth.uid().
-- Assim o navegador nunca escreve direto nas tabelas e as regras
-- (preço, frete, cupom, horário) não podem ser burladas.
-- ==========================================================

alter table public.perfis            enable row level security;
alter table public.enderecos         enable row level security;
alter table public.categorias        enable row level security;
alter table public.produtos          enable row level security;
alter table public.favoritos         enable row level security;
alter table public.cupons            enable row level security;
alter table public.zonas_entrega     enable row level security;
alter table public.pedidos           enable row level security;
alter table public.pedido_itens      enable row level security;
alter table public.pedido_historico  enable row level security;
alter table public.avaliacoes        enable row level security;
alter table public.configuracoes     enable row level security;

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- ---------- Erros que o navegador entende ----------
-- PT422 vira HTTP 422 no PostgREST (Supabase). `campos` = {"campo": "mensagem"}.
create function public._falha(status int, mensagem text, campo text default null, campos jsonb default null)
returns void language plpgsql as $$
begin
  raise exception using
    errcode = format('PT%s', status),
    message = mensagem,
    detail  = coalesce(coalesce(campos, case when campo is not null then jsonb_build_object(campo, mensagem) end)::text, '');
end $$;

-- ---------- Quem está chamando ----------
create function public.e_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.perfis where id = auth.uid() and papel = 'admin' and ativo)
$$;

create function public._cliente() returns public.perfis
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare u public.perfis;
begin
  if auth.uid() is null then perform public._falha(401, 'Faça login para continuar.'); end if;
  select * into u from public.perfis where id = auth.uid();
  if not found then perform public._falha(401, 'Faça login para continuar.'); end if;
  if not u.ativo then perform public._falha(401, 'Esta conta está desativada. Fale com a loja.'); end if;
  return u;
end $$;

create function public._admin() returns public.perfis
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare u public.perfis;
begin
  if auth.uid() is null then perform public._falha(401, 'Faça login para continuar.'); end if;
  select * into u from public.perfis where id = auth.uid();
  if not found or not u.ativo then perform public._falha(401, 'Faça login para continuar.'); end if;
  if u.papel <> 'admin' then perform public._falha(403, 'Este acesso é restrito a administradores.'); end if;
  return u;
end $$;

-- ---------- Datas e textos ----------
create function public._fuso() returns text language sql immutable as $$ select 'America/Sao_Paulo' $$;

/** Horário local (São Paulo) como "2026-09-20 19:30:00" — o formato que as telas esperam. */
create function public._fmt(t timestamptz) returns text language sql stable as $$
  select case when t is null then null else to_char(t at time zone 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI:SS') end
$$;

create function public._brl(centavos bigint) returns text language sql immutable as $$
  select 'R$ ' || replace(to_char(centavos / 100.0, 'FM9999999990.00'), '.', ',')
$$;

create function public._cfg() returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_object_agg(chave, valor), '{}'::jsonb) from public.configuracoes
$$;

-- ---------- Validação ----------
-- Cada função lê `p ->> campo`, valida e devolve o valor limpo (ou responde 422 com o campo).
create function public._v_txt(p jsonb, campo text, minimo int, maximo int, rotulo text) returns text
language plpgsql immutable as $$
declare t text;
begin
  t := btrim(regexp_replace(coalesce(p ->> campo, ''), '\s+', ' ', 'g'));
  if length(t) < minimo then
    perform public._falha(422, case when minimo = 1 then rotulo || ' é obrigatório.' else rotulo || ': mínimo de ' || minimo || ' caracteres.' end, campo);
  end if;
  if length(t) > maximo then perform public._falha(422, rotulo || ': máximo de ' || maximo || ' caracteres.', campo); end if;
  return t;
end $$;

/** Texto livre com quebras de linha. */
create function public._v_par(p jsonb, campo text, maximo int, rotulo text) returns text
language plpgsql immutable as $$
declare t text := btrim(replace(coalesce(p ->> campo, ''), E'\r', ''));
begin
  if length(t) > maximo then perform public._falha(422, rotulo || ': máximo de ' || maximo || ' caracteres.', campo); end if;
  return t;
end $$;

create function public._v_int(p jsonb, campo text, minimo bigint, maximo bigint, rotulo text, opcional boolean default false) returns bigint
language plpgsql immutable as $$
declare v jsonb := p -> campo; n numeric;
begin
  if opcional and (v is null or v = 'null'::jsonb or v = '""'::jsonb) then return null; end if;
  if v is null or jsonb_typeof(v) not in ('number', 'string') or (jsonb_typeof(v) = 'string' and (v #>> '{}') !~ '^-?\d+$') then
    perform public._falha(422, rotulo || ': informe um número inteiro.', campo);
  end if;
  n := (v #>> '{}')::numeric;
  if n <> trunc(n) then perform public._falha(422, rotulo || ': informe um número inteiro.', campo); end if;
  if n < minimo or n > maximo then perform public._falha(422, rotulo || ': deve estar entre ' || minimo || ' e ' || maximo || '.', campo); end if;
  return n::bigint;
end $$;

create function public._v_num(p jsonb, campo text, minimo double precision, maximo double precision, rotulo text, opcional boolean default false) returns double precision
language plpgsql immutable as $$
declare v jsonb := p -> campo; n double precision;
begin
  if opcional and (v is null or v = 'null'::jsonb or v = '""'::jsonb) then return null; end if;
  if v is null or jsonb_typeof(v) not in ('number', 'string') or (jsonb_typeof(v) = 'string' and replace(v #>> '{}', ',', '.') !~ '^-?\d+(\.\d+)?$') then
    perform public._falha(422, rotulo || ': informe um número.', campo);
  end if;
  n := replace(v #>> '{}', ',', '.')::double precision;
  if n < minimo or n > maximo then perform public._falha(422, rotulo || ': deve estar entre ' || minimo || ' e ' || maximo || '.', campo); end if;
  return n;
end $$;

create function public._v_bool(p jsonb, campo text) returns boolean
language sql immutable as $$ select coalesce((p ->> campo) in ('true', 't', '1', 'on'), false) $$;

create function public._v_opcao(p jsonb, campo text, permitidas text[], rotulo text) returns text
language plpgsql immutable as $$
begin
  if not (coalesce(p ->> campo, '') = any (permitidas)) then perform public._falha(422, rotulo || ' inválido.', campo); end if;
  return p ->> campo;
end $$;

create function public._v_email(p jsonb, campo text) returns text
language plpgsql immutable as $$
declare t text := lower(btrim(coalesce(p ->> campo, '')));
begin
  if t !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' or length(t) > 120 then perform public._falha(422, 'Informe um e-mail válido.', campo); end if;
  return t;
end $$;

/** Telefone brasileiro: guarda só os dígitos (10 ou 11), sem o 55. */
create function public._v_tel(p jsonb, campo text, obrigatorio boolean default true) returns text
language plpgsql immutable as $$
declare d text := regexp_replace(coalesce(p ->> campo, ''), '\D', '', 'g');
begin
  if length(d) in (12, 13) and left(d, 2) = '55' then d := substr(d, 3); end if;
  if d = '' and not obrigatorio then return ''; end if;
  if length(d) < 10 or length(d) > 11 then perform public._falha(422, 'Informe um telefone com DDD.', campo); end if;
  return d;
end $$;

create function public._v_cep(p jsonb, campo text) returns text
language plpgsql immutable as $$
declare d text := regexp_replace(coalesce(p ->> campo, ''), '\D', '', 'g');
begin
  if length(d) <> 8 then perform public._falha(422, 'Informe um CEP com 8 dígitos.', campo); end if;
  return left(d, 5) || '-' || substr(d, 6);
end $$;

create function public._v_data(p jsonb, campo text, opcional boolean default false) returns date
language plpgsql immutable as $$
declare t text := coalesce(p ->> campo, '');
begin
  if opcional and t = '' then return null; end if;
  if t !~ '^\d{4}-\d{2}-\d{2}$' then perform public._falha(422, 'Informe uma data válida.', campo); end if;
  return t::date;
exception when datetime_field_overflow or invalid_datetime_format then
  perform public._falha(422, 'Informe uma data válida.', campo);
  return null;
end $$;

create function public._prob(problemas jsonb, campo text, mensagem text) returns jsonb
language sql immutable as $$ select problemas || jsonb_build_array(jsonb_build_object('campo', campo, 'mensagem', mensagem)) $$;

-- ---------- Máquina de estados do pedido ----------
create function public._status_texto(status text, tipo text) returns text
language sql immutable as $$
  select case
    when tipo = 'retirada' and status = 'pronto' then 'Pronto para retirada'
    when tipo = 'retirada' and status = 'entregue' then 'Retirado'
    else case status
      when 'novo' then 'Pedido recebido' when 'confirmado' then 'Confirmado' when 'em_preparo' then 'Em preparo'
      when 'pronto' then 'Pronto' when 'saiu_entrega' then 'Saiu para entrega' when 'entregue' then 'Entregue'
      when 'cancelado' then 'Cancelado' else status end
  end
$$;

/** Para quais status o pedido pode ir (cancelar é sempre possível antes do fim). */
create function public._proximos(status text, tipo text) returns text[]
language sql immutable as $$
  select case status
    when 'novo' then array['confirmado', 'cancelado']
    when 'confirmado' then array['em_preparo', 'cancelado']
    when 'em_preparo' then array['pronto', 'cancelado']
    when 'pronto' then case when tipo = 'entrega' then array['saiu_entrega', 'entregue', 'cancelado'] else array['entregue', 'cancelado'] end
    when 'saiu_entrega' then array['entregue', 'cancelado']
    else array[]::text[]
  end
$$;

-- ---------- Frete: distância entre dois pontos (Haversine, em km) ----------
create function public._distancia_km(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $$
  select 6371 * 2 * atan2(
    sqrt(sin(radians(lat2 - lat1) / 2) ^ 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(radians(lng2 - lng1) / 2) ^ 2),
    sqrt(1 - (sin(radians(lat2 - lat1) / 2) ^ 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(radians(lng2 - lng1) / 2) ^ 2)))
$$;

/** { status: ok|fora|sem_local, distancia_km, taxa, zona, prazo_min } — a mesma regra que a loja mostra. */
create function public._faixa_entrega(cfg jsonb, lat double precision, lng double precision) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  z record; dist double precision; lat0 double precision; lng0 double precision; temzonas boolean;
begin
  select exists (select 1 from public.zonas_entrega where ativa) into temzonas;
  if not temzonas then
    return jsonb_build_object('status', 'ok', 'distancia_km', null, 'taxa', coalesce((cfg #>> '{entrega,taxa_padrao}')::int, 0), 'zona', null, 'prazo_min', null);
  end if;
  lat0 := nullif(cfg #>> '{loja,lat}', '')::double precision;
  lng0 := nullif(cfg #>> '{loja,lng}', '')::double precision;
  if lat is null or lng is null or lat0 is null or lng0 is null then
    return jsonb_build_object('status', 'sem_local', 'distancia_km', null, 'taxa', 0, 'zona', null, 'prazo_min', null);
  end if;
  dist := round((public._distancia_km(lat0, lng0, lat, lng))::numeric, 1);
  select * into z from public.zonas_entrega where ativa and dist <= ate_km order by ate_km limit 1;
  if not found then
    return jsonb_build_object('status', 'fora', 'distancia_km', dist, 'taxa', 0, 'zona', null, 'prazo_min', null);
  end if;
  return jsonb_build_object('status', 'ok', 'distancia_km', dist, 'taxa', z.taxa,
    'zona', jsonb_build_object('id', z.id, 'nome', z.nome), 'prazo_min', z.prazo_min);
end $$;
