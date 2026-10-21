/**
 * Registro curto dos últimos avisos, numerados, para o long-polling (/api/stream/poll): quem não consegue manter o SSE
 * aberto (túnel/proxy que segura stream) pergunta "o que veio depois do cursor N?" e a resposta sai assim que chega um aviso.
 * `gap`: o cursor não é mais atendível (avisos descartados ou processo reiniciado); a tela recarrega tudo.
 */
export type LogWait = { cursor: number; events: string[]; gap: boolean };

export function createEventLog(max = 500) {
  let seq = 0;
  const items: { seq: number; payload: string }[] = [];
  const waiters = new Set<() => void>();
  const read = (after: number): LogWait | null => {
    const oldest = items[0]?.seq ?? seq + 1;
    if (after > seq || after < oldest - 1) return { cursor: seq, events: [], gap: true };
    if (after === seq) return null;
    return { cursor: seq, events: items.filter((i) => i.seq > after).map((i) => i.payload), gap: false };
  };
  return {
    cursor: () => seq,
    waiting: () => waiters.size,
    push(payload: string) {
      items.push({ seq: ++seq, payload });
      if (items.length > max) items.shift();
      for (const w of [...waiters]) w();
    },
    wait(after: number, timeoutMs: number, signal?: AbortSignal): Promise<LogWait> {
      const now = read(after);
      if (now) return Promise.resolve(now);
      return new Promise((resolve) => {
        const done = () => { clearTimeout(t); waiters.delete(wake); signal?.removeEventListener("abort", done); resolve(read(after) ?? { cursor: seq, events: [], gap: false }); };
        const wake = () => done();
        const t = setTimeout(done, timeoutMs);
        waiters.add(wake);
        signal?.addEventListener("abort", done, { once: true });
      });
    },
  };
}
