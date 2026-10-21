"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { proNoteAction } from "@/app/(pro)/pro/actions";

/** "Anotar": vai para a ficha técnica da cliente (só texto e foto; nada de telefone ou conversa). */
export function NoteSheet({ appointmentId }: { appointmentId: string }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const form = useRef<HTMLFormElement>(null);
  const toast = useToast();
  const router = useRouter();
  const save = () => start(async () => {
    const fd = new FormData(form.current!);
    fd.set("appointmentId", appointmentId);
    const r = await proNoteAction(fd);
    if (!r.ok) { toast(r.error, "error"); return; }
    toast("Anotação salva na ficha"); form.current?.reset(); setOpen(false); router.refresh();
  });
  return (
    <>
      <Button size="lg" variant="secondary" onClick={() => setOpen(true)}>Anotar</Button>
      <Sheet open={open} onClose={() => setOpen(false)} side="bottom" title="Anotar na ficha"
        footer={<div className="flex w-full justify-end gap-2"><Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button><Button loading={pending} onClick={save}>Salvar</Button></div>}>
        <form ref={form} className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <Field label="Anotação" htmlFor="nota-texto" hint="Até 2.000 caracteres. Vai para a ficha técnica da cliente.">
            <Textarea id="nota-texto" name="body" maxLength={2000} required />
          </Field>
          <Field label="Foto (opcional, até 5 MB)" htmlFor="nota-foto">
            <input id="nota-foto" name="photo" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment" className="min-h-11 text-sm" />
          </Field>
        </form>
      </Sheet>
    </>
  );
}
