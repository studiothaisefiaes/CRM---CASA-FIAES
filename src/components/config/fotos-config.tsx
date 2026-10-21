"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { savePhotoConfigAction } from "@/app/(app)/config/fichas/actions";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { PHOTO_MAX_MB_DEFAULT, PHOTO_MAX_MB_MAX, PHOTO_MAX_MB_MIN } from "@/lib/client-photos";

/** Configurações › Fichas da cliente › Fotos de antes e depois: o tamanho máximo da foto (padrão 5 MB, de 1 a 20). O limite vale no servidor. */
export function FotosConfig({ maxMb, fotosOn }: { maxMb: number; fotosOn: boolean }) {
  const [v, setV] = useState(String(maxMb));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast(); const router = useRouter();
  const range = `Use um número inteiro de ${PHOTO_MAX_MB_MIN} a ${PHOTO_MAX_MB_MAX}.`;
  const submit = () => {
    const n = Number(v);
    if (!v.trim() || !Number.isInteger(n) || n < PHOTO_MAX_MB_MIN || n > PHOTO_MAX_MB_MAX) { setError(range); return; }
    setError(null);
    start(async () => {
      const r = await savePhotoConfigAction({ maxMb: n });
      if (!r.ok) { setError(r.error); return; }
      toast("Tamanho da foto salvo"); router.refresh();
    });
  };
  return (
    <section className="rounded-[var(--radius-card)] border border-line bg-paper p-5" aria-labelledby="fotos-titulo">
      <h2 id="fotos-titulo" className="text-lg font-semibold">Fotos de antes e depois</h2>
      <p className="mt-1 max-w-[62ch] text-sm text-graphite">A foto vem da câmera ou de um arquivo e é guardada como veio. Fotos maiores que o limite são recusadas.</p>
      {!fotosOn && <p role="note" className="mt-3 rounded-[var(--radius-control)] bg-gold-soft px-3 py-2.5 text-sm text-gold-ink">Essa função está desligada em Configurações › Recursos. As fotos que já foram guardadas continuam guardadas.</p>}
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="w-56">
          <Field label="Tamanho máximo da foto (MB)" htmlFor="fotos-max" hint={`Padrão ${PHOTO_MAX_MB_DEFAULT} MB.`}>
            <Input id="fotos-max" type="number" inputMode="numeric" min={PHOTO_MAX_MB_MIN} max={PHOTO_MAX_MB_MAX} step={1} value={v} disabled={!fotosOn || pending}
              onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
          </Field>
        </div>
        <Button loading={pending} disabled={!fotosOn} onClick={submit}>Salvar</Button>
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-alert">{error}</p>}
    </section>
  );
}
