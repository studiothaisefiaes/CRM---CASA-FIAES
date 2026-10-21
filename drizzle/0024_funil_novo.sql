ALTER TYPE "public"."stage_kind" ADD VALUE IF NOT EXISTS 'proposta';--> statement-breakpoint
ALTER TYPE "public"."stage_kind" ADD VALUE IF NOT EXISTS 'atendido';--> statement-breakpoint
ALTER TYPE "public"."stage_kind" ADD VALUE IF NOT EXISTS 'retorno';--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "followup_attempt" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "followup_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "followup_task_id" uuid;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_followup_task_id_tasks_id_fk" FOREIGN KEY ("followup_task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;