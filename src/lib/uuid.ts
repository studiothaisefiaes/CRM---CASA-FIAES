/** UUID de verdade (8-4-4-4-12 em hexadecimal). `/^[0-9a-f-]{36}$/` deixa passar "------…", que o Postgres recusa com erro 500. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);
