-- Fase A: permissões por área do caixa e da comissão. "Para nada mudar no dia": quem já fazia algo antes continua fazendo.
-- Só onde ainda não tem (rodar de novo não duplica). A Gestão é o perfil de sistema com key = 'gestao' (o seed a mantém com todas).
UPDATE "profiles" SET "permissions" = array_append("permissions", 'caixa.dinheiro') WHERE 'caixa.operar' = ANY("permissions") AND NOT ('caixa.dinheiro' = ANY("permissions"));--> statement-breakpoint
UPDATE "profiles" SET "permissions" = array_append("permissions", 'caixa.assistente') WHERE 'caixa.operar' = ANY("permissions") AND NOT ('caixa.assistente' = ANY("permissions"));--> statement-breakpoint
UPDATE "profiles" SET "permissions" = array_append("permissions", 'caixa.divida') WHERE 'caixa.operar' = ANY("permissions") AND NOT ('caixa.divida' = ANY("permissions"));--> statement-breakpoint
UPDATE "profiles" SET "permissions" = array_append("permissions", 'caixa.vale') WHERE 'caixa.operar' = ANY("permissions") AND NOT ('caixa.vale' = ANY("permissions"));--> statement-breakpoint
UPDATE "profiles" SET "permissions" = array_append("permissions", 'caixa.outros') WHERE 'caixa.gerir' = ANY("permissions") AND NOT ('caixa.outros' = ANY("permissions"));--> statement-breakpoint
UPDATE "profiles" SET "permissions" = array_append("permissions", 'caixa.taxas') WHERE 'caixa.gerir' = ANY("permissions") AND NOT ('caixa.taxas' = ANY("permissions"));--> statement-breakpoint
UPDATE "profiles" SET "permissions" = array_append("permissions", 'comissao.regras') WHERE 'config.sistema' = ANY("permissions") AND NOT ('comissao.regras' = ANY("permissions"));--> statement-breakpoint
UPDATE "profiles" SET "permissions" = array_append("permissions", 'relatorios.excecoes') WHERE 'relatorios.ver' = ANY("permissions") AND 'valores.ver' = ANY("permissions") AND NOT ('relatorios.excecoes' = ANY("permissions"));--> statement-breakpoint
UPDATE "profiles" SET "permissions" = array_append("permissions", 'comissao.pagar') WHERE "key" = 'gestao' AND NOT ('comissao.pagar' = ANY("permissions"));--> statement-breakpoint
UPDATE "profiles" SET "permissions" = array_append("permissions", 'comissao.lancar') WHERE "key" = 'gestao' AND NOT ('comissao.lancar' = ANY("permissions"));
