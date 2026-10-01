/* ==========================================================
   AGENDAMENTO — datas, horários de funcionamento e janelas
   de retirada/entrega. A loja usa para mostrar as opções; quem
   valida de verdade é o banco (funções SQL _validar_agenda em
   supabase/migrations) — mantenha as duas regras iguais.
   `horarios` tem o formato { 0: {aberto, abre, fecha}, … 6: … }
   onde 0 = domingo.
   ========================================================== */

const dois = (n) => String(n).padStart(2, "0");

/** Date -> "AAAA-MM-DD" (data local, não UTC). */
export const dataISO = (d) => `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;

export const DATA_REGEX = /^\d{4}-\d{2}-\d{2}$/;
export const HORA_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

/** "2026-09-22" + "14:30" -> Date local. */
export function paraData(dataStr, hora = "00:00") {
  const [a, m, d] = dataStr.split("-").map(Number);
  const [h, mi] = hora.split(":").map(Number);
  return new Date(a, m - 1, d, h, mi, 0, 0);
}

function janelaDoDia(horarios, data) {
  const h = horarios?.[data.getDay()];
  return h && h.aberto ? h : null;
}

/** Horários (a cada `intervaloMin`) em que dá para agendar naquela data, respeitando o mínimo. */
export function gerarHorarios(horarios, dataStr, minimo, intervaloMin = 30) {
  if (!DATA_REGEX.test(dataStr)) return [];
  const janela = janelaDoDia(horarios, paraData(dataStr));
  if (!janela) return [];
  const inicio = paraData(dataStr, janela.abre).getTime();
  const fim = paraData(dataStr, janela.fecha).getTime();
  const passo = Math.max(10, intervaloMin) * 60000;
  const saida = [];
  for (let t = inicio; t <= fim; t += passo) {
    if (t < minimo.getTime()) continue;
    const d = new Date(t);
    saida.push(`${dois(d.getHours())}:${dois(d.getMinutes())}`);
  }
  return saida;
}

/** Datas (AAAA-MM-DD) com pelo menos um horário livre, a partir do mínimo. */
export function diasDisponiveis(horarios, minimo, intervaloMin, diasMax) {
  const dias = [];
  for (let i = 0; i <= diasMax; i++) {
    const dia = new Date(minimo.getFullYear(), minimo.getMonth(), minimo.getDate() + i);
    const iso = dataISO(dia);
    if (gerarHorarios(horarios, iso, minimo, intervaloMin).length) dias.push(iso);
  }
  return dias;
}

const DIAS_MINUSCULOS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/**
 * A situação da loja agora, em uma frase curta: "Aberto agora · até 18:00", "Abre hoje às 09:00",
 * "Abre amanhã às 09:00", "Abre segunda às 09:00" ou "Fechado no momento".
 */
export function situacaoAgora(horarios, agora = new Date()) {
  const conv = (hhmm) => { const [h, m] = String(hhmm).split(":").map(Number); return h * 60 + m; };
  if (abertaAgora(horarios, agora)) return { aberta: true, texto: `Aberto agora · até ${horarios[agora.getDay()].fecha}` };
  const minutos = agora.getHours() * 60 + agora.getMinutes();
  for (let i = 0; i < 7; i++) {
    const dia = (agora.getDay() + i) % 7;
    const h = horarios?.[dia];
    if (!h?.aberto || (i === 0 && minutos >= conv(h.abre))) continue;
    return { aberta: false, texto: `Abre ${i === 0 ? "hoje" : i === 1 ? "amanhã" : DIAS_MINUSCULOS[dia]} às ${h.abre}` };
  }
  return { aberta: false, texto: "Fechado no momento" };
}

/** A loja está dentro do horário de funcionamento neste instante? */
export function abertaAgora(horarios, agora = new Date()) {
  const janela = janelaDoDia(horarios, agora);
  if (!janela) return false;
  const minutos = agora.getHours() * 60 + agora.getMinutes();
  const conv = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
  return minutos >= conv(janela.abre) && minutos <= conv(janela.fecha);
}
