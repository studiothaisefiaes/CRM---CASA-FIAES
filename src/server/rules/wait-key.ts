/** Identifica uma espera (lead + momento em que a cliente ficou sem resposta). Um alerta ativo por espera. */
export function waitKeyOf(dealId: string, awaitingSince: Date): string {
  return `${dealId}:${awaitingSince.toISOString()}`;
}
