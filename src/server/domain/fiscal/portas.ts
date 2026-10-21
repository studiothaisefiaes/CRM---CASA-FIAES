import { settleNfseBeforeReopen, type NfseDeps } from "./nfse";
import { settleNfceBeforeReopen, type NfceDeps } from "./nfce/nfce";

export { assertNoAuthorizedNoteTx } from "./fila";

/** Deps de mentira das duas notas (só nos testes); em produção cada nota cria as suas, no ambiente gravado nela. */
export type NotaDeps = { nfse?: NfseDeps; nfce?: NfceDeps };

/**
 * As três portas da comanda (reabrir, cancelar, reabrir para corrigir), ANTES da transação: confere no governo a NFS-e e a NFC-e incertas
 * (podem falar com a Sefin e a SEFAZ). Dentro da transação, `assertNoAuthorizedNoteTx` olha as duas.
 */
export async function settleNotesBeforeReopen(comandaId: string, deps?: NotaDeps, actorId: string | null = null): Promise<void> {
  await settleNfseBeforeReopen(comandaId, deps?.nfse, actorId);
  await settleNfceBeforeReopen(comandaId, deps?.nfce, actorId);
}
