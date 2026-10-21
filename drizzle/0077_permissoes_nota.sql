-- Fase D, Task 12: emitir, ver e cancelar nota fiscal. A Gestão recebe as três (o seed também dá, via GESTAO_REQUIRED);
-- Atendente e Recepção recebem emitir e ver uma vez pelo seed (ONE_TIME_GRANTS).
UPDATE "profiles" SET "permissions" = array_append("permissions", 'nota.emitir') WHERE "key" = 'gestao' AND NOT 'nota.emitir' = ANY("permissions");--> statement-breakpoint
UPDATE "profiles" SET "permissions" = array_append("permissions", 'nota.ver') WHERE "key" = 'gestao' AND NOT 'nota.ver' = ANY("permissions");--> statement-breakpoint
UPDATE "profiles" SET "permissions" = array_append("permissions", 'nota.cancelar') WHERE "key" = 'gestao' AND NOT 'nota.cancelar' = ANY("permissions");
