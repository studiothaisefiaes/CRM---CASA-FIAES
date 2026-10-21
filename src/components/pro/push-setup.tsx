"use client";
import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { savePushSubscriptionAction } from "@/app/(app)/push/actions";
import { sendTestPushAction } from "@/app/(pro)/pro/actions";
import { subscribeAndSave } from "@/components/shell/push-sync";

const noSubscribe = () => () => {};
const env = () => {
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  return `${ios ? 1 : 0}${standalone ? 1 : 0}${supported ? 1 : 0}`;
};

/** "Ativar avisos" com um aviso de teste na hora. No iPhone, o aviso só funciona com o app na tela inicial: explica e não tenta. */
export function PushSetup({ publicKey }: { publicKey: string | null }) {
  const state = useSyncExternalStore(noSubscribe, env, () => "000");
  const [ios, standalone, supported] = [state[0] === "1", state[1] === "1", state[2] === "1"];
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!publicKey) return <p role="status" className="text-sm text-graphite">Os avisos no celular ainda não estão ligados no sistema. Fale com a gestão.</p>;
  if (ios && !standalone) return <p role="status" className="rounded-[var(--radius-control)] bg-gold-soft px-3 py-2 text-sm text-ink">No iPhone, o aviso só funciona com o app na tela inicial. Siga os passos acima e abra pelo ícone &quot;Minha agenda&quot;.</p>;
  if (!supported) return <p role="status" className="text-sm text-graphite">Este navegador não recebe avisos. No Android, use o Chrome.</p>;
  const enable = async () => {
    setBusy(true); setMsg(null);
    try {
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      if ((await Notification.requestPermission()) !== "granted") { setMsg("Os avisos ficaram bloqueados. Libere nas configurações do celular e tente de novo."); return; }
      const saved = await subscribeAndSave(reg, publicKey, savePushSubscriptionAction);
      if (!saved.ok) { setMsg("error" in saved ? saved.error : "Não deu para ativar os avisos."); return; }
      const t = await sendTestPushAction();
      setMsg(t.ok && t.data?.sent ? "Avisos ligados! Chegou um aviso de teste agora." : "Avisos ligados. Se o aviso de teste não chegar em 1 minuto, fale com a gestão.");
    } catch { setMsg("Não deu para ativar os avisos neste aparelho."); }
    finally { setBusy(false); }
  };
  return (
    <div className="flex flex-col gap-2">
      <Button size="lg" loading={busy} onClick={enable}>Ativar avisos</Button>
      {msg && <p role="status" className="text-sm text-graphite">{msg}</p>}
    </div>
  );
}
