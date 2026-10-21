ALTER TABLE "messages" ADD COLUMN "media_duration_sec" smallint;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "playback_path" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "transcript" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "transcript_status" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "transcript_attempts" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "messages_audio_pending_idx" ON "messages" USING btree ("created_at") WHERE "messages"."kind" = 'audio' and "messages"."media_path" is not null and ("messages"."transcript_status" is null or "messages"."transcript_status" in ('pendente', 'falhou'));