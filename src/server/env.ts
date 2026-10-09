import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().url(),
  EVOLUTION_URL: z.string().url(),
  EVOLUTION_API_KEY: z.string().min(16),
  WEBHOOK_SECRET: z.string().min(24),
  WEBHOOK_PUBLIC_URL: z.string().url(),
  SESSION_SECRET: z.string().min(32),
  APP_URL: z.string().url(),
  DEV_TOOLS: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  /** Onde ficam fotos, áudios e figurinhas baixados do WhatsApp (entra no backup). */
  MEDIA_DIR: z.string().optional(),
  /** Pasta dos backups (scripts/backup.sh). Fica fora do repositório. Padrão: ~/backups/casa-fiaes-crm. */
  BACKUP_DIR: z.string().optional(),
  /** Quantos proxies confiáveis (Caddy) ficam na frente do app: 1 em produção, 0 em dev. Define de onde sai o IP no rate limit. */
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).default(1),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Configuração inválida no .env: ${issues}`);
  }
  cached = parsed.data;
  // Simulador nunca liga em produção, mesmo com a flag esquecida.
  if (cached.NODE_ENV === "production") cached.DEV_TOOLS = false;
  return cached;
}
