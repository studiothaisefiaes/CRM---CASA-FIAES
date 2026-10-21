-- Várias pessoas no mesmo número (17/10, caso Cati: mãe e filha no mesmo celular). A pessoa a mais é um contato com ficha própria,
-- ligado ao titular do número (`shares_phone_with`); o telefone dela é "pessoa:<id>" (não é número de WhatsApp: a conversa e as
-- mensagens continuam no titular). `phone_relation`: filha, mãe, marido… (opcional). Só acrescenta.
ALTER TABLE "contacts" ADD COLUMN "shares_phone_with" uuid;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "phone_relation" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_shares_phone_with_contacts_id_fk" FOREIGN KEY ("shares_phone_with") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contacts_shares_phone_idx" ON "contacts" USING btree ("shares_phone_with") WHERE "contacts"."shares_phone_with" is not null;
