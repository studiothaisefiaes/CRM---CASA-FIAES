import { readFileSync } from "node:fs";
import path from "node:path";
import { DEV_BUILD } from "@/lib/version-skew";

/**
 * O id desta versão do CRM: o BUILD_ID que o `next build` grava (muda a cada deploy: pasta /opt/crm-rN nova, build novo).
 * A página leva o da versão que a montou e `/api/versao` devolve o do servidor de agora; diferentes = saiu versão nova (20/10).
 * Sem build (next dev): "dev", que nunca conta como versão nova.
 */
export function readBuildId(): string {
  if (process.env.NODE_ENV === "development") return DEV_BUILD;
  try {
    return readFileSync(path.resolve(process.cwd(), process.env.NEXT_DIST_DIR || ".next", "BUILD_ID"), "utf8").trim() || DEV_BUILD;
  } catch { return DEV_BUILD; }
}

let cached: string | null = null;
/** Lido uma vez por processo: o servidor antigo continua dizendo a versão dele mesmo depois que a pasta nova entra no lugar. */
export function buildId(): string { return (cached ??= readBuildId()); }
