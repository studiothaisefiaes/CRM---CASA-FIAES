"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { ProAvatar } from "@/components/agenda/pro-avatar";
import { PHOTO_MAX_BYTES, proPhotoUrl } from "@/lib/pro-photo";
import { cn } from "@/lib/cn";

const PICK = "inline-flex min-h-11 cursor-pointer items-center rounded-[var(--radius-control)] border border-line-strong px-3.5 text-sm font-medium transition-colors hover:bg-paper-2 focus-within:ring-2 focus-within:ring-gold lg:min-h-9";

/** Foto grande com "Enviar foto" e, no celular, "Tirar foto" (abre a câmera da frente). Envia na hora; a Agenda recarrega com a nova. */
export function PhotoField({ professionalId, name, color, photoUrl }: { professionalId: string; name: string; color: string | null; photoUrl: string | null }) {
  const [pending, setPending] = useState(false);
  const [shown, setShown] = useState<string | null>(null);
  const toast = useToast();
  const router = useRouter();
  const send = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > PHOTO_MAX_BYTES) { toast("A foto passa de 5 MB. Escolha uma menor.", "error"); return; }
    setPending(true);
    try {
      const body = new FormData();
      body.append("foto", file);
      const res = await fetch(`/api/profissionais/${professionalId}/foto`, { method: "POST", body });
      const r = (await res.json().catch(() => ({}))) as { photoVersion?: string; error?: string };
      if (!res.ok || !r.photoVersion) { toast(r.error ?? "Não foi possível enviar a foto. Tente de novo.", "error"); return; }
      setShown(proPhotoUrl(professionalId, r.photoVersion, "full"));
      toast("Foto salva");
      router.refresh();
    } catch {
      toast("Sem conexão: a foto não foi enviada. Tente de novo.", "error");
    } finally { setPending(false); }
  };
  const input = (label: string, extra: Record<string, string>) => (
    <label className={cn(PICK, pending && "pointer-events-none opacity-60")}>
      {label}
      <input type="file" aria-label={label} accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={pending} {...extra}
        onChange={(e) => { void send(e.target.files?.[0]); e.target.value = ""; }} />
    </label>
  );
  return (
    <div className="flex flex-wrap items-center gap-4">
      <ProAvatar name={name} color={color} photoUrl={shown ?? photoUrl} size={96} />
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          {input(pending ? "Enviando…" : "Enviar foto", {})}
          <span className="lg:hidden">{input("Tirar foto", { capture: "user", accept: "image/*" })}</span>
        </div>
        <p className="text-sm text-muted">JPG, PNG ou WEBP, até 5 MB.</p>
      </div>
    </div>
  );
}
