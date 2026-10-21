"use client";
import { useState } from "react";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { ImportButton } from "@/app/(app)/contatos/import-button";
import { MassMessageSheet } from "./mass-message-sheet";
import type { ComponentProps } from "react";

/** O menu "⋯" do topo de Clientes: Exportar, Importar e Mensagem em massa (o único botão de topo é "Nova cliente"). */
export function ContactsMoreMenu({ exportHref, canImport, mass }: { exportHref: string | null; canImport: boolean; mass: Omit<ComponentProps<typeof MassMessageSheet>, "open" | "onClose"> | null }) {
  const [imp, setImp] = useState(false); const [impN, setImpN] = useState(0);
  const [massOpen, setMassOpen] = useState(false); const [massN, setMassN] = useState(0);
  const items: MenuItem[] = [
    ...(mass ? [{ label: "Mensagem em massa", onSelect: () => { setMassN((n) => n + 1); setMassOpen(true); } }] : []),
    ...(exportHref ? [{ label: "Exportar lista (CSV)", onSelect: () => { window.location.assign(exportHref); } }] : []),
    ...(canImport ? [{ label: "Importar clientes", onSelect: () => { setImpN((n) => n + 1); setImp(true); } }] : []),
  ];
  if (items.length === 0) return null;
  return (
    <>
      <Menu label="Mais ações" trigger={<span aria-hidden className="text-xl leading-none">⋯</span>} items={items} triggerClassName="h-10 min-w-10 border border-line-strong" />
      {canImport && <ImportButton key={impN} controlled={{ open: imp, setOpen: setImp }} />}
      {mass && <MassMessageSheet key={massN} open={massOpen} onClose={() => setMassOpen(false)} {...mass} />}
    </>
  );
}
