-- Fase C (itens 21 e 25b): as fichas da cliente. Anamnese e Campos da ficha são uma por cliente; a Consultoria de imagem é uma por visita.
-- As 32 perguntas da anamnese são as da Casa (§3.2 da parte 2 do levantamento do Avec). As 16 da consultoria chegam pela importação do Avec.
-- Só acrescenta; pode rodar 2 vezes (as perguntas têm id fixo e ON CONFLICT DO NOTHING).
CREATE TABLE IF NOT EXISTS "form_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"form" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"label" text NOT NULL,
	"kind" text NOT NULL,
	"options" text[] DEFAULT '{}'::text[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"avec_slug" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "form_questions_form_check" CHECK ("form" IN ('anamnese','consultoria','campos')),
	CONSTRAINT "form_questions_kind_check" CHECK ("kind" IN ('opcao','caixas','texto','texto_longo','sim_nao','data'))
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "form_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"visit_id" uuid,
	"value" jsonb NOT NULL,
	"source" text DEFAULT 'crm' NOT NULL,
	"answered_by" uuid,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"external_key" text,
	CONSTRAINT "form_answers_source_check" CHECK ("source" IN ('crm','avec')),
	CONSTRAINT "form_answers_contact_question_visit_uq" UNIQUE NULLS NOT DISTINCT ("contact_id","question_id","visit_id")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "client_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"visit_id" uuid,
	"kind" text NOT NULL,
	"media_path" text NOT NULL,
	"media_mime" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	CONSTRAINT "client_photos_kind_check" CHECK ("kind" IN ('antes','depois'))
);--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'form_questions_created_by_users_id_fk') THEN
		ALTER TABLE "form_questions" ADD CONSTRAINT "form_questions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id");
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'form_answers_contact_id_contacts_id_fk') THEN
		ALTER TABLE "form_answers" ADD CONSTRAINT "form_answers_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'form_answers_question_id_form_questions_id_fk') THEN
		ALTER TABLE "form_answers" ADD CONSTRAINT "form_answers_question_id_form_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "form_questions"("id");
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'form_answers_visit_id_visits_id_fk') THEN
		ALTER TABLE "form_answers" ADD CONSTRAINT "form_answers_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "visits"("id");
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'form_answers_answered_by_users_id_fk') THEN
		ALTER TABLE "form_answers" ADD CONSTRAINT "form_answers_answered_by_users_id_fk" FOREIGN KEY ("answered_by") REFERENCES "users"("id");
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'client_photos_contact_id_contacts_id_fk') THEN
		ALTER TABLE "client_photos" ADD CONSTRAINT "client_photos_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'client_photos_visit_id_visits_id_fk') THEN
		ALTER TABLE "client_photos" ADD CONSTRAINT "client_photos_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "visits"("id");
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'client_photos_created_by_users_id_fk') THEN
		ALTER TABLE "client_photos" ADD CONSTRAINT "client_photos_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id");
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'client_photos_deleted_by_users_id_fk') THEN
		ALTER TABLE "client_photos" ADD CONSTRAINT "client_photos_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "users"("id");
	END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "form_questions_form_position_idx" ON "form_questions" ("form","position");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "form_answers_contact_idx" ON "form_answers" ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "form_answers_external_key_uq" ON "form_answers" ("external_key") WHERE "external_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_photos_contact_idx" ON "client_photos" ("contact_id","created_at");--> statement-breakpoint
INSERT INTO "form_questions" ("id","form","position","label","kind","options") VALUES
	(md5('fichas:anamnese:1')::uuid, 'anamnese', 0, 'Como conheceu a Casa Fiaes?', 'opcao', ARRAY['Indicação','Instagram','Evento','Cliente antiga','Outro']::text[]),
	(md5('fichas:anamnese:2')::uuid, 'anamnese', 1, 'Como é sua rotina hoje?', 'opcao', ARRAY['Muito corrida','Moderada','Tranquila']::text[]),
	(md5('fichas:anamnese:3')::uuid, 'anamnese', 2, 'Você pratica atividade física? Qual?', 'texto', '{}'::text[]),
	(md5('fichas:anamnese:4')::uuid, 'anamnese', 3, 'Com que frequência você costuma cuidar do cabelo?', 'opcao', ARRAY['Toda semana','Quinzenalmente','Mensalmente','Só quando necessário']::text[]),
	(md5('fichas:anamnese:5')::uuid, 'anamnese', 4, 'Quanto tempo você costuma dedicar ao cabelo no dia a dia?', 'texto', '{}'::text[]),
	(md5('fichas:anamnese:6')::uuid, 'anamnese', 5, 'Você já utilizou:', 'caixas', ARRAY['Coloração','Descoloração/Mechas','Progressiva/Alisamento','Mega hair/Alongamento','Preenchimento capilar','Outro']::text[]),
	(md5('fichas:anamnese:7')::uuid, 'anamnese', 6, 'Já teve alguma reação química ou alergia? Qual?', 'texto', '{}'::text[]),
	(md5('fichas:anamnese:8')::uuid, 'anamnese', 7, 'Quais procedimentos realizou nos últimos 12 meses?', 'texto', '{}'::text[]),
	(md5('fichas:anamnese:9')::uuid, 'anamnese', 8, 'Estrutura do fio', 'opcao', ARRAY['Fino','Médio','Grosso']::text[]),
	(md5('fichas:anamnese:10')::uuid, 'anamnese', 9, 'Textura natural', 'opcao', ARRAY['Liso','Ondulado','Cacheado','Crespo']::text[]),
	(md5('fichas:anamnese:11')::uuid, 'anamnese', 10, 'Porosidade', 'opcao', ARRAY['Baixa','Média','Alta']::text[]),
	(md5('fichas:anamnese:12')::uuid, 'anamnese', 11, 'Densidade', 'opcao', ARRAY['Baixa','Média','Alta']::text[]),
	(md5('fichas:anamnese:13')::uuid, 'anamnese', 12, 'Elasticidade', 'opcao', ARRAY['Preservada','Sensível','Comprometida']::text[]),
	(md5('fichas:anamnese:14')::uuid, 'anamnese', 13, 'Condições do couro cabeludo', 'caixas', ARRAY['Saudável','Oleosidade excessiva','Sensibilidade','Queda','Caspa','Rarefação']::text[]),
	(md5('fichas:anamnese:15')::uuid, 'anamnese', 14, 'Como você se sente hoje em relação ao seu cabelo?', 'texto_longo', '{}'::text[]),
	(md5('fichas:anamnese:16')::uuid, 'anamnese', 15, 'O que mais te incomoda nele?', 'texto_longo', '{}'::text[]),
	(md5('fichas:anamnese:17')::uuid, 'anamnese', 16, 'Você já viveu alguma experiência negativa com cabelo? Qual?', 'texto_longo', '{}'::text[]),
	(md5('fichas:anamnese:18')::uuid, 'anamnese', 17, 'Se pudesse mudar algo hoje, o que mudaria?', 'texto_longo', '{}'::text[]),
	(md5('fichas:anamnese:19')::uuid, 'anamnese', 18, 'Seu cabelo representa quem você sente que é?', 'opcao', ARRAY['Sim','Não','Parcialmente']::text[]),
	(md5('fichas:anamnese:20')::uuid, 'anamnese', 19, 'Como você gosta de se perceber?', 'caixas', ARRAY['Sofisticada','Natural','Marcante','Delicada','Moderna','Clássica','Poderosa','Discreta']::text[]),
	(md5('fichas:anamnese:21')::uuid, 'anamnese', 20, 'Quais palavras melhor descrevem sua personalidade?', 'texto_longo', '{}'::text[]),
	(md5('fichas:anamnese:22')::uuid, 'anamnese', 21, 'Existe alguma imagem ou mulher que representa o estilo que você admira?', 'texto_longo', '{}'::text[]),
	(md5('fichas:anamnese:23')::uuid, 'anamnese', 22, 'Você costuma se arrumar mais para', 'opcao', ARRAY['Trabalho','Eventos sociais','Vida pessoal','Todas as opções']::text[]),
	(md5('fichas:anamnese:24')::uuid, 'anamnese', 23, 'Seu estilo predominante é:', 'opcao', ARRAY['Clássico','Contemporâneo','Romântico','Natural','Fashion','Minimalista']::text[]),
	(md5('fichas:anamnese:25')::uuid, 'anamnese', 24, 'Você prefere resultados que sejam:', 'opcao', ARRAY['Práticos e rápidos','Impactantes e transformadores','Naturais e discretos','Versáteis']::text[]),
	(md5('fichas:anamnese:26')::uuid, 'anamnese', 25, 'O que fez você buscar a Casa Fiaes neste momento?', 'texto_longo', '{}'::text[]),
	(md5('fichas:anamnese:27')::uuid, 'anamnese', 26, 'Qual resultado você deseja alcançar?', 'texto_longo', '{}'::text[]),
	(md5('fichas:anamnese:28')::uuid, 'anamnese', 27, 'Você busca mais:', 'opcao', ARRAY['Volume','Comprimento','Mudança de imagem','Recuperação capilar','Facilidade no dia a dia','Segurança estética']::text[]),
	(md5('fichas:anamnese:29')::uuid, 'anamnese', 28, 'Existe algo que você NÃO deseja?', 'texto_longo', '{}'::text[]),
	(md5('fichas:anamnese:30')::uuid, 'anamnese', 29, 'Você tem disponibilidade para manutenção periódica?', 'opcao', ARRAY['Sim','Não','Depende']::text[]),
	(md5('fichas:anamnese:31')::uuid, 'anamnese', 30, 'Você costuma investir em autocuidado com que frequência?', 'texto_longo', '{}'::text[]),
	(md5('fichas:anamnese:32')::uuid, 'anamnese', 31, 'Declaração de que as informações são verdadeiras e de que o resultado depende das condições do cabelo', 'sim_nao', '{}'::text[])
ON CONFLICT ("id") DO NOTHING;
