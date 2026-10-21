import { z } from "zod";
import { DEMO_DATABASE, isDemoDatabaseUrl } from "./demo";

const schema = z.object({
  DATABASE_URL: z.string().url(),
  EVOLUTION_URL: z.string().url(),
  EVOLUTION_API_KEY: z.string().min(16),
  WEBHOOK_SECRET: z.string().min(24),
  /** Banco da Evolution (só leitura): de onde vem o par @lid ↔ número para juntar contatos de número oculto. Opcional. */
  EVOLUTION_DATABASE_URL: z.string().url().optional(),
  /** Segredo do link que o diálogo "Post para URL" do ChatGuru chama (?token=). Sem ele, a importação fica desligada (404). */
  CHATGURU_IMPORT_SECRET: z.string().min(24).optional(),
  WEBHOOK_PUBLIC_URL: z.string().url(),
  SESSION_SECRET: z.string().min(32),
  APP_URL: z.string().url(),
  /** Endereço dos links da cliente (ex.: https://agenda.casafiaes.com.br). Nesse host o app só serve /c/*. Sem ele, os links usam o APP_URL. */
  CLIENT_LINK_URL: z.string().url().optional(),
  DEV_TOOLS: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  /** Ambiente de demonstração (scripts/demo.sh): dados fictícios no banco crm_demo, WhatsApp de mentira e etiqueta "Demonstração". */
  DEMO: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
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
  /** Sugestão de resposta por IA (Configurações › Conversas): chave da API da Anthropic. Sem ela, a IA fica parada (sem erro). Nunca no repositório. */
  ANTHROPIC_API_KEY: z.string().optional(),
  /** Modelo da sugestão por IA. Padrão: claude-haiku-5-5 (o teto de gasto usa os preços do Haiku 5.5). */
  AI_MODEL: z.string().optional(),
  /** Só teste: endereço da API da IA (o e2e usa um endereço morto). */
  AI_BASE_URL: z.string().optional(),
  /**
   * Nota fiscal (Fase D): certificado A1 (.pfx) e senha para assinar a NFS-e, e o CSC da SEFAZ-BA para a NFC-e. Todos opcionais: sem eles a nota
   * fica "faltando" na prontidão, sem erro. Só no .env do servidor, nunca no banco nem no repositório.
   */
  FISCAL_CERT_PATH: z.string().min(1).optional(),
  FISCAL_CERT_PASSWORD: z.string().min(1).optional(),
  NFCE_CSC: z.string().min(1).optional(),
  NFCE_CSC_ID: z.string().min(1).optional(),
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).default(1),
});

export type Env = z.infer<typeof schema>;

/** Lê e confere a configuração (sem cache; `env()` guarda o resultado de `process.env`). */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Configuração inválida no .env: ${issues}`);
  }
  const e = parsed.data;
  // A demonstração troca o WhatsApp por um de mentira: só pode rodar no banco dela, nunca no real.
  if (e.DEMO && !isDemoDatabaseUrl(e.DATABASE_URL)) throw new Error(`DEMO=true só roda no banco ${DEMO_DATABASE} (ou num ${DEMO_DATABASE}_<nome>).`);
  // Simulador nunca liga em produção, mesmo com a flag esquecida (exceto na demonstração, que é um build de produção com dados fictícios).
  if (e.NODE_ENV === "production" && !e.DEMO) e.DEV_TOOLS = false;
  return e;
}

let cached: Env | null = null;
export function env(): Env {
  if (cached) return cached;
  cached = parseEnv(process.env);
  return cached;
}

/** Chaves VAPID (par completo) ou null quando o push está desligado. */
export function vapidConfig(): { publicKey: string; privateKey: string; subject: string } | null {
  const e = env();
  if (!e.VAPID_PUBLIC_KEY || !e.VAPID_PRIVATE_KEY) return null;
  return { publicKey: e.VAPID_PUBLIC_KEY, privateKey: e.VAPID_PRIVATE_KEY, subject: e.VAPID_SUBJECT ?? e.APP_URL };
}
