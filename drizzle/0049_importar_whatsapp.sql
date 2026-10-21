-- Histórico do "Exportar conversa" do WhatsApp (16/10): mensagens importadas ganham a data da importação e a chave da linha do arquivo. Só acrescenta.
ALTER TABLE "messages" ADD COLUMN "imported_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "import_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "messages_import_key_uq" ON "messages" USING btree ("contact_id","import_key") WHERE "messages"."import_key" is not null;
