/**
 * JSON que preserva `Date` (o que a Server Action fazia sozinha): o servidor grava cada Date como `{"$d": "<iso>"}`
 * e o navegador transforma de volta. Texto com cara de data continua texto; só o que era Date vira Date.
 */
const MARK = "$d";

/** O `JSON.stringify` chama `toJSON` antes do replacer: por isso olha `this[key]` (o valor original) e não `value`. */
function replacer(this: Record<string, unknown>, key: string, value: unknown) {
  const raw = this[key];
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : { [MARK]: raw.toISOString() };
  return value;
}

function reviver(_key: string, value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const keys = Object.keys(value);
    const iso = (value as Record<string, unknown>)[MARK];
    if (keys.length === 1 && keys[0] === MARK && typeof iso === "string") return new Date(iso);
  }
  return value;
}

export const stringifyWithDates = (value: unknown): string => JSON.stringify(value, replacer);
export const parseWithDates = <T>(text: string): T => JSON.parse(text, reviver) as T;
