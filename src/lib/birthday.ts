/** Aniversário digitado na ficha ("14/11" ou "14/11/1990"). Puro: a tela valida antes e o servidor confere de novo. */
export function parseBirthday(raw: string): { ok: true; day: number; month: number; year: number | null } | { ok: false; error: string } {
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
  if (!m) return { ok: false, error: "Use dia/mês, ex.: 14/11." };
  const [day, month, year] = [Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : null];
  const test = new Date(Date.UTC(year ?? 2000, month - 1, day)); // 2000 é bissexto: 29/02 sem ano vale
  if (test.getUTCMonth() !== month - 1 || test.getUTCDate() !== day) return { ok: false, error: "Data de aniversário inválida." };
  return { ok: true, day, month, year };
}

/** "05/03" ou "05/03/1992". */
export function birthdayLabel(day: number | null, month: number | null, year?: number | null): string | null {
  if (!day || !month) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(day)}/${p(month)}${year ? `/${year}` : ""}`;
}

const pad2 = (n: number) => String(n).padStart(2, "0");
/** O aniversário guardado como o campo mostra: "05/03" ou "05/03/1990"; sem dia e mês, vazio. */
export const birthdayText = (c: { birthDay: number | null; birthMonth: number | null; birthYear: number | null }) =>
  c.birthDay && c.birthMonth ? `${pad2(c.birthDay)}/${pad2(c.birthMonth)}${c.birthYear ? `/${c.birthYear}` : ""}` : "";
