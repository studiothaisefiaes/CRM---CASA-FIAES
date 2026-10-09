const rtf = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });
export function relTime(iso: string | Date, now = Date.now()) {
  const t = typeof iso === "string" ? new Date(iso).getTime() : iso.getTime();
  const s = Math.round((t - now) / 1000);
  const a = Math.abs(s);
  if (a < 45) return "agora";
  if (a < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (a < 86400) return rtf.format(Math.round(s / 3600), "hour");
  if (a < 86400 * 7) return rtf.format(Math.round(s / 86400), "day");
  return new Date(t).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}
export function elapsed(fromIso: string, now = Date.now()) {
  const s = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 1000));
  if (s < 3600) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  if (s < 86400) return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`;
  return `${Math.floor(s / 86400)}d`;
}
export const money = (cents: number | null | undefined) =>
  cents == null ? "—" : (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: cents % 100 ? 2 : 0 });
export function initials(name?: string | null) {
  if (!name) return "?";
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
}
export const dateTime = (iso: string | Date) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
export const PAYMENT_LABEL: Record<string, string> = { pix: "Pix", cartao: "Cartão", boleto: "Boleto", dinheiro: "Dinheiro" };
