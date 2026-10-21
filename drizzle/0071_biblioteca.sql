-- Biblioteca (Fase B, Task 4): arquivos da Casa (foto, vídeo MP4, PDF, áudio) para mandar em um toque ou pela fila. Só acrescenta.
-- Apagar é lógico (deleted_at): a conversa que já recebeu o arquivo continua mostrando, porque a linha da mensagem aponta para o mesmo caminho.
CREATE TABLE IF NOT EXISTS "library_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"caption" text,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"path" text NOT NULL,
	"mime" text NOT NULL,
	"kind" text NOT NULL,
	"size_bytes" integer,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "library_files_kind_check" CHECK ("kind" IN ('image', 'video', 'document', 'audio'))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "library_files_active_idx" ON "library_files" USING btree ("created_at") WHERE "deleted_at" IS NULL;
