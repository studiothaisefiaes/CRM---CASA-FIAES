"use client";
import { Button } from "@/components/ui/button";

/** Imprime só o recibo (`.recibo-print`): o resto da tela some na impressão. */
export const RECIBO_PRINT_CSS = "@media print { body * { visibility: hidden; } .recibo-print, .recibo-print * { visibility: visible; } .recibo-print { position: absolute; inset: 0 auto auto 0; width: 100%; } }";

export function PrintButton() {
  return <Button variant="secondary" onClick={() => window.print()}>Imprimir</Button>;
}
