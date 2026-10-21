CREATE TABLE "ai_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid NOT NULL,
	"last_message_id" uuid NOT NULL,
	"resumo" text NOT NULL,
	"sugestao" text NOT NULL,
	"precisa_humano" boolean DEFAULT false NOT NULL,
	"motivo" text,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"cached_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd_micros" integer DEFAULT 0 NOT NULL,
	"origin" text DEFAULT 'auto' NOT NULL,
	"requested_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"used_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_last_message_id_messages_id_fk" FOREIGN KEY ("last_message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_suggestions_deal_idx" ON "ai_suggestions" USING btree ("deal_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_suggestions_created_idx" ON "ai_suggestions" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_suggestions_auto_uq" ON "ai_suggestions" USING btree ("last_message_id") WHERE "ai_suggestions"."origin" = 'auto';--> statement-breakpoint
-- Sugestão de resposta por IA nasce DESLIGADA (o dono liga em produção). Só acrescenta; não mexe se já existir.
INSERT INTO "settings" ("key", "value") VALUES ('ia_sugestao', '{"enabled": false}'::jsonb) ON CONFLICT ("key") DO NOTHING;
