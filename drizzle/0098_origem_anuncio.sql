-- De onde veio a conversa (pedido do dono, 26/10: "diferenciar as campanhas, o que veio de campanha e o que não veio, como no ChatGuru").
-- `ad_campaigns`: um anúncio do Meta (Click-to-WhatsApp) por `ad_id` (o `sourceId` que o WhatsApp manda; o nome da campanha não vem): o nome
-- dado pela gestão em Configurações › Origens (vale para as conversas antigas também), de onde veio (instagram/facebook), o post, título e
-- texto do anúncio, primeira e última vez visto e arquivado. As colunas `meta_*` ficam para a API de Marketing do Meta (preparada, desligada).
-- `deals`: o anúncio da conversa (`ad_id`, FK lógica para ad_campaigns.ad_id: o anúncio pode chegar antes da linha existir), o clique
-- (`ad_ctwa_clid`), quando o anúncio foi visto na conversa (`ad_at`) e a porta de entrada normalizada (`entry_point`) com o valor cru
-- (`entry_point_raw`, "fonte|app"). Só acrescenta; pode rodar 2 vezes.
CREATE TABLE IF NOT EXISTS "ad_campaigns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "ad_id" text NOT NULL,
  "name" text,
  "source_app" text,
  "post_url" text,
  "media_url" text,
  "thumbnail_url" text,
  "title" text,
  "body" text,
  "meta_campaign_name" text,
  "meta_adset_name" text,
  "meta_ad_name" text,
  "meta_synced_at" timestamp with time zone,
  "first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "archived_at" timestamp with time zone,
  "named_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ad_campaigns_ad_id_check" CHECK ("ad_id" ~ '^[A-Za-z0-9_-]{1,64}$'),
  CONSTRAINT "ad_campaigns_name_check" CHECK ("name" is null or char_length("name") between 1 and 80)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ad_campaigns_ad_id_uq" ON "ad_campaigns" ("ad_id");--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "ad_id" text;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "ad_ctwa_clid" text;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "ad_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "entry_point" text;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "entry_point_raw" text;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "deals" ADD CONSTRAINT "deals_entry_point_check" CHECK ("entry_point" is null or "entry_point" in ('anuncio', 'instagram', 'link', 'busca', 'grupo', 'status', 'outro'));
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deals_ad_id_idx" ON "deals" ("ad_id") WHERE "ad_id" is not null;

-- Cati 29/10: buscar as clientes que vêm do Google e do Facebook (Site e Instagram já estavam na lista).
INSERT INTO "lists" ("kind", "label", "active", "position")
SELECT 'origin', v.label, true, (SELECT coalesce(max("position"), 0) + 1 FROM "lists" WHERE "kind" = 'origin')
FROM (VALUES ('Google'), ('Facebook')) AS v(label)
WHERE NOT EXISTS (SELECT 1 FROM "lists" l WHERE l."kind" = 'origin' AND l."label" = v.label);
