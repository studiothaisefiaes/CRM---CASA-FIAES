/** CNPJ da Casa, da parceira e do tomador (Fase D, nota fiscal). Puro: servidor e navegador. Guardado só com os 14 dígitos. */
export const cnpjDigits = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "").slice(0, 14);

/** Dígitos verificadores conferidos; sequências repetidas (11.111.111/1111-11) não valem. */
export function isValidCnpj(v: string | null | undefined): boolean {
  const d = (v ?? "").replace(/\D/g, "");
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const check = (len: number) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * weights[i];
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return check(12) === Number(d[12]) && check(13) === Number(d[13]);
}

/** Máscara ao digitar: 00.000.000/0000-00 (o que já foi digitado). */
export function formatCnpj(v: string | null | undefined): string {
  const d = cnpjDigits(v);
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}
