"use client";
import { useEffect, useState } from "react";
import { savePushSubscriptionAction } from "@/app/(app)/push/actions";

const KEY = "cf-push-optin";
const remember = () => { try { localStorage.setItem(KEY, "1"); } catch { /* sem storage */ } };
const remembered = () => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } };

function keyBytes(b64url: string) {
  const b64 = (b64url + "=".repeat((4 - (b64url.length % 4)) % 4)).replaceAll("-", "+").replaceAll("_", "/");
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const supported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/** Convite único no Hoje para receber o aviso no celular. No iPhone só existe com o app instalado na tela inicial. */
export function PushOptIn({ publicKey }: { publicKey: string }) {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supported()) return;
    // Em produção mantém o service worker em dia; em dev só registra quando a pessoa toca no convite (não atrapalha o HMR).
    if (process.env.NODE_ENV === "production") navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
    // eslint-disable-next-line react-hooks/set-state-in-effect -- depende de APIs do navegador, só existem após montar
    if (Notification.permission === "default" && !remembered()) setShow(true);
  }, []);

  if (!show) return null;

  const dismiss = () => { remember(); setShow(false); };
  const enable = async () => {
    setBusy(true); setError(null);
    try {
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { dismiss(); return; }
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
      const json = sub.toJSON();
      const r = await savePushSubscriptionAction({ endpoint: sub.endpoint, p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" });
      if (!r.ok) { setError(r.error); return; }
      dismiss();
    } catch {
      setError("Não deu para ativar os avisos neste aparelho.");
    } finally { setBusy(false); }
  };

  return (
    <div role="region" aria-label="Avisos no celular" className="mt-5 rounded-[var(--radius-card)] border border-line bg-gold-soft px-4 py-3 flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-sm text-ink">Receber aviso no celular quando um lead atrasar</p>
        {error && <p role="alert" className="text-sm text-alert mt-1">{error}</p>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button type="button" onClick={dismiss} disabled={busy} className="min-h-11 px-4 rounded-[var(--radius-control)] text-sm text-graphite hover:text-ink">Agora não</button>
        <button type="button" onClick={enable} disabled={busy} className="min-h-11 px-4 rounded-[var(--radius-control)] bg-ink text-paper text-sm font-semibold disabled:opacity-60">{busy ? "Ativando…" : "Ativar avisos"}</button>
      </div>
    </div>
  );
}
