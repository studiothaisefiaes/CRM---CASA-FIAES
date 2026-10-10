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
  /** Chaves VAPID do push no celular (npm run vapid). Sem o par, o push fica desligado, sem erro. */
  VAPID_PUBLIC_KEY: z.string().min(1).optional(),
  VAPID_PRIVATE_KEY: z.string().min(1).optional(),
  /** mailto: ou https: de contato do app, exigido pelo serviço de push. Padrão: APP_URL. */
  VAPID_SUBJECT: z.string().min(1).optional(),
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

/** Chaves VAPID (par completo) ou null quando o push está desligado. */
export function vapidConfig(): { publicKey: string; privateKey: string; subject: string } | null {
  const e = env();
  if (!e.VAPID_PUBLIC_KEY || !e.VAPID_PRIVATE_KEY) return null;
  return { publicKey: e.VAPID_PUBLIC_KEY, privateKey: e.VAPID_PRIVATE_KEY, subject: e.VAPID_SUBJECT ?? e.APP_URL };
}
