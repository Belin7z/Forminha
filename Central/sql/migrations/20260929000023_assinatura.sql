-- ==========================================================
-- 23) ASSINATURA DA FORMINHA (mensalidade da loja)
--     A Central da Forminha escreve na ficha "forminha" a situação
--     da mensalidade: { situacao, vencimento, valor_centavos, link,
--     suspensa }. Com a loja SUSPENSA (mensalidade muito atrasada):
--       • a loja continua no ar, mas não recebe pedidos pelo site
--         (aparece como "pedidos pausados", com um recado);
--       • o painel continua funcionando e mostra o aviso para pagar.
--     Quem pode ler a situação: só o administrador da loja.
-- ==========================================================

create function public._loja_suspensa() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select (valor #>> '{assinatura,suspensa}')::boolean from public.configuracoes where chave = 'forminha'), false)
$$;
revoke all on function public._loja_suspensa() from public, anon, authenticated;

/* ---------- a situação da mensalidade, para o painel ---------- */
create function public.admin_assinatura(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin(); a jsonb;
begin
  select valor -> 'assinatura' into a from public.configuracoes where chave = 'forminha';
  a := coalesce(a, '{}'::jsonb);
  return jsonb_build_object(
    'situacao', coalesce(a ->> 'situacao', 'em_dia'),
    'vencimento', a ->> 'vencimento',
    'valor_centavos', coalesce((a ->> 'valor_centavos')::int, 0),
    'link', a ->> 'link',
    'suspensa', coalesce((a ->> 'suspensa')::boolean, false));
end $$;
grant execute on function public.admin_assinatura(jsonb) to authenticated;

/* ---------- configuração pública: suspensa = pedidos pausados com recado ---------- */
-- Igual à anterior (0021); só muda 'pedidos' quando a loja está suspensa.
create or replace function public._base_loja_config(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  cfg jsonb := public._cfg(); agora timestamp := now() at time zone 'America/Sao_Paulo';
  janela jsonb; aberta boolean; pag jsonb; ped jsonb;
begin
  janela := cfg -> 'horarios' -> (extract(dow from agora)::int)::text;
  aberta := coalesce((janela ->> 'aberto')::boolean, false)
        and to_char(agora, 'HH24:MI') >= coalesce(janela ->> 'abre', '00:00')
        and to_char(agora, 'HH24:MI') <= coalesce(janela ->> 'fecha', '00:00');
  pag := coalesce(cfg -> 'pagamento', '{}'::jsonb) - 'pix_chave' - 'pix_nome' - 'pix_cidade';
  pag := jsonb_set(pag, '{pix_ativo}', to_jsonb(coalesce((cfg #>> '{pagamento,pix_ativo}')::boolean, false)
                                                and coalesce(cfg #>> '{pagamento,pix_chave}', '') <> ''));
  pag := pag || jsonb_build_object('pix_automatico', coalesce((cfg #>> '{gateway,ativo}')::boolean, false),
                                   'cartao_online', coalesce((cfg #>> '{gateway,cartao}')::boolean, false)
                                                    and coalesce(cfg #>> '{gateway,segredo_hash}', '') <> '');
  ped := coalesce(cfg -> 'pedidos', '{}'::jsonb);
  if coalesce((cfg #>> '{forminha,assinatura,suspensa}')::boolean, false) then
    ped := ped || jsonb_build_object('pausados', true,
      'mensagem_pausa', 'No momento não estamos recebendo pedidos pelo site. Fale com a gente pelo WhatsApp.');
  end if;
  return jsonb_build_object(
    'loja', coalesce(cfg -> 'loja', '{}'::jsonb), 'textos', coalesce(cfg -> 'textos', '{}'::jsonb),
    'aparencia', coalesce(cfg -> 'aparencia', '{"tema":"neutro","fonte":"elegante"}'::jsonb),
    'horarios', coalesce(cfg -> 'horarios', '{}'::jsonb), 'pedidos', ped,
    'entrega', coalesce(cfg -> 'entrega', '{}'::jsonb), 'pagamento', pag,
    'sinal', coalesce(cfg -> 'sinal', '{"percentual":0,"acima_de":0}'::jsonb),
    'galeria', coalesce(cfg #> '{galeria,itens}', '[]'::jsonb),
    'faq', coalesce(cfg #> '{faq,itens}', '[]'::jsonb),
    'legal', coalesce(cfg -> 'legal', '{}'::jsonb),
    'zonas', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'ate_km', ate_km, 'taxa', taxa, 'prazo_min', prazo_min) order by ate_km)
                         from public.zonas_entrega where ativa), '[]'::jsonb),
    'aberta_agora', aberta);
end $$;

/* ---------- criar pedido pelo site: não com a loja suspensa ---------- */
-- Igual à anterior (0014) + a trava da assinatura. Pedido feito pelo painel (a dona) continua valendo.
create or replace function public.cliente_criar_pedido(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  if pg_column_size(p) > 262144 then perform public._falha(413, 'Os dados enviados são grandes demais.'); end if;
  if public._loja_suspensa() then
    perform public._falha(423, 'No momento não estamos recebendo pedidos pelo site. Fale com a gente pelo WhatsApp.');
  end if;
  perform public._limitar('cliente_criar_pedido', 12, 60);
  if (select count(*) from public.pedidos where usuario_id = auth.uid() and status not in ('entregue', 'cancelado')) >= 15 then
    perform public._falha(409, 'Você já tem muitos pedidos em andamento. Aguarde a entrega de alguns ou fale com a loja pelo WhatsApp.');
  end if;
  return public._base_cliente_criar_pedido(p);
end $$;
grant execute on function public.cliente_criar_pedido(jsonb) to authenticated;
