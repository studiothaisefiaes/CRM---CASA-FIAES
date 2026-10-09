// Formatação leve para o navegador (sem carregar libphonenumber no cliente).
export function formatPhoneClient(e164: string) {
  const d = e164.replace(/\D/g, "");
  if (d.startsWith("55") && d.length === 13) return `(${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.startsWith("55") && d.length === 12) return `(${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`;
  return e164;
}
