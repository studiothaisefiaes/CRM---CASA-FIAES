ALTER TABLE "contacts" ADD COLUMN "wa_lid" text;--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_wa_lid_uq" ON "contacts" USING btree ("wa_lid");