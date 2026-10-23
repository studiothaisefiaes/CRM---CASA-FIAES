-- 22/10 (pedido do dono: "botar quantos assistentes eu quiser"): até 20 assistentes por serviço na comanda, o mesmo teto da agenda.
ALTER TABLE "comanda_item_assistants" DROP CONSTRAINT "comanda_item_assistants_position_ck";--> statement-breakpoint
ALTER TABLE "comanda_item_assistants" ADD CONSTRAINT "comanda_item_assistants_position_ck" CHECK ("comanda_item_assistants"."position" between 1 and 20);--> statement-breakpoint
UPDATE "settings" SET "value" = jsonb_set("value"::jsonb, '{assistentesMax}', '20') WHERE "key" = 'caixa_recursos';
