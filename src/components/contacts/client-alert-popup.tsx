"use client";
import { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { alertAckKey, NO_IMAGE_USE_TEXT, popupLines, type ImageUse } from "@/lib/client-alert";

const read = (key: string) => { try { return sessionStorage.getItem(key) === "1"; } catch { return false; } };
const write = (key: string) => { try { sessionStorage.setItem(key, "1"); } catch { /* sem armazenamento: salta de novo, sem estragar nada */ } };

/**
 * O Aviso da cliente que salta ao abrir o horário ou a comanda: alergias e cuidados (Avisos fixos) e, se for o caso, "Não autorizou uso de imagem".
 * Salta uma vez por visita (ou comanda): "Entendi" guarda a chave no sessionStorage; texto novo dá chave nova. `enabled=false` não salta.
 * Quem usa põe `key` por horário/comanda para o estado recomeçar ao trocar.
 */
export function ClientAlertPopup({ contactId, scope, alertNotes, imageUse, enabled = true, noImageText = NO_IMAGE_USE_TEXT }: {
  contactId: string; scope: string; alertNotes: string | null; imageUse: ImageUse | null; enabled?: boolean; noImageText?: string;
}) {
  const lines = popupLines({ alertNotes, imageUse }, noImageText);
  const ack = alertAckKey({ contactId, scope, lines });
  // Só abre depois de uma ação na tela (horário aberto, comanda carregada), então o sessionStorage já existe; sem ele, `read` devolve falso.
  const [seen, setSeen] = useState<string | null>(null);
  if (!enabled || !lines.length) return null;
  const done = seen === ack || read(ack);
  return (
    <Dialog open={!done} onClose={() => { write(ack); setSeen(ack); }} title="Aviso da cliente" width={420}
      footer={<Button onClick={() => { write(ack); setSeen(ack); }}>Entendi</Button>}>
      <ul className="flex flex-col gap-1.5">
        {lines.map((l) => (
          <li key={l} className="flex items-start gap-2 rounded-[var(--radius-control)] border border-alert/40 bg-alert-soft px-3 py-2 text-sm font-semibold text-alert">
            <span aria-hidden className="font-semibold">!</span>{l}
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
