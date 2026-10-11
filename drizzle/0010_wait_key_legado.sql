-- Alertas de espera de antes da 0008 (sem wait_key) ganham a chave da espera atual do lead,
-- para contarem como atraso (sino, Fila, Hoje) e escalarem para a gestão como os novos.
-- Só aditivo (preenche coluna nova que está nula) e idempotente (só mexe em linha com wait_key nulo).
-- Escopo: alerta aberto do tipo sem_resposta_minutos, de lead que ainda espera resposta, criado durante essa espera.
-- Um por espera (o índice alerts_wait_uq aceita um aberto por chave): o da gestão primeiro, depois o mais antigo.
-- O formato é o de waitKeyOf (src/server/rules/wait-key.ts): "<deal_id>:<awaiting_reply_since em ISO UTC com milissegundos>".
-- pushed_at é marcado para o worker não mandar push de alerta antigo.
WITH legado AS (
  SELECT a.id,
         a.deal_id::text || ':' || to_char(d.awaiting_reply_since AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS chave,
         row_number() OVER (PARTITION BY a.deal_id ORDER BY (a.audience = 'gestao') DESC, a.created_at ASC, a.id ASC) AS n
  FROM alerts a
  JOIN deals d ON d.id = a.deal_id
  WHERE a.resolved_at IS NULL
    AND a.wait_key IS NULL
    AND a.type = 'sem_resposta_minutos'
    AND d.awaiting_reply_since IS NOT NULL
    AND a.created_at >= d.awaiting_reply_since
)
UPDATE alerts
SET wait_key = legado.chave,
    pushed_at = coalesce(alerts.pushed_at, now())
FROM legado
WHERE alerts.id = legado.id
  AND legado.n = 1
  AND NOT EXISTS (SELECT 1 FROM alerts x WHERE x.resolved_at IS NULL AND x.wait_key = legado.chave);
