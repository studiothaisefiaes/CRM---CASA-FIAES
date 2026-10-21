-- QA r66 (I-7): "Ver" não edita, não importa em massa e não apaga para todos. Três permissões novas, concedidas UMA vez aos perfis
-- Gestão, Atendente e Recepção, que já faziam isso no dia a dia (nada muda para elas). Perfil personalizado não ganha: a gestão liga em Perfis.
-- Pode rodar 2 vezes. Finalizar e Faltou passam a pedir agenda.marcar (que a equipe já tem): sem migration.
UPDATE "profiles" SET "permissions" = array_append("permissions", 'contatos.editar') WHERE "key" IN ('gestao', 'atendente', 'recepcao') AND NOT ('contatos.editar' = ANY("permissions"));--> statement-breakpoint
UPDATE "profiles" SET "permissions" = array_append("permissions", 'contatos.importar') WHERE "key" IN ('gestao', 'atendente', 'recepcao') AND NOT ('contatos.importar' = ANY("permissions"));--> statement-breakpoint
UPDATE "profiles" SET "permissions" = array_append("permissions", 'mensagem.apagar_todos') WHERE "key" IN ('gestao', 'atendente', 'recepcao') AND NOT ('mensagem.apagar_todos' = ANY("permissions"));
