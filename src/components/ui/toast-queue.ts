/** A lista de avisos na tela: no máximo `max`. Quando passa disso sai o mais antigo SEM ação; um aviso com ação (o "Desfazer") fica até expirar. */
export function pushToast<T extends { action?: unknown }>(list: T[], next: T, max = 3): T[] {
  const out = [...list, next];
  while (out.length > max) {
    const i = out.findIndex((t, idx) => !t.action && idx < out.length - 1);
    out.splice(i === -1 ? 0 : i, 1); // só há avisos com ação: aí sai o mais antigo mesmo
  }
  return out;
}
