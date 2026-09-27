-- ==========================================================
-- FORMINHA — a mesma base serve qualquer doceria.
--  1. Aparência da loja (tema pronto ou 3 cores próprias + estilo de letra),
--     guardada no banco e entregue junto da configuração pública.
--  2. Convite de primeiro acesso: o script `npm run nova-loja` gera um link
--     único; quem abre cria a própria conta já como administradora.
--  3. Primeiros passos (Visão geral) ganham "Escolher a aparência".
-- ==========================================================

/* ---------- 1. Aparência ---------- */
-- Os temas prontos e o gerador de cores ficam no site (src/scripts/base/tema.js);
-- aqui só se confere que nada estranho chegue até ele.
create function public._aparencia_valida(d jsonb) returns jsonb
language plpgsql stable set search_path = public, pg_temp as $$
declare
  tema text := coalesce(nullif(btrim(d ->> 'tema'), ''), 'neutro');
  fonte text := coalesce(nullif(btrim(d ->> 'fonte'), ''), 'elegante');
  cores jsonb := '{}'::jsonb; k text; v text;
begin
  if tema not in ('neutro', 'rosa-dourado', 'chocolate', 'pistache', 'lavanda', 'pessego', 'menta', 'cereja', 'personalizado') then
    perform public._falha(422, 'Tema desconhecido.', 'tema');
  end if;
  if fonte not in ('elegante', 'classico', 'moderno', 'delicado') then
    perform public._falha(422, 'Estilo de letra desconhecido.', 'fonte');
  end if;
  if tema = 'personalizado' then
    foreach k in array array['marca', 'escura', 'detalhe'] loop
      v := lower(btrim(coalesce(d #>> array['cores', k], '')));
      if v !~ '^#[0-9a-f]{6}$' then perform public._falha(422, 'Escolha as três cores do tema.', k); end if;
      cores := cores || jsonb_build_object(k, v);
    end loop;
    return jsonb_build_object('tema', tema, 'fonte', fonte, 'cores', cores);
  end if;
  return jsonb_build_object('tema', tema, 'fonte', fonte);
end $$;

create function public.admin_salvar_aparencia(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin(); nova jsonb := public._aparencia_valida(p);
begin
  insert into public.configuracoes (chave, valor) values ('aparencia', nova)
  on conflict (chave) do update set valor = excluded.valor;
  return jsonb_build_object('configuracoes', public._cfg());
end $$;
grant execute on function public.admin_salvar_aparencia(jsonb) to authenticated;

-- Configuração pública: igual à anterior (0015) + 'aparencia'.
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
    'aparencia', coalesce(cfg -> 'aparencia', '{"tema":"neutro","fonte":"elegante"}'::jsonb),
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

/* ---------- 2. Convites ---------- */
-- Só o SHA-256 do código fica guardado: quem vê o banco não consegue usar o link.
create table public.convites (
  id          bigint generated always as identity primary key,
  token_hash  text not null unique,
  papel       text not null default 'admin' check (papel in ('admin', 'atendente')),
  email       text,                              -- se preenchido, só este e-mail pode usar
  criado_em   timestamptz not null default now(),
  expira_em   timestamptz not null,
  usado_em    timestamptz,
  usado_por   uuid references public.perfis (id) on delete set null
);
alter table public.convites enable row level security;
revoke all on public.convites from anon, authenticated;

create function public._hash_convite(codigo text) returns text
language sql immutable as $$ select encode(sha256(convert_to(coalesce(codigo, ''), 'UTF8')), 'hex') $$;

/* Gera um convite e devolve o código (só aparece esta vez). Uso interno: o script
   de criação de loja chama pelo SQL (como dono do banco); o site não consegue. */
create function public._criar_convite(p_email text default null, p_dias int default 7, p_papel text default 'admin') returns text
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare codigo text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  insert into public.convites (token_hash, papel, email, expira_em)
  values (public._hash_convite(codigo), p_papel, nullif(lower(btrim(coalesce(p_email, ''))), ''),
          now() + make_interval(days => greatest(1, least(coalesce(p_dias, 7), 30))));
  return codigo;
end $$;

/* Convite válido para este código (ou erro com texto claro). */
create function public._convite_valido(codigo text, travar boolean default false) returns public.convites
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare c public.convites;
begin
  if travar then select * into c from public.convites where token_hash = public._hash_convite(codigo) for update;
  else select * into c from public.convites where token_hash = public._hash_convite(codigo); end if;
  if not found then perform public._falha(404, 'Este convite não existe. Confira se o link foi copiado inteiro.'); end if;
  if c.usado_em is not null then perform public._falha(410, 'Este convite já foi usado. Entre com o e-mail e a senha que você criou.'); end if;
  if c.expira_em < now() then perform public._falha(410, 'Este convite venceu. Peça um novo link a quem criou a sua loja.'); end if;
  return c;
end $$;

-- Página do convite: confere o link antes de a pessoa criar a conta.
create function public.convite_consultar(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare c public.convites;
begin
  if pg_column_size(p) > 4096 then perform public._falha(413, 'Os dados enviados são grandes demais.'); end if;
  perform public._limitar('convite', 20, 600);
  c := public._convite_valido(p ->> 'codigo');
  return jsonb_build_object('email', c.email, 'papel', c.papel, 'loja', coalesce(public._cfg() #>> '{loja,nome}', ''));
end $$;
grant execute on function public.convite_consultar(jsonb) to anon, authenticated;

-- Com a conta criada (ou já logada), vira administradora da loja. Cada convite vale uma vez.
create function public.convite_aceitar(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare c public.convites; u public.perfis;
begin
  if pg_column_size(p) > 4096 then perform public._falha(413, 'Os dados enviados são grandes demais.'); end if;
  perform public._limitar('convite', 20, 600);
  if auth.uid() is null then perform public._falha(401, 'Crie sua conta ou entre para aceitar o convite.'); end if;
  c := public._convite_valido(p ->> 'codigo', true);
  select * into u from public.perfis where id = auth.uid();
  if not found then perform public._falha(401, 'Crie sua conta ou entre para aceitar o convite.'); end if;
  if c.email is not null and lower(u.email) <> c.email then
    perform public._falha(403, 'Este convite foi feito para outro e-mail (' || c.email || '). Entre com esse e-mail.');
  end if;
  update public.perfis set papel = c.papel, ativo = true where id = u.id;
  update public.convites set usado_em = now(), usado_por = u.id where id = c.id;
  return jsonb_build_object('papel', c.papel);
end $$;
grant execute on function public.convite_aceitar(jsonb) to authenticated;

/* ---------- 3. Primeiros passos ---------- */
create or replace function public.admin_checklist(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin(); cfg jsonb := public._cfg();
begin
  return jsonb_build_object('itens', jsonb_build_array(
    jsonb_build_object('id', 'aparencia', 'titulo', 'Escolher as cores e o estilo da loja', 'dica', 'Um tema pronto ou as cores da sua marca.', 'link', '/configuracoes/aparencia',
      'feito', cfg ? 'aparencia'),
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
