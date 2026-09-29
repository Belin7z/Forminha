-- ==========================================================
-- 22) RELATÓRIO DE VENDAS (painel da dona)
--     Qualquer período (hoje, 7/30 dias, este mês, 12 meses, anos
--     ou de um dia até outro), pela data do PEDIDO ou da ENTREGA:
--     faturamento, pedidos, ticket, recebido e a receber, comparação
--     com o período anterior (do mesmo tamanho), gráfico por hora,
--     dia, mês ou ano, produtos, categorias, formas de pagamento,
--     entrega × retirada, dias da semana, horários, melhores
--     clientes, cupons, lucro estimado e a lista para a planilha.
--     Cancelados ficam de fora das contas (aparecem à parte).
--     Só o administrador.
-- ==========================================================

create function public.admin_relatorio_vendas(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  adm public.perfis := public._admin();
  tz constant text := 'America/Sao_Paulo';
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_de date := coalesce(public._v_data(p, 'de', true), date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date);
  v_ate date := coalesce(public._v_data(p, 'ate', true), (now() at time zone 'America/Sao_Paulo')::date);
  v_base text := coalesce(nullif(p ->> 'base', ''), 'pedido');
  v_agr text := nullif(p ->> 'agrupar', '');
  n_dias int; a_de date; a_ate date; r jsonb;
begin
  perform public._limitar('relatorio_vendas', 60, 60);
  if v_base not in ('pedido', 'entrega') then perform public._falha(422, 'Escolha: pela data do pedido ou da entrega.', 'base'); end if;
  if v_ate < v_de then perform public._falha(422, 'A data final vem antes da inicial.', 'ate'); end if;
  if v_ate - v_de > 3660 then perform public._falha(422, 'Escolha um período de até 10 anos.', 'ate'); end if;
  if v_agr is not null and v_agr not in ('hora', 'dia', 'mes', 'ano') then perform public._falha(422, 'Agrupamento inválido.', 'agrupar'); end if;
  n_dias := v_ate - v_de + 1;
  -- o agrupamento acompanha o tamanho do período (e nunca vira um gráfico ilegível)
  v_agr := coalesce(v_agr, case when n_dias <= 2 then 'hora' when n_dias <= 62 then 'dia' when n_dias <= 731 then 'mes' else 'ano' end);
  if v_agr = 'hora' and n_dias > 3 then v_agr := 'dia'; end if;
  if v_agr = 'dia' and n_dias > 400 then v_agr := 'mes'; end if;
  a_ate := v_de - 1;
  a_de := v_de - n_dias;

  with base as (
    select o.*,
           case when v_base = 'entrega' then o.data_agendada else (o.criado_em at time zone tz)::date end as dia,
           case when v_base = 'entrega' then coalesce(substring(o.hora_agendada from '^\d{1,2}')::int, 0)
                else extract(hour from o.criado_em at time zone tz)::int end as hora
      from public.pedidos o
     where case when v_base = 'entrega' then o.data_agendada else (o.criado_em at time zone tz)::date end between a_de and v_ate
  ),
  ped as (select * from base where dia between v_de and v_ate and status <> 'cancelado'),
  ant as (select * from base where dia between a_de and a_ate and status <> 'cancelado'),
  canc as (select * from base where dia between v_de and v_ate and status = 'cancelado'),
  itens as (
    -- a receita de cada item já com a parte dele no desconto do pedido
    select i.produto_id, i.nome, i.qtd, i.opcoes, pd.id as pid,
           i.total * (1 - case when pd.subtotal > 0 then pd.desconto::numeric / pd.subtotal else 0 end) as receita,
           exists (select 1 from public.receitas rc where rc.produto_id = i.produto_id) as tem
      from public.pedido_itens i join ped pd on pd.id = i.pedido_id
  ),
  custos as (
    select receita, tem,
           case when tem then coalesce((select sum(c.quantidade * g.embalagem_preco / g.embalagem_qtd)
                                          from public._consumo_item(it.produto_id, it.qtd, it.opcoes) c
                                          join public.ingredientes g on g.id = c.ingrediente_id), 0) else 0 end as custo
      from itens it
  ),
  recebido as (select pg.pedido_id, pg.forma, pg.valor from public.pagamentos_pedido pg join ped on ped.id = pg.pedido_id),
  baldes as (
    select g,
           case v_agr when 'hora' then to_char(g, 'YYYY-MM-DD HH24') when 'dia' then to_char(g, 'YYYY-MM-DD')
                      when 'mes' then to_char(g, 'YYYY-MM') else to_char(g, 'YYYY') end as chave
      from generate_series(
             case v_agr when 'mes' then date_trunc('month', v_de::timestamp) when 'ano' then date_trunc('year', v_de::timestamp) else v_de::timestamp end,
             case v_agr when 'hora' then v_ate::timestamp + interval '23 hours' when 'mes' then date_trunc('month', v_ate::timestamp)
                        when 'ano' then date_trunc('year', v_ate::timestamp) else v_ate::timestamp end,
             case v_agr when 'hora' then interval '1 hour' when 'dia' then interval '1 day' when 'mes' then interval '1 month' else interval '1 year' end) g
  ),
  por_balde as (
    select case v_agr when 'hora' then to_char(dia, 'YYYY-MM-DD') || ' ' || lpad(hora::text, 2, '0') when 'dia' then to_char(dia, 'YYYY-MM-DD')
                      when 'mes' then to_char(dia, 'YYYY-MM') else to_char(dia, 'YYYY') end as chave,
           count(*) as pedidos, sum(total) as total
      from ped group by 1
  )
  select jsonb_build_object(
    'de', to_char(v_de, 'YYYY-MM-DD'), 'ate', to_char(v_ate, 'YYYY-MM-DD'), 'base', v_base, 'agrupar', v_agr,
    'totais', (select jsonb_build_object(
        'faturamento', coalesce(sum(total), 0), 'pedidos', count(*),
        'ticket', case when count(*) > 0 then round(sum(total)::numeric / count(*)) else 0 end,
        'produtos', coalesce(sum(subtotal), 0), 'frete', coalesce(sum(taxa_entrega), 0), 'descontos', coalesce(sum(desconto), 0),
        'entregues', count(*) filter (where status = 'entregue'),
        'clientes', count(distinct usuario_id),
        'clientes_novos', (select count(*) from (select distinct usuario_id from ped) c
                            where not exists (select 1 from public.pedidos o2
                                               where o2.usuario_id = c.usuario_id and o2.status <> 'cancelado'
                                                 and case when v_base = 'entrega' then o2.data_agendada else (o2.criado_em at time zone tz)::date end < v_de)),
        'itens', (select coalesce(sum(qtd), 0) from itens),
        'recebido', (select coalesce(sum(valor), 0) from recebido),
        'cancelados', (select count(*) from canc), 'cancelados_total', (select coalesce(sum(total), 0) from canc),
        'receita_com_custo', (select coalesce(round(sum(receita) filter (where tem)), 0) from custos),
        'custo', (select coalesce(round(sum(custo) filter (where tem)), 0) from custos),
        'lucro', (select coalesce(round(sum(receita - custo) filter (where tem)), 0) from custos),
        'margem_pct', (select case when coalesce(sum(receita) filter (where tem), 0) > 0
                                   then round(sum(receita - custo) filter (where tem) * 100 / sum(receita) filter (where tem), 1) end from custos))
      from ped),
    'anterior', (select jsonb_build_object('de', to_char(a_de, 'YYYY-MM-DD'), 'ate', to_char(a_ate, 'YYYY-MM-DD'),
                   'faturamento', coalesce(sum(total), 0), 'pedidos', count(*),
                   'ticket', case when count(*) > 0 then round(sum(total)::numeric / count(*)) else 0 end) from ant),
    'serie', (select coalesce(jsonb_agg(jsonb_build_object('chave', b.chave, 'total', coalesce(v.total, 0), 'pedidos', coalesce(v.pedidos, 0)) order by b.g), '[]'::jsonb)
                from baldes b left join por_balde v on v.chave = b.chave),
    'status', (select coalesce(jsonb_agg(jsonb_build_object('status', status, 'n', n) order by n desc), '[]'::jsonb)
                 from (select status, count(*) as n from base where dia between v_de and v_ate group by status) s),
    'produtos', (select coalesce(jsonb_agg(jsonb_build_object('produto_id', x.produto_id, 'nome', x.nome, 'qtd', x.qtd, 'receita', x.receita, 'pedidos', x.pedidos)
                                           order by x.receita desc, x.nome), '[]'::jsonb)
                   from (select produto_id, nome, sum(qtd) as qtd, round(sum(receita)) as receita, count(distinct pid) as pedidos
                           from itens group by produto_id, nome order by 4 desc, 2 limit 50) x),
    'categorias', (select coalesce(jsonb_agg(jsonb_build_object('nome', x.nome, 'qtd', x.qtd, 'receita', x.receita) order by x.receita desc), '[]'::jsonb)
                     from (select coalesce(c.nome, 'Sem categoria') as nome, sum(it.qtd) as qtd, round(sum(it.receita)) as receita
                             from itens it left join public.produtos pr on pr.id = it.produto_id left join public.categorias c on c.id = pr.categoria_id
                            group by 1) x),
    'pagamentos', (select coalesce(jsonb_agg(jsonb_build_object('pagamento', pagamento, 'pedidos', n, 'total', t) order by t desc), '[]'::jsonb)
                     from (select pagamento, count(*) as n, sum(total) as t from ped group by pagamento) x),
    'recebimentos', (select coalesce(jsonb_agg(jsonb_build_object('forma', forma, 'texto', public._forma_recebida_texto(forma), 'n', n, 'valor', v) order by v desc), '[]'::jsonb)
                       from (select forma, count(*) as n, sum(valor) as v from recebido group by forma) x),
    'tipos', (select coalesce(jsonb_agg(jsonb_build_object('tipo', tipo, 'pedidos', n, 'total', t) order by t desc), '[]'::jsonb)
                from (select tipo, count(*) as n, sum(total) as t from ped group by tipo) x),
    'semana', (select jsonb_agg(jsonb_build_object('dia', d, 'pedidos', coalesce(x.n, 0), 'total', coalesce(x.t, 0)) order by d)
                 from generate_series(0, 6) d left join (select extract(dow from dia)::int as dw, count(*) as n, sum(total) as t from ped group by 1) x on x.dw = d),
    'horarios', (select jsonb_agg(jsonb_build_object('hora', h, 'pedidos', coalesce(x.n, 0), 'total', coalesce(x.t, 0)) order by h)
                   from generate_series(0, 23) h left join (select hora, count(*) as n, sum(total) as t from ped group by hora) x on x.hora = h),
    'clientes', (select coalesce(jsonb_agg(jsonb_build_object('usuario_id', x.usuario_id, 'nome', x.nome, 'pedidos', x.n, 'total', x.t) order by x.t desc), '[]'::jsonb)
                   from (select usuario_id, (array_agg(cliente_nome order by id desc))[1] as nome, count(*) as n, sum(total) as t
                           from ped group by usuario_id order by 4 desc limit 10) x),
    'cupons', (select coalesce(jsonb_agg(jsonb_build_object('cupom', x.cupom, 'usos', x.n, 'desconto', x.d, 'total', x.t) order by x.n desc, x.cupom), '[]'::jsonb)
                 from (select upper(cupom) as cupom, count(*) as n, sum(desconto) as d, sum(total) as t from ped where coalesce(cupom, '') <> '' group by 1) x),
    'lista', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', l.id, 'codigo', l.codigo, 'dia', to_char(l.dia, 'YYYY-MM-DD'), 'criado_em', l.criado_em, 'data_agendada', to_char(l.data_agendada, 'YYYY-MM-DD'),
                  'hora_agendada', l.hora_agendada, 'cliente', l.cliente_nome, 'status', l.status, 'tipo', l.tipo, 'pagamento', l.pagamento, 'cupom', l.cupom,
                  'produtos', l.subtotal, 'frete', l.taxa_entrega, 'desconto', l.desconto, 'total', l.total,
                  'pago', l.pago)
                order by l.dia desc, l.id desc), '[]'::jsonb)
                from (select * from base where dia between v_de and v_ate order by dia desc, id desc limit 3000) l),
    'lista_cortada', (select count(*) > 3000 from base where dia between v_de and v_ate))
  into r;
  return r;
end $$;

/* ---------- Permissões (as funções novas nascem trancadas) ---------- */
grant execute on function public.admin_relatorio_vendas(jsonb) to authenticated;
