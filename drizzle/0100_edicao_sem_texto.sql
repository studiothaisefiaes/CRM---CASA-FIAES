-- Edição de mensagem no formato novo do WhatsApp (03/11): chega criptografada (secretEncryptedMessage, secretEncType 2 = MESSAGE_EDIT) e
-- nem a Evolution abre o texto novo. A mensagem original passa a dizer "editada, veja o texto novo no celular". Aditivo e idempotente.
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "edited_text_missing" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- As edições que já chegaram (eram descartadas): marca as originais.
UPDATE "messages" m SET "edited_at" = coalesce(m."edited_at", w."received_at"), "edited_text_missing" = true
FROM "webhook_events" w
WHERE w."provider" = 'evolution' AND w."payload"->'data'->'message'->'secretEncryptedMessage'->>'secretEncType' IN ('2', 'MESSAGE_EDIT')
  AND m."external_id" = w."payload"->'data'->'message'->'secretEncryptedMessage'->'targetMessageKey'->>'id';
