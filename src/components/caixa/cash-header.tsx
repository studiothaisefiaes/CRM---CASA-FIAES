"use client";
import { useId, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { buttonClass } from "@/components/ui/button-styles";
import { Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { openCashAction } from "@/app/(app)/caixa/actions";
import type { MyCash } from "@/server/queries/caixa";
import { parseMoneyInput } from "@/lib/money-input";
import { Menu } from "@/components/ui/menu";
import { MovementSheet } from "./movement-sheet";

/**
 * Cabeçalho do Caixa (Plano 3, caixa por pessoa): aberto, "⋯" (Sangria, Suprimento) e "Fechar caixa / dia". Fechado, o cabeçalho fica
 * vazio: o convite para abrir mora no corpo da tela ({@link CashClosed}, r68 #5).
 */
export function CashHeader({ mine, valeProfessionals }: { name: string; mine: MyCash | null; canGerir?: boolean; hasOptions?: boolean; valeProfessionals?: { id: string; name: string }[] }) {
  const [sheet, setSheet] = useState<null | "sangria" | "suprimento">(null);
  if (!mine) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Menu label="Mais do caixa" trigger={<span aria-hidden className="text-xl leading-none">⋯</span>} triggerClassName="h-10 min-w-10 border border-line-strong"
        items={[{ label: "Retirar dinheiro (sangria)", onSelect: () => setSheet("sangria") }, { label: "Colocar dinheiro (suprimento)", onSelect: () => setSheet("suprimento") }]} />
      <FecharLink />
      {(sheet === "sangria" || sheet === "suprimento") && <MovementSheet open onClose={() => setSheet(null)} kind={sheet} valeProfessionals={valeProfessionals} />}
    </div>
  );
}

/**
 * Caixa fechado (dsgfix, r68 #5): a tela mostra só o convite para abrir, com o fundo de troco e o botão dourado (ação do dia). A comanda
 * não aparece aberta nem com erro antes de qualquer toque. Sem a regra "só recebe com caixa aberto" (`canSkip`), um link discreto mostra
 * as comandas do dia mesmo assim (o que for recebido fica sem caixa).
 */
export function CashClosed({ name, canSkip, children }: { name: string; canSkip: boolean; children: ReactNode }) {
  const [opening, setOpening] = useState("");
  const [skip, setSkip] = useState(false);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const id = useId();
  const open = () => start(async () => {
    const cents = parseMoneyInput(opening || "0");
    if (cents == null) { toast("Digite o fundo de troco (pode ser zero).", "error"); return; }
    const r = await openCashAction({ openingCents: cents });
    if (!r.ok) { toast(r.error, "error"); return; }
    toast("Caixa aberto"); setOpening(""); router.refresh();
  });
  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby={`${id}-t`} className="mx-auto flex w-full max-w-[560px] flex-col items-center gap-5 rounded-[var(--radius-card)] border border-line bg-paper px-6 py-10 text-center shadow-[var(--shadow-card)] sm:px-10">
        <div>
          <h2 id={`${id}-t`} className="font-display text-xl font-normal text-ink">Seu caixa está fechado</h2>
          <p className="mt-2 text-base text-graphite">Abra o caixa com o dinheiro que está na gaveta para receber as comandas do dia.</p>
        </div>
        <form className="flex w-full flex-col items-stretch gap-3 sm:w-auto sm:flex-row sm:items-end" onSubmit={(e) => { e.preventDefault(); open(); }}>
          <div className="flex flex-col gap-1.5 text-left">
            <label htmlFor={`${id}-fundo`} className="text-sm font-medium text-graphite">Fundo de troco (R$)</label>
            <Input id={`${id}-fundo`} inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="0,00" className="sm:w-32" />
          </div>
          <Button type="submit" variant="gold" loading={pending}>{`Abrir caixa, ${name}`}</Button>
        </form>
        {canSkip && !skip && (
          <Button variant="link" size="sm" onClick={() => setSkip(true)}>Ver as comandas sem abrir o caixa</Button>
        )}
      </section>
      {canSkip && skip && (
        <>
          <p role="note" className="text-sm text-graphite">O que for recebido agora fica sem caixa até você abrir o seu.</p>
          {children}
        </>
      )}
    </div>
  );
}

/** Um só botão para fechar: leva ao assistente de fechamento (caixa e dia); o histórico fica dentro dele. Secundário (psico r68 #5): o principal é receber. */
function FecharLink() {
  return <Link href="/caixa/fechar-dia" className={buttonClass({ variant: "secondary" })}>Fechar caixa / dia</Link>;
}
