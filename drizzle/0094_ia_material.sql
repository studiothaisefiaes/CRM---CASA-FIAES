-- Sugestão da IA com material (pedido do dono, 24/10): a resposta pronta universal com foto/vídeo que a IA indicou para ir junto
-- (ex.: o vídeo do Método Fiaes). Vazio = nenhuma. Só proposta: o "Usar" prende o anexo na caixa e a atendente aperta Enviar.
-- Apagar a resposta pronta só tira a indicação (set null). Só acrescenta; pode rodar 2 vezes.
ALTER TABLE "ai_suggestions" ADD COLUMN IF NOT EXISTS "quick_reply_id" uuid REFERENCES "lists"("id") ON DELETE SET NULL;
