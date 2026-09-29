/* ==========================================================
   0021 — PAGAMENTO ONLINE: PIX automático + cartão (Mercado Pago).
   • Novo jeito de receber: 'cartao_online' (crédito/débito pelo
     checkout do Mercado Pago), confirmado sozinho como o PIX automático.
   • O gateway ganha a opção "cartão" (liga/desliga separado do PIX).
   • A vitrine passa a saber se aceita cartão online (só o sim/não).
   • A Central liga tudo pela dona: guarda a chave de integração (hash)
     com admin_conectar_gateway — a própria dona continua podendo ligar
     e desligar PIX e cartão pelo painel.
   ========================================================== */

/* ---------- forma de pagamento nova ---------- */
do $$
declare c text;
begin
  for c in select conname from pg_constraint where conrelid = 'public.pagamentos_pedido'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%forma%' loop
    execute format('alter table public.pagamentos_pedido drop constraint %I', c);
  end loop;
end $$;
alter table public.pagamentos_pedido add constraint pagamentos_pedido_forma_check
  check (forma in ('pix', 'dinheiro', 'cartao', 'transferencia', 'pix_auto', 'cartao_online'));

create or replace function public._forma_recebida_texto(forma text) returns text language sql immutable as $$
  select case forma when 'pix' then 'PIX' when 'pix_auto' then 'PIX (automático)' when 'dinheiro' then 'Dinheiro'
                    when 'cartao' then 'Cartão' when 'cartao_online' then 'Cartão (online)' when 'transferencia' then 'Transferência' else forma end
$$;

/* ---------- gateway: PIX e cartão ---------- */
create or replace function public.admin_gateway(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin(); g jsonb := coalesce(public._cfg() -> 'gateway', '{}'::jsonb);
begin
  return jsonb_build_object('provedor', 'mercadopago', 'ativo', coalesce((g ->> 'ativo')::boolean, false),
                            'cartao', coalesce((g ->> 'cartao')::boolean, false),
                            'tem_chave', coalesce(g ->> 'segredo_hash', '') <> '',
                            'conectado_em', g ->> 'conectado_em', 'conta', coalesce(g ->> 'conta', ''));
end $$;

create or replace function public.admin_salvar_gateway(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin(); g jsonb := coalesce(public._cfg() -> 'gateway', '{}'::jsonb);
        v boolean := public._v_bool(p, 'ativo'); cartao boolean := coalesce((p ->> 'cartao')::boolean, (g ->> 'cartao')::boolean, false);
begin
  if (v or cartao) and coalesce(g ->> 'segredo_hash', '') = '' then
    perform public._falha(422, 'Conecte o Mercado Pago antes de ligar o pagamento online.', 'ativo');
  end if;
  insert into public.configuracoes (chave, valor) values ('gateway', g || jsonb_build_object('ativo', v, 'cartao', cartao))
  on conflict (chave) do update set valor = excluded.valor;
  return public.admin_gateway();
end $$;

/**
 * Chamada pela Central (com a chave administrativa do projeto, nunca pelo navegador): grava o hash da chave de
 * integração que ela acabou de pôr nos segredos das funções, liga PIX e cartão e anota a conta conectada.
 */
create or replace function public.central_conectar_gateway(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare g jsonb := coalesce(public._cfg() -> 'gateway', '{}'::jsonb); segredo text := coalesce(p ->> 'segredo', '');
begin
  if length(segredo) < 32 then perform public._falha(422, 'Chave de integração inválida.'); end if;
  insert into public.configuracoes (chave, valor)
  values ('gateway', g || jsonb_build_object('ativo', true, 'cartao', coalesce((p ->> 'cartao')::boolean, true),
    'segredo_hash', encode(sha256(convert_to(segredo, 'UTF8')), 'hex'), 'conectado_em', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'conta', left(coalesce(p ->> 'conta', ''), 120)))
  on conflict (chave) do update set valor = excluded.valor;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.central_conectar_gateway(jsonb) from public, anon, authenticated;

/* O Mercado Pago confirmou: registra como PIX automático ou cartão online (mesmas travas de antes). */
create or replace function public.gateway_registrar_pagamento(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  g jsonb := coalesce(public._cfg() -> 'gateway', '{}'::jsonb); ped public.pedidos; id_ext text := btrim(coalesce(p ->> 'id_externo', ''));
  v bigint; aplicar int; forma text := coalesce(nullif(p ->> 'forma', ''), 'pix_auto');
begin
  perform public._limitar('gateway_registrar_pagamento', 120, 60);
  -- com PIX automático E cartão desligados, nada entra (o Mercado Pago tenta de novo e registra quando religar)
  if not (coalesce((g ->> 'ativo')::boolean, false) or coalesce((g ->> 'cartao')::boolean, false)) or coalesce(g ->> 'segredo_hash', '') = ''
     or encode(sha256(convert_to(coalesce(p ->> 'segredo', ''), 'UTF8')), 'hex') <> (g ->> 'segredo_hash') then
    perform public._falha(403, 'Acesso negado.');
  end if;
  if forma not in ('pix_auto', 'cartao_online') then perform public._falha(422, 'Forma de pagamento inválida.'); end if;
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
  insert into public.pagamentos_pedido (pedido_id, valor, forma, id_externo) values (ped.id, aplicar, forma, id_ext);
  update public.pedidos set pago = pago + aplicar, atualizado_em = now() where id = ped.id;
  select * into ped from public.pedidos where id = ped.id;
  return jsonb_build_object('ok', true, 'aplicado', aplicar, 'situacao', public._pagamento_situacao(ped));
end $$;

/* Pagamento confirmado pelo Mercado Pago (PIX ou cartão) não se apaga aqui: a devolução é feita lá. */
create or replace function public.admin_excluir_pagamento(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare staff public.perfis := public._staff(); g public.pagamentos_pedido;
begin
  select * into g from public.pagamentos_pedido where id = public._v_int(p, 'id', 1, 999999999999, 'Pagamento');
  if not found then perform public._falha(404, 'Pagamento não encontrado.'); end if;
  if g.forma in ('pix_auto', 'cartao_online') then
    perform public._falha(409, 'Este pagamento foi confirmado automaticamente pelo Mercado Pago. Para devolver o valor, faça o estorno no Mercado Pago.');
  end if;
  delete from public.pagamentos_pedido where id = g.id;
  update public.pedidos set pago = greatest(pago - g.valor, 0), atualizado_em = now() where id = g.pedido_id;
  return jsonb_build_object('pedido', public._pedido_completo(g.pedido_id));
end $$;

-- Configuração pública: igual à anterior (0020) + 'cartao_online' (só o sim/não).
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
  pag := pag || jsonb_build_object('pix_automatico', coalesce((cfg #>> '{gateway,ativo}')::boolean, false),
                                   'cartao_online', coalesce((cfg #>> '{gateway,cartao}')::boolean, false)
                                                    and coalesce(cfg #>> '{gateway,segredo_hash}', '') <> '');
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
