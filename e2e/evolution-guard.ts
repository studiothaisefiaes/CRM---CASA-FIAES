/**
 * O servidor do e2e (e o de medição) NUNCA pode falar com a Evolution de verdade: a porta 8080 local é a do usuário
 * (port-forward do colima) com o WhatsApp real da Recepção conectado. Os testes usam um endereço morto.
 */
export const E2E_EVOLUTION_URL = "http://127.0.0.1:9";

export function assertNotRealEvolution(url: string | undefined, real: { realUrl?: string; realPort?: string } = {}) {
  let u: URL;
  try { u = new URL(url ?? ""); } catch { throw new Error(`EVOLUTION_URL do e2e inválida ou vazia (${url ?? "vazia"}): use ${E2E_EVOLUTION_URL}.`); }
  const port = u.port || (u.protocol === "https:" ? "443" : "80");
  const norm = (s: string) => s.replace(/\/+$/, "");
  if (port === "8080" || (real.realPort && port === real.realPort) || (real.realUrl && norm(real.realUrl) === norm(u.toString())))
    throw new Error(`Recusado: EVOLUTION_URL do e2e (${url}) aponta para a Evolution real (porta ${port}). Use ${E2E_EVOLUTION_URL}.`);
}

// Rodado como comando (antes de subir o servidor do e2e): confere o EVOLUTION_URL que o servidor vai receber.
if (process.argv[1]?.endsWith("evolution-guard.ts")) {
  try {
    assertNotRealEvolution(process.env.EVOLUTION_URL, { realPort: process.env.EVOLUTION_PORT });
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
