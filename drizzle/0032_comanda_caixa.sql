CREATE TABLE "cash_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cash_session_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"value_cents" integer NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	CONSTRAINT "cash_movements_value_ck" CHECK ("cash_movements"."value_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "cash_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"day" date NOT NULL,
	"status" text DEFAULT 'aberto' NOT NULL,
	"opening_cents" integer DEFAULT 0 NOT NULL,
	"opened_by" uuid NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	"expected" jsonb,
	"counted" jsonb,
	"difference_cents" integer,
	"notes" text,
	"reopened_by" uuid,
	"reopened_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "client_credit_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"delta_cents" integer NOT NULL,
	"reason" text NOT NULL,
	"comanda_id" uuid,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_credit_delta_ck" CHECK ("client_credit_entries"."delta_cents" <> 0)
);
--> statement-breakpoint
CREATE TABLE "comanda_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comanda_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"service_id" uuid,
	"appointment_id" uuid,
	"professional_id" uuid,
	"qty" numeric DEFAULT 1 NOT NULL,
	"unit_cents" integer,
	"discount_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer,
	"client_package_id" uuid,
	"package_def_id" uuid,
	"commission_bp" integer,
	"commission_base_cents" integer,
	"commission_cents" integer,
	"added_by" uuid,
	"added_via" text DEFAULT 'recepcao' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid
);
--> statement-breakpoint
CREATE TABLE "comanda_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comanda_id" uuid NOT NULL,
	"method" text NOT NULL,
	"value_cents" integer NOT NULL,
	"installments" smallint,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "comanda_payments_value_ck" CHECK ("comanda_payments"."value_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "comandas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"day" date NOT NULL,
	"number" integer NOT NULL,
	"contact_id" uuid,
	"client_name" text,
	"visit_id" uuid,
	"status" text DEFAULT 'aberta' NOT NULL,
	"discount_cents" integer DEFAULT 0 NOT NULL,
	"subtotal_cents" integer,
	"total_cents" integer,
	"paid_cents" integer,
	"change_cents" integer,
	"cash_session_id" uuid,
	"request_key" text,
	"opened_by" uuid NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"notes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "package_defs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"price_cents" integer,
	"validity_days" integer,
	"items" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client_packages" ADD COLUMN "package_def_id" uuid;--> statement-breakpoint
ALTER TABLE "client_packages" ADD COLUMN "comanda_item_id" uuid;--> statement-breakpoint
ALTER TABLE "client_packages" ADD COLUMN "unit_cents" integer;--> statement-breakpoint
ALTER TABLE "client_packages" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "package_uses" ADD COLUMN "comanda_item_id" uuid;--> statement-breakpoint
ALTER TABLE "package_uses" ADD COLUMN "professional_id" uuid;--> statement-breakpoint
ALTER TABLE "package_uses" ADD COLUMN "origin" text DEFAULT 'avec' NOT NULL;--> statement-breakpoint
ALTER TABLE "package_uses" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "professional_services" ADD COLUMN "commission_bp" integer;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_cash_session_id_cash_sessions_id_fk" FOREIGN KEY ("cash_session_id") REFERENCES "public"."cash_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_opened_by_users_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_reopened_by_users_id_fk" FOREIGN KEY ("reopened_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_credit_entries" ADD CONSTRAINT "client_credit_entries_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_credit_entries" ADD CONSTRAINT "client_credit_entries_comanda_id_comandas_id_fk" FOREIGN KEY ("comanda_id") REFERENCES "public"."comandas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_credit_entries" ADD CONSTRAINT "client_credit_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comanda_items" ADD CONSTRAINT "comanda_items_comanda_id_comandas_id_fk" FOREIGN KEY ("comanda_id") REFERENCES "public"."comandas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comanda_items" ADD CONSTRAINT "comanda_items_service_id_lists_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."lists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comanda_items" ADD CONSTRAINT "comanda_items_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comanda_items" ADD CONSTRAINT "comanda_items_professional_id_professionals_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professionals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comanda_items" ADD CONSTRAINT "comanda_items_client_package_id_client_packages_id_fk" FOREIGN KEY ("client_package_id") REFERENCES "public"."client_packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comanda_items" ADD CONSTRAINT "comanda_items_package_def_id_package_defs_id_fk" FOREIGN KEY ("package_def_id") REFERENCES "public"."package_defs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comanda_items" ADD CONSTRAINT "comanda_items_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comanda_items" ADD CONSTRAINT "comanda_items_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comanda_payments" ADD CONSTRAINT "comanda_payments_comanda_id_comandas_id_fk" FOREIGN KEY ("comanda_id") REFERENCES "public"."comandas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comanda_payments" ADD CONSTRAINT "comanda_payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comandas" ADD CONSTRAINT "comandas_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comandas" ADD CONSTRAINT "comandas_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comandas" ADD CONSTRAINT "comandas_cash_session_id_cash_sessions_id_fk" FOREIGN KEY ("cash_session_id") REFERENCES "public"."cash_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comandas" ADD CONSTRAINT "comandas_opened_by_users_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comandas" ADD CONSTRAINT "comandas_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comandas" ADD CONSTRAINT "comandas_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_defs" ADD CONSTRAINT "package_defs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cash_sessions_one_open" ON "cash_sessions" USING btree ((true)) WHERE "cash_sessions"."status" = 'aberto';--> statement-breakpoint
CREATE INDEX "client_credit_contact_idx" ON "client_credit_entries" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "comanda_items_comanda_idx" ON "comanda_items" USING btree ("comanda_id");--> statement-breakpoint
CREATE INDEX "comanda_items_pro_idx" ON "comanda_items" USING btree ("professional_id","created_at");--> statement-breakpoint
CREATE INDEX "comanda_items_appointment_idx" ON "comanda_items" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "comanda_payments_comanda_idx" ON "comanda_payments" USING btree ("comanda_id");--> statement-breakpoint
CREATE UNIQUE INDEX "comandas_day_number_uq" ON "comandas" USING btree ("day","number");--> statement-breakpoint
CREATE UNIQUE INDEX "comandas_open_visit_uq" ON "comandas" USING btree ("visit_id") WHERE "comandas"."status" = 'aberta' and "comandas"."visit_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "comandas_request_key_uq" ON "comandas" USING btree ("request_key") WHERE "comandas"."request_key" is not null;--> statement-breakpoint
ALTER TABLE "client_packages" ADD CONSTRAINT "client_packages_package_def_id_package_defs_id_fk" FOREIGN KEY ("package_def_id") REFERENCES "public"."package_defs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_packages" ADD CONSTRAINT "client_packages_comanda_item_id_comanda_items_id_fk" FOREIGN KEY ("comanda_item_id") REFERENCES "public"."comanda_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_uses" ADD CONSTRAINT "package_uses_comanda_item_id_comanda_items_id_fk" FOREIGN KEY ("comanda_item_id") REFERENCES "public"."comanda_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_uses" ADD CONSTRAINT "package_uses_professional_id_professionals_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professionals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_services" ADD CONSTRAINT "professional_services_commission_ck" CHECK ("professional_services"."commission_bp" between 0 and 10000);