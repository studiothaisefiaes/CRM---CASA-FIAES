/** CPF da cliente (pedido do dono, 16/10). Puro: servidor e navegador. Guardado só com os 11 dígitos. */
export const cpfDigits = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "").slice(0, 11);

/** Dígitos verificadores conferidos; sequências repetidas (111.111.111-11) não valem. */
export function isValidCpf(v: string | null | undefined): boolean {
  const d = (v ?? "").replace(/\D/g, "");
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const check = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return check(9) === Number(d[9]) && check(10) === Number(d[10]);
}

/** Máscara ao digitar: 000.000.000-00 (o que já foi digitado). */
export function formatCpf(v: string | null | undefined): string {
  const d = cpfDigits(v);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/** Na tela de leitura: ***.456.789-** (o "mostrar" revela, para quem pode editar o contato). */
export function maskCpf(v: string | null | undefined): string {
  const d = cpfDigits(v);
  return d.length === 11 ? `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**` : "";
}

/** Busca por CPF (Atendimento, Clientes, Quadro): termo só com números/máscara e 6+ dígitos; senão null (vale nome/telefone). */
export function cpfSearchDigits(q: string | null | undefined): string | null {
  const t = (q ?? "").trim();
  if (!/^[\d\s.\-/]+$/.test(t)) return null;
  const d = t.replace(/\D/g, "");
  return d.length >= 6 ? d.slice(0, 11) : null;
}
