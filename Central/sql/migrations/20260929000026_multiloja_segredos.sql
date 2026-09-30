-- ==========================================================
-- 26) MULTILOJA — as chaves de cada loja no banco único.
-- Num banco de uma loja só, as chaves do Mercado Pago e do WhatsApp
-- ficam nos segredos das funções do servidor. No banco único as
-- funções servem TODAS as lojas: a chave de cada loja fica aqui,
-- CIFRADA (a Central cifra; só as funções do servidor abrem, com o
-- SEGREDO_SERVIDOR que fica nos segredos delas). Quem vê o banco não
-- consegue usar as chaves.
--   • loja_segredos: as chaves cifradas de cada loja;
--   • forminha_servidor: o resumo (hash) do segredo das funções;
--   • servidor_segredos(): o que a função precisa da loja da vez
--     (chaves cifradas, endereços e o código) — só com o segredo;
--   • lojas.endereco: o endereço principal da loja (links dos avisos).
-- Também: o painel passa a ver se o WhatsApp está conectado.
-- ==========================================================

alter table public.lojas add column endereco text;

create table public.loja_segredos (
  loja_id       uuid not null default public._loja_atual() references public.lojas (id) on delete cascade,
  chave         text not null check (chave in ('mp_token', 'segredo_gateway', 'mp_webhook_secret', 'whatsapp_token', 'whatsapp_phone_id')),
  valor         text not null,
  atualizado_em timestamptz not null default now(),
  primary key (loja_id, chave)
);
alter table public.loja_segredos enable row level security;
create policy so_da_loja on public.loja_segredos for all to forminha_app
  using (loja_id = (select public._loja())) with check (loja_id = (select public._loja()));
revoke all on public.loja_segredos from anon, authenticated;

create table public.forminha_servidor (
  id           int primary key default 1 check (id = 1),
  segredo_hash text not null
);
alter table public.forminha_servidor enable row level security;
revoke all on public.forminha_servidor from anon, authenticated, forminha_app;

/**
 * Para as funções do servidor (pix-criar, pix-webhook, cartao-criar, whatsapp-avisar) no banco único:
 * a loja vem do cabeçalho x-loja; sem o segredo das funções, nada sai daqui.
 */
create function public.servidor_segredos(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare l uuid := public._loja(); h text; r jsonb;
begin
  select segredo_hash into h from public.forminha_servidor where id = 1;
  if h is null or encode(sha256(convert_to(coalesce(p ->> 'chave', ''), 'UTF8')), 'hex') <> h then
    perform public._falha(403, 'Acesso negado.');
  end if;
  if l is null then perform public._falha(404, 'Loja não encontrada.'); end if;
  select jsonb_build_object(
    'codigo', lo.codigo, 'endereco', lo.endereco,
    'enderecos', (select coalesce(jsonb_agg(e.host order by e.host), '[]'::jsonb) from public.loja_enderecos e where e.loja_id = l),
    'segredos', (select coalesce(jsonb_object_agg(s.chave, s.valor), '{}'::jsonb) from public.loja_segredos s where s.loja_id = l))
    into r from public.lojas lo where lo.id = l;
  return r;
end $$;
revoke all on function public.servidor_segredos(jsonb) from public;
grant execute on function public.servidor_segredos(jsonb) to anon, authenticated;

-- Os avisos por WhatsApp mostram se a conta está conectada (a Central grava 'whatsapp' ao conectar).
create or replace function public.admin_avisos(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin();
begin
  return public._avisos_cfg() || jsonb_build_object('conexao', public._cfg() -> 'whatsapp');
end $$;
grant create on schema public to forminha_app; -- (só para passar a função; sai logo abaixo)
alter function public.admin_avisos(jsonb) owner to forminha_app;
revoke create on schema public from forminha_app;
