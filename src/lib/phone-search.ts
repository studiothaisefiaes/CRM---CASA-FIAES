/**
 * Busca por telefone (Atendimento, Clientes, Quadro): o que a pessoa digitou vira os trechos de dígitos que podem estar no número guardado
 * (+55 DDD número). Aceita com ou sem +55, DDD, zero de operadora, máscara e o 9 da frente do celular:
 * "71 99000-0004", "(71) 9000-0004", "071 99000-0004", "+55 71 9 9000 0004" e "90000004" acham +5571990000004.
 * Menos de 3 dígitos: nada (vale só a busca por nome).
 */
export function phoneSearchVariants(q: string | null | undefined): string[] {
  let d = (q ?? "").replace(/\D/g, "");
  if (d.length < 3) return [];
  if (d.length >= 11) d = d.replace(/^0+/, ""); // zero de discagem ("071 …"); trecho curto como "0003" fica como está
  if (d.length >= 12 && d.startsWith("55")) d = d.slice(2);
  // "0 71 …" (zero + operadora de 2 dígitos + DDD): sobra o DDD com o número
  if (d.length >= 12 && d.length <= 13) d = d.slice(d.length - 11);
  const out = new Set<string>(d.length >= 3 ? [d] : []);
  const mobile = (c: string) => /[6-9]/.test(c);
  // sem o 9 da frente (número antigo ou digitado sem ele) → com o 9; e o contrário (o guardado pode não ter o 9)
  if (d.length === 10 && mobile(d[2])) out.add(`${d.slice(0, 2)}9${d.slice(2)}`);
  if (d.length === 8 && mobile(d[0])) out.add(`9${d}`);
  if (d.length === 11 && d[2] === "9") out.add(`${d.slice(0, 2)}${d.slice(3)}`);
  if (d.length === 9 && d[0] === "9") out.add(d.slice(1));
  return [...out];
}

/** O número guardado (só dígitos) casa com algum dos trechos. */
export const phoneMatches = (storedPhone: string, variants: string[]) => {
  const p = storedPhone.replace(/\D/g, "");
  return variants.some((v) => p.includes(v));
};
