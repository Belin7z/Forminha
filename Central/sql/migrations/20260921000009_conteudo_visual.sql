-- ==========================================================
-- 9) CONTEÚDO VISUAL — ícone das categorias, imagens do site
--    (logo, foto de destaque, galeria), perguntas frequentes e
--    textos legais editáveis no Dashboard
-- ==========================================================

/* Funções novas NÃO nascem executáveis por todo mundo (o Postgres libera para PUBLIC por padrão).
   Só o que a API precisa é liberado, por nome, no final de cada migração. */
alter default privileges revoke execute on functions from public;

/* ---------- Categorias: ícone de linha no lugar do emoji ---------- */
alter table public.categorias add column icone text not null default 'bolo';

create function public._icone_valido(v text) returns boolean language sql immutable as $$
  select v = any (array['bolo', 'fatia', 'torta', 'cupcake', 'macaron', 'brigadeiro', 'rosquinha', 'cookie', 'chocolate',
                        'morango', 'sorvete', 'pao', 'cafe', 'presente', 'caixa', 'festa', 'flor'])
$$;

create or replace function public._categorias_admin() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('categorias', coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'nome', c.nome, 'emoji', c.emoji, 'icone', c.icone, 'ordem', c.ordem, 'ativa', c.ativa,
      'produtos', (select count(*) from public.produtos pr where pr.categoria_id = c.id)) order by c.ordem, c.id), '[]'::jsonb))
    from public.categorias c
$$;

create or replace function public.admin_salvar_categoria(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  adm public.perfis := public._admin(); cid bigint := nullif(p ->> 'id', '')::bigint;
  v_nome text; v_emoji text; v_icone text; v_ativa boolean;
begin
  v_nome := public._v_txt(p, 'nome', 2, 50, 'Nome');
  v_emoji := coalesce(nullif(public._v_txt(p, 'emoji', 0, 8, 'Emoji'), ''), '🍰');
  v_icone := coalesce(nullif(btrim(p ->> 'icone'), ''), 'bolo');
  if not public._icone_valido(v_icone) then perform public._falha(422, 'Escolha um ícone da lista.', 'icone'); end if;
  v_ativa := public._v_bool(p, 'ativa');
  if cid is null then
    insert into public.categorias (nome, emoji, icone, ordem, ativa)
    values (v_nome, v_emoji, v_icone, coalesce((select max(ordem) + 1 from public.categorias), 0), v_ativa);
  else
    if not exists (select 1 from public.categorias where id = cid) then perform public._falha(404, 'Categoria não encontrada.'); end if;
    update public.categorias set nome = v_nome, emoji = v_emoji, icone = v_icone, ativa = v_ativa where id = cid;
  end if;
  return public._categorias_admin();
end $$;

create or replace function public.loja_catalogo(p jsonb default '{}'::jsonb) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'categorias', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'emoji', emoji, 'icone', icone, 'ordem', ordem, 'ativa', ativa) order by ordem, id)
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

/* ---------- Storage: imagens do site (logo, foto de destaque, galeria) ---------- */
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site', 'site', true, 4194304, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true, file_size_limit = 4194304, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

create policy "admin envia imagens do site" on storage.objects
  for insert to authenticated with check (bucket_id = 'site' and public.e_admin());
create policy "admin troca imagens do site" on storage.objects
  for update to authenticated using (bucket_id = 'site' and public.e_admin()) with check (bucket_id = 'site' and public.e_admin());
create policy "admin apaga imagens do site" on storage.objects
  for delete to authenticated using (bucket_id = 'site' and public.e_admin());

/** URL de imagem do nosso bucket "site" (ou vazio). Qualquer outro endereço é recusado. */
create function public._v_url_site(p jsonb, campo text) returns text
language plpgsql immutable as $$
declare u text := btrim(coalesce(p ->> campo, ''));
begin
  if u = '' then return ''; end if;
  if u !~ '^https?://[^/\s]+/storage/v1/object/public/site/[A-Za-z0-9._/-]+$' or length(u) > 400 then
    perform public._falha(422, 'Imagem inválida. Envie a imagem pelo Dashboard.', campo);
  end if;
  return u;
end $$;

/* ---------- Configuração pública: agora com galeria, perguntas e textos legais ---------- */
create or replace function public.loja_config(p jsonb default '{}'::jsonb) returns jsonb
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
    'galeria', coalesce(cfg #> '{galeria,itens}', '[]'::jsonb),
    'faq', coalesce(cfg #> '{faq,itens}', '[]'::jsonb),
    'legal', coalesce(cfg -> 'legal', '{}'::jsonb),
    'zonas', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'ate_km', ate_km, 'taxa', taxa, 'prazo_min', prazo_min) order by ate_km)
                         from public.zonas_entrega where ativa), '[]'::jsonb),
    'aberta_agora', aberta);
end $$;

/* ---------- Salvar configurações: seções novas e imagens ---------- */
create or replace function public.admin_salvar_config(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  adm public.perfis := public._admin(); secao text := p ->> 'secao'; d jsonb := coalesce(p -> 'dados', '{}'::jsonb); novo jsonb; h jsonb; i int; email text;
  item jsonb; lista jsonb; pergunta text; resposta text;
begin
  if secao = 'loja' then
    email := btrim(coalesce(d ->> 'email', ''));
    novo := jsonb_build_object(
      'nome', public._v_txt(d, 'nome', 2, 80, 'Nome da loja'), 'slogan', public._v_txt(d, 'slogan', 0, 120, 'Slogan'),
      'whatsapp', public._v_tel(d, 'whatsapp', false),
      'instagram', public._v_txt(jsonb_build_object('instagram', regexp_replace(coalesce(d ->> 'instagram', ''), '^@', '')), 'instagram', 0, 60, 'Instagram'),
      'email', case when email = '' then '' else public._v_email(d, 'email') end,
      'endereco', public._v_txt(d, 'endereco', 0, 150, 'Endereço'), 'cidade', public._v_txt(d, 'cidade', 0, 80, 'Cidade'),
      'uf', upper(public._v_txt(d, 'uf', 0, 2, 'UF')),
      'lat', public._v_num(d, 'lat', -90, 90, 'Latitude', true), 'lng', public._v_num(d, 'lng', -180, 180, 'Longitude', true),
      'logo', public._v_url_site(d, 'logo'));
  elsif secao = 'textos' then
    novo := jsonb_build_object('hero_titulo', public._v_txt(d, 'hero_titulo', 3, 120, 'Título'),
      'hero_subtitulo', public._v_txt(d, 'hero_subtitulo', 0, 300, 'Subtítulo'),
      'hero_imagem', public._v_url_site(d, 'hero_imagem'), 'sobre_imagem', public._v_url_site(d, 'sobre_imagem'),
      'sobre_titulo', public._v_txt(d, 'sobre_titulo', 0, 100, 'Título do sobre'), 'sobre_texto', public._v_par(d, 'sobre_texto', 1500, 'Texto do sobre'));
  elsif secao = 'galeria' then
    if jsonb_typeof(d -> 'itens') is distinct from 'array' then d := jsonb_build_object('itens', '[]'::jsonb); end if;
    if jsonb_array_length(d -> 'itens') > 8 then perform public._falha(422, 'A galeria aceita até 8 fotos.'); end if;
    lista := '[]'::jsonb;
    for item in select value from jsonb_array_elements(d -> 'itens') loop
      lista := lista || to_jsonb(public._v_url_site(jsonb_build_object('u', item #>> '{}'), 'u'));
    end loop;
    novo := jsonb_build_object('itens', lista);
  elsif secao = 'faq' then
    if jsonb_typeof(d -> 'itens') is distinct from 'array' then d := jsonb_build_object('itens', '[]'::jsonb); end if;
    if jsonb_array_length(d -> 'itens') > 12 then perform public._falha(422, 'Use no máximo 12 perguntas.'); end if;
    lista := '[]'::jsonb;
    for item in select value from jsonb_array_elements(d -> 'itens') loop
      pergunta := public._v_txt(item, 'p', 1, 160, 'Pergunta');
      resposta := public._v_par(item, 'r', 800, 'Resposta');
      if resposta = '' then perform public._falha(422, 'Toda pergunta precisa de uma resposta.'); end if;
      lista := lista || jsonb_build_array(jsonb_build_object('p', pergunta, 'r', resposta));
    end loop;
    novo := jsonb_build_object('itens', lista);
  elsif secao = 'legal' then
    novo := jsonb_build_object('privacidade', public._v_par(d, 'privacidade', 12000, 'Política de privacidade'),
                               'termos', public._v_par(d, 'termos', 12000, 'Termos de uso'));
  elsif secao = 'pedidos' then
    novo := jsonb_build_object('pausados', public._v_bool(d, 'pausados'), 'mensagem_pausa', public._v_txt(d, 'mensagem_pausa', 0, 200, 'Mensagem'),
      'antecedencia_horas', public._v_int(d, 'antecedencia_horas', 0, 720, 'Antecedência'),
      'pedido_minimo', public._v_int(d, 'pedido_minimo', 0, 10000000, 'Pedido mínimo'),
      'intervalo_min', public._v_int(d, 'intervalo_min', 10, 240, 'Intervalo'), 'dias_maximos', public._v_int(d, 'dias_maximos', 1, 365, 'Dias máximos'));
  elsif secao = 'entrega' then
    novo := jsonb_build_object('entrega_ativa', public._v_bool(d, 'entrega_ativa'), 'retirada_ativa', public._v_bool(d, 'retirada_ativa'),
      'gratis_acima', public._v_int(d, 'gratis_acima', 0, 10000000, 'Frete grátis acima de'),
      'taxa_padrao', public._v_int(d, 'taxa_padrao', 0, 1000000, 'Taxa padrão'));
    if not (novo ->> 'entrega_ativa')::boolean and not (novo ->> 'retirada_ativa')::boolean then
      perform public._falha(422, 'Deixe ao menos uma forma de recebimento ativa.');
    end if;
  elsif secao = 'pagamento' then
    novo := jsonb_build_object('pix_ativo', public._v_bool(d, 'pix_ativo'), 'pix_chave', public._v_txt(d, 'pix_chave', 0, 80, 'Chave PIX'),
      'pix_nome', public._v_txt(d, 'pix_nome', 0, 25, 'Nome do recebedor'), 'pix_cidade', public._v_txt(d, 'pix_cidade', 0, 15, 'Cidade do recebedor'),
      'dinheiro_ativo', public._v_bool(d, 'dinheiro_ativo'), 'cartao_ativo', public._v_bool(d, 'cartao_ativo'));
    if (novo ->> 'pix_ativo')::boolean and (novo ->> 'pix_chave') = '' then
      perform public._falha(422, 'Informe a chave PIX ou desative o PIX.', 'pix_chave');
    end if;
  elsif secao = 'horarios' then
    novo := '{}'::jsonb;
    for i in 0..6 loop
      h := d -> i::text;
      h := jsonb_build_object('aberto', public._v_bool(coalesce(h, '{}'::jsonb), 'aberto'),
                              'abre', public._v_hhmm(coalesce(h, '{}'::jsonb), 'abre'), 'fecha', public._v_hhmm(coalesce(h, '{}'::jsonb), 'fecha'));
      if (h ->> 'aberto')::boolean and (h ->> 'abre') >= (h ->> 'fecha') then
        perform public._falha(422, 'O horário de fechamento deve ser depois do de abertura.');
      end if;
      novo := novo || jsonb_build_object(i::text, h);
    end loop;
  else
    perform public._falha(422, 'Seção de configuração desconhecida.');
  end if;

  insert into public.configuracoes (chave, valor) values (secao, novo)
  on conflict (chave) do update set valor = excluded.valor;
  return jsonb_build_object('configuracoes', public._cfg());
end $$;
