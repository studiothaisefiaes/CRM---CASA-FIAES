CREATE TABLE "agenda_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"professional_id" uuid,
	"title" text NOT NULL,
	"notes" text,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"weekdays" smallint[],
	"external_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid,
	"client_name" text,
	"professional_id" uuid,
	"service_id" uuid,
	"service_label" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"duration_min" smallint,
	"status" text NOT NULL,
	"avec_status" text,
	"price_cents" integer,
	"notes" text,
	"origin" text DEFAULT 'avec' NOT NULL,
	"created_by_name" text,
	"deal_id" uuid,
	"external_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "avec_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signature" text NOT NULL,
	"title" text NOT NULL,
	"file_name" text NOT NULL,
	"file_hash" text NOT NULL,
	"columns" jsonb NOT NULL,
	"rows" jsonb NOT NULL,
	"row_count" integer NOT NULL,
	"date_from" date,
	"date_to" date,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"imported_by" uuid,
	"applied" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid,
	"client_name" text,
	"package_name" text NOT NULL,
	"service_label" text,
	"total_sessions" integer NOT NULL,
	"used_sessions" integer DEFAULT 0 NOT NULL,
	"price_cents" integer,
	"purchased_on" date,
	"valid_until" date,
	"origin" text DEFAULT 'avec' NOT NULL,
	"external_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "package_uses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_package_id" uuid,
	"contact_id" uuid,
	"client_name" text,
	"used_on" date NOT NULL,
	"item" text NOT NULL,
	"professional_name" text,
	"comanda" text,
	"external_key" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid,
	"client_name" text,
	"sold_on" date NOT NULL,
	"comanda" text,
	"item" text NOT NULL,
	"kind" text NOT NULL,
	"category" text,
	"professional_id" uuid,
	"professional_name" text,
	"qty" numeric DEFAULT 1 NOT NULL,
	"value_cents" integer,
	"discount_cents" integer,
	"total_cents" integer,
	"from_package" boolean DEFAULT false NOT NULL,
	"origin" text DEFAULT 'avec' NOT NULL,
	"external_key" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid,
	"client_name" text,
	"comanda" text,
	"paid_on" date,
	"comanda_on" date,
	"method" text,
	"value_cents" integer NOT NULL,
	"external_key" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lists" ADD COLUMN "price_cents" integer;--> statement-breakpoint
ALTER TABLE "lists" ADD COLUMN "duration_min" smallint;--> statement-breakpoint
ALTER TABLE "lists" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "professionals" ADD COLUMN "full_name" text;--> statement-breakpoint
ALTER TABLE "professionals" ADD COLUMN "role" text;--> statement-breakpoint
ALTER TABLE "professionals" ADD COLUMN "avec_id" text;--> statement-breakpoint
ALTER TABLE "agenda_blocks" ADD CONSTRAINT "agenda_blocks_professional_id_professionals_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professionals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_professional_id_professionals_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professionals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_service_id_lists_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."lists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "avec_reports" ADD CONSTRAINT "avec_reports_imported_by_users_id_fk" FOREIGN KEY ("imported_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_packages" ADD CONSTRAINT "client_packages_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_uses" ADD CONSTRAINT "package_uses_client_package_id_client_packages_id_fk" FOREIGN KEY ("client_package_id") REFERENCES "public"."client_packages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_uses" ADD CONSTRAINT "package_uses_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_items" ADD CONSTRAINT "sales_items_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_items" ADD CONSTRAINT "sales_items_professional_id_professionals_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professionals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_payments" ADD CONSTRAINT "sales_payments_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agenda_blocks_external_uq" ON "agenda_blocks" USING btree ("external_key");--> statement-breakpoint
CREATE INDEX "agenda_blocks_range_idx" ON "agenda_blocks" USING btree ("starts_on","ends_on");--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_external_uq" ON "appointments" USING btree ("external_key");--> statement-breakpoint
CREATE INDEX "appointments_starts_idx" ON "appointments" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "appointments_contact_idx" ON "appointments" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "appointments_professional_idx" ON "appointments" USING btree ("professional_id");--> statement-breakpoint
CREATE UNIQUE INDEX "avec_reports_sig_hash_uq" ON "avec_reports" USING btree ("signature","file_hash");--> statement-breakpoint
CREATE INDEX "avec_reports_imported_idx" ON "avec_reports" USING btree ("imported_at");--> statement-breakpoint
CREATE UNIQUE INDEX "client_packages_external_uq" ON "client_packages" USING btree ("external_key");--> statement-breakpoint
CREATE INDEX "client_packages_contact_idx" ON "client_packages" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "package_uses_external_uq" ON "package_uses" USING btree ("external_key");--> statement-breakpoint
CREATE INDEX "package_uses_contact_idx" ON "package_uses" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_items_external_uq" ON "sales_items" USING btree ("external_key");--> statement-breakpoint
CREATE INDEX "sales_items_contact_idx" ON "sales_items" USING btree ("contact_id","sold_on");--> statement-breakpoint
CREATE INDEX "sales_items_sold_idx" ON "sales_items" USING btree ("sold_on");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_payments_external_uq" ON "sales_payments" USING btree ("external_key");--> statement-breakpoint
CREATE INDEX "sales_payments_contact_idx" ON "sales_payments" USING btree ("contact_id");