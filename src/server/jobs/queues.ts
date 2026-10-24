import type { PgBoss } from "pg-boss";

/** Concluídos ficam 1 dia (o padrão do pg-boss é 7: com 20 filas por minuto, o job_common chegou a 77 MB em 23/10). */
export const QUEUE_DELETE_AFTER_S = 86_400;

/**
 * Cria (ou acerta) uma fila do worker: "exclusive", um job na fila ou rodando por vez, para a rodada que passa de 1 min não empilhar
 * as dos minutos seguintes. A política não muda depois de criada: fila antiga (standard) é apagada e recriada (só perde jobs concluídos
 * e o que estava esperando, que o agendamento repõe no minuto seguinte).
 */
export async function ensureQueue(boss: PgBoss, name: string): Promise<void> {
  const q = await boss.getQueue(name);
  if (q?.policy === "exclusive") {
    if (q.deleteAfterSeconds !== QUEUE_DELETE_AFTER_S) await boss.updateQueue(name, { deleteAfterSeconds: QUEUE_DELETE_AFTER_S });
    return;
  }
  if (q) await boss.deleteQueue(name);
  await boss.createQueue(name, { policy: "exclusive", deleteAfterSeconds: QUEUE_DELETE_AFTER_S });
}

/** A fila interna dos agendamentos (uma linha por disparo, todo minuto, de cada fila) era a maior do job_common: também 1 dia. */
export async function trimScheduleQueue(boss: PgBoss): Promise<void> {
  await boss.updateQueue("__pgboss__send-it", { deleteAfterSeconds: QUEUE_DELETE_AFTER_S });
}

/**
 * Na partida do worker (só existe um): job que ficou "active" é de um worker que morreu no meio da rodada (queda do banco, kill do pm2).
 * Numa fila exclusive ele seguraria todos os disparos com a mesma chave até expirar (15 min, revisão 24/10). Cancela e devolve quantos.
 */
export async function releaseStaleActive(boss: PgBoss, name: string): Promise<number> {
  const stale = (await boss.findJobs(name)).filter((j) => j.state === "active").map((j) => j.id);
  if (stale.length) await boss.cancel(name, stale);
  return stale.length;
}
