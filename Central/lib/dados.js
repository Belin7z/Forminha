/* ==========================================================
   DADOS — o banco da Central (Neon Postgres, ligado pela Vercel).
   Guarda as clientes da Forminha, os pagamentos e o histórico.
   Tudo o que identifica uma pessoa fica CIFRADO (ver lib/cofre.js):
   aqui só aparecem textos embaralhados, o nome público da loja,
   valores e situações.
   ========================================================== */
import { neon } from "@neondatabase/serverless";

/** Banco de verdade: Neon por HTTPS (funciona em funções da Vercel, sem conexão aberta). */
export function bancoNeon(url) {
  const sql = neon(url);
  return { consultar: (texto, parametros = []) => sql.query(texto, parametros) };
}

/** Tabelas (cada comando pode rodar de novo sem estragar nada). */
export const ESQUEMA = [
  `create table if not exists clientes (
    id uuid primary key default gen_random_uuid(),
    criado_em timestamptz not null default now(),
    atualizado_em timestamptz not null default now(),
    dados text not null,                        -- CIFRADO: nome, e-mail, telefone, CPF/CNPJ, observações
    email_indice text not null unique,          -- índice cego do e-mail (acha a cliente sem guardar o e-mail aberto)
    nome_loja text not null,                    -- nome público da loja (vai aparecer no site dela)
    valor_centavos integer not null check (valor_centavos >= 0),
    situacao text not null default 'aguardando_pagamento' check (situacao in ('aguardando_pagamento', 'pago', 'cancelado')),
    etapa text not null default 'pagamento' check (etapa in ('pagamento', 'criar_projeto', 'aguardar_banco', 'preparar', 'publicar', 'convite', 'email', 'pronta', 'erro')),
    etapa_erro text,
    tentativas integer not null default 0,
    processando_ate timestamptz,                -- trava: só um processo cria a loja por vez
    loja_ref text unique,
    loja_codigo text,
    loja_url text,
    painel_url text,
    convite text,                               -- CIFRADO: o link do convite é uma chave de acesso
    convite_em timestamptz,
    email_boas_vindas_em timestamptz
  )`,
  `create table if not exists pagamentos (
    id uuid primary key default gen_random_uuid(),
    cliente_id uuid not null references clientes (id) on delete cascade,
    criado_em timestamptz not null default now(),
    token_hash text not null unique,            -- resumo do link da página de pagamento
    link text not null,                         -- CIFRADO: o link inteiro (para você reenviar)
    valor_centavos integer not null check (valor_centavos > 0),
    situacao text not null default 'pendente' check (situacao in ('pendente', 'aprovado', 'cancelado')),
    pix_copia_cola text not null,               -- PIX com a sua chave (modo manual)
    mp_id text unique,                          -- cobrança no Mercado Pago (modo automático)
    mp_copia_cola text,
    mp_qr_base64 text,
    confirmado_em timestamptz,
    confirmado_por text
  )`,
  `create index if not exists pagamentos_cliente_idx on pagamentos (cliente_id, criado_em desc)`,
  `create table if not exists historico (
    id bigint generated always as identity primary key,
    cliente_id uuid not null references clientes (id) on delete cascade,
    quando timestamptz not null default now(),
    tipo text not null check (tipo in ('cadastro', 'pagamento', 'loja', 'email', 'suporte', 'nota')),
    texto text not null                         -- CIFRADO (pode conter dados pessoais)
  )`,
  `create index if not exists historico_cliente_idx on historico (cliente_id, id desc)`,
  `create table if not exists configuracoes (chave text primary key, valor jsonb not null)`,
];

/** Cria as tabelas uma vez por instância (a primeira requisição paga o custo, as outras não). */
export function preparadorDeEsquema(banco) {
  let pronto = null;
  return () => (pronto ??= (async () => { for (const comando of ESQUEMA) await banco.consultar(comando); })().catch((e) => { pronto = null; throw e; }));
}
