import { removePushSubscriptionAction } from "@/app/(app)/push/actions";
import { logout } from "@/app/login/actions";

/** Antes de sair: tira a inscrição de push deste aparelho (para o próximo usuário dele não receber os avisos de outro). Tudo best-effort. */
async function dropPushSubscription() {
  try {
    if (!("serviceWorker" in navigator)) return;
    const reg = await navigator.serviceWorker.getRegistration("/");
    const sub = await reg?.pushManager?.getSubscription();
    if (!sub) return;
    await removePushSubscriptionAction(sub.endpoint).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  } catch { /* sem push ou sem service worker: segue para sair */ }
}

/** Ação do botão Sair: limpa o push (no máximo 3 s) e encerra a sessão. */
export async function logoutAction() {
  await Promise.race([dropPushSubscription(), new Promise((r) => setTimeout(r, 3000))]);
  await logout();
}
