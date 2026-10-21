"use client";
import { createContext, useContext, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { openComandaAction } from "@/app/(app)/caixa/actions";
import { ComandaSheet, type ComandaCatalog } from "./comanda-sheet";

type Ctx = { openForAppointment: (appointmentId: string) => void; openById: (id: string) => void };
const C = createContext<Ctx | null>(null);
/** null fora do provider (caixa no Avec ou sem `caixa.operar`): quem usa esconde o botão. */
export const useComanda = () => useContext(C);

export function ComandaProvider({ catalog, children }: { catalog: ComandaCatalog; children: ReactNode }) {
  const [id, setId] = useState<string | null>(null);
  const toast = useToast();
  const router = useRouter();
  const value: Ctx = {
    openById: setId,
    openForAppointment: (appointmentId) => void openComandaAction(appointmentId).then((r) => {
      if (!r.ok) { toast(r.error, "error"); return; }
      setId(r.data!.comandaId);
      if (r.data!.created) toast(`Comanda ${r.data!.number} aberta`);
      // 0089: auxiliar do horário que não coube como assistente (limite do Caixa ou recurso desligado).
      for (const w of r.data!.warnings ?? []) toast(w, "info");
    }),
  };
  return (
    <C.Provider value={value}>
      {children}
      <ComandaSheet comandaId={id} open={!!id} onClose={() => { setId(null); router.refresh(); }} catalog={catalog} />
    </C.Provider>
  );
}
