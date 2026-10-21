/**
 * Arquivo de calendário (.ics) da visita, conforme a RFC 5545: horários em UTC (…Z), texto escapado, linhas de até 75 bytes
 * dobradas e CRLF. Nunca leva o nome da cliente. Puro.
 */
export type IcsEvent = { uid: string; start: Date; end: Date | null; summary: string; location: string | null; description: string; now: Date };

/** 2026-10-17T02:30:00.000Z → "20261017T023000Z". */
export const icsUtc = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** Escapa texto: barra invertida, ponto e vírgula, vírgula e quebra de linha. */
export const icsEscape = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Dobra a linha em pedaços de até 75 bytes (UTF-8), sem partir caractere; a continuação começa com um espaço. */
export function icsFold(line: string): string {
  const out: string[] = [];
  let cur = "", bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch, "utf8");
    if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ""; bytes = 0; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join("\r\n ");
}

export function buildIcs(e: IcsEvent): string {
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Casa Fiaes//CRM//PT-BR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${e.uid}`,
    `DTSTAMP:${icsUtc(e.now)}`,
    `DTSTART:${icsUtc(e.start)}`,
    ...(e.end ? [`DTEND:${icsUtc(e.end)}`] : []),
    `SUMMARY:${icsEscape(e.summary)}`,
    ...(e.location ? [`LOCATION:${icsEscape(e.location)}`] : []),
    `DESCRIPTION:${icsEscape(e.description)}`,
    "END:VEVENT", "END:VCALENDAR",
  ];
  return lines.map(icsFold).join("\r\n") + "\r\n";
}
