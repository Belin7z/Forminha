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
  // equipe da Forminha: entra com usuário próprio (ex.: FMV-0427), nunca com e-mail
  `create table if not exists funcionarios (
    id uuid primary key,
    numero int not null unique check (numero between 1000 and 9999),
    funcao text not null check (funcao in ('gerente', 'vendedor', 'suporte', 'financeiro')),
    nome text not null,                         -- CIFRADO
    senha_hash text not null,                   -- só o resumo (scrypt)
    trocar_senha boolean not null default true, -- senha temporária: cria a própria no 1º acesso
    ativo boolean not null default true,
    versao int not null default 0,              -- muda ao trocar a senha ou desativar: derruba as sessões
    criado_em timestamptz not null default now(),
    ultimo_acesso timestamptz
  )`,
  // quem fez o quê na Central (sem dados pessoais: usuário, ação e o nome da loja)
  `create table if not exists atividades (
    id bigint generated always as identity primary key,
    em timestamptz not null default now(),
    quem text not null,                         -- 'dono' ou o id do funcionário
    usuario text not null,                      -- 'Dono' ou o usuário (FMV-0427)
    acao text not null,
    alvo text not null default ''
  )`,
  `create index if not exists atividades_em_idx on atividades (em desc)`,
  `create index if not exists atividades_quem_idx on atividades (quem, em desc)`,
  // o sino: o que acabou de acontecer (sem dados pessoais: nome da loja e valores) e até onde cada pessoa já viu
  `create table if not exists avisos (
    id bigint generated always as identity primary key,
    em timestamptz not null default now(),
    tipo text not null,                         -- pagamento | loja_pronta | parada | cadastro
    titulo text not null,
    texto text not null default '',
    cliente_id uuid references clientes (id) on delete cascade,
    permissao text                              -- quem vê: uma permissão, 'dono' ou null (todos)
  )`,
  `create table if not exists avisos_vistos (quem text primary key, ate bigint not null default 0)`,
  // funil de vendas: "interessada" (interesse registrado, ainda sem cobrança), quem cadastrou e quando a loja ficou pronta
  `do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'clientes_situacao_check' and pg_get_constraintdef(oid) like '%interessada%') then
      alter table clientes drop constraint if exists clientes_situacao_check;
      alter table clientes add constraint clientes_situacao_check check (situacao in ('interessada', 'aguardando_pagamento', 'pago', 'cancelado'));
    end if;
  end $$`,
  `alter table clientes add column if not exists cadastrado_por text`, // "Dono" ou "FMV-0427 · Ana"
  `alter table clientes add column if not exists pronta_em timestamptz`,
  // cupons de desconto e indicação (o código de indicação é um cupom ligado à cliente que indica)
  `create table if not exists cupons (
    id uuid primary key default gen_random_uuid(),
    codigo text not null unique,                -- sempre em maiúsculas
    tipo text not null check (tipo in ('percentual', 'valor')),
    valor integer not null check (valor > 0),   -- % ou centavos
    validade date,                              -- último dia que vale (vazio = sem prazo)
    max_usos integer check (max_usos > 0),      -- vazio = sem limite
    usos integer not null default 0,
    ativo boolean not null default true,
    indicacao_de uuid references clientes (id) on delete cascade,
    criado_em timestamptz not null default now()
  )`,
  `alter table clientes add column if not exists cupom text`,
  `alter table clientes add column if not exists desconto_centavos integer not null default 0`,
  `alter table clientes add column if not exists indicada_por uuid references clientes (id) on delete set null`,
  `alter table clientes add column if not exists credito_centavos integer not null default 0`, // ganho indicando (abate nas mensalidades)
  // segurança: verificação em duas etapas (dono e equipe) e tentativas de login (valem para todas as cópias da Central)
  `create table if not exists duas_etapas (
    quem text primary key,                      -- 'dono' ou o id do funcionário
    segredo text,                               -- CIFRADO
    pendente text,                              -- CIFRADO: enquanto a pessoa ainda não digitou o primeiro código
    ativo boolean not null default false,
    reserva jsonb not null default '[]'::jsonb, -- só o resumo dos códigos de reserva
    ultimo_passo bigint,                        -- o mesmo código não vale duas vezes
    base text not null default '',
    ligada_em timestamptz
  )`,
  // mensalidade (assinatura): a cobrança mensal usa a mesma tabela de pagamentos (tipo 'mensalidade')
  `alter table pagamentos add column if not exists tipo text not null default 'loja'`, // 'loja' (a criação) ou 'mensalidade'
  `alter table pagamentos add column if not exists vencimento date`,
  `alter table pagamentos add column if not exists credito_usado_centavos integer not null default 0`,
  `alter table pagamentos add column if not exists lembrete_em timestamptz`,
  `alter table pagamentos add column if not exists nota_fiscal jsonb`,          // { numero, link, emitida_em }
  `alter table clientes add column if not exists mensalidade_centavos integer`,  // vazio = o valor padrão
  `alter table clientes add column if not exists proximo_vencimento date`,
  `alter table clientes add column if not exists assinatura_isenta boolean not null default false`,
  `alter table clientes add column if not exists suspensa_em timestamptz`,
  `alter table clientes add column if not exists assinatura_estado jsonb`,       // o que a loja já sabe (evita escrever à toa)
  `create table if not exists tentativas_login (
    chave text primary key,                     -- 'ip:…', 'conta:…', 'codigo:…'
    falhas integer not null default 0,
    bloqueado_ate timestamptz,
    atualizado_em timestamptz not null default now()
  )`,
];

/** Cria as tabelas uma vez por instância (a primeira requisição paga o custo, as outras não). */
export function preparadorDeEsquema(banco) {
  let pronto = null;
  return () => (pronto ??= (async () => { for (const comando of ESQUEMA) await banco.consultar(comando); })().catch((e) => { pronto = null; throw e; }));
}
