-- Fase B, Task 14: "Marcar como não lida" (marca à mão na conversa) e "Acompanhar" (lista pessoal no Hoje). Só acrescenta.
ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "marked_unread_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "marked_unread_by" uuid;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deal_follows" (
	"user_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deal_follows_user_id_deal_id_pk" PRIMARY KEY("user_id","deal_id")
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deal_follows" ADD CONSTRAINT "deal_follows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deal_follows" ADD CONSTRAINT "deal_follows_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deal_follows_deal_idx" ON "deal_follows" USING btree ("deal_id");
