"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { salvarEstoqueConfig } from "@/app/(app)/config/estoque/actions";
import type { EstoqueConfig } from "@/lib/estoque-settings";

/** Configurações › Estoque: "Como a Casa controla os produtos?" O liga/desliga e os padrões fiscais de um produto novo. */
export function EstoqueSettingsForm({ config }: { config: EstoqueConfig }) {
  const [on, setOn] = useState(config.ligado);
  const [cfop, setCfop] = useState(config.cfopPadrao);
  const [csosn, setCsosn] = useState(config.csosnPadrao);
  const [unidade, setUnidade] = useState(config.unidadePadrao);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const next = { ligado: on, cfopPadrao: cfop.trim(), csosnPadrao: csosn.trim(), unidadePadrao: unidade.trim() };
  const same = next.ligado === config.ligado && next.cfopPadrao === config.cfopPadrao && next.csosnPadrao === config.csosnPadrao && next.unidadePadrao === config.unidadePadrao;
  const row = "flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-line px-4 py-3";
  return (
    <section className="rounded-[var(--radius-card)] border border-line bg-paper p-5">
      <h2 className="text-lg font-semibold">Como a Casa controla os produtos?</h2>
      <div className="mt-4 grid gap-2.5">
        <div className={row}>
          <span className="text-sm">Produtos e estoque<span className="block text-xs text-muted">Desligado, o produto na comanda volta a ser texto livre e o estoque não baixa. A aba Produtos some de Serviços e pacotes.</span></span>
          <Switch checked={on} label="Produtos e estoque" onChange={setOn} />
        </div>
        <label className={row}>
          <span className="text-sm">CFOP padrão<span className="block text-xs text-muted">Código fiscal de um produto novo, 4 números. Cada produto guarda o seu.</span></span>
          <Input inputMode="numeric" maxLength={4} className="w-24" value={cfop} onChange={(e) => setCfop(e.target.value)} aria-label="CFOP" />
        </label>
        <label className={row}>
          <span className="text-sm">CSOSN padrão<span className="block text-xs text-muted">Situação do Simples Nacional de um produto novo, 3 números.</span></span>
          <Input inputMode="numeric" maxLength={3} className="w-24" value={csosn} onChange={(e) => setCsosn(e.target.value)} aria-label="CSOSN" />
        </label>
        <label className={row}>
          <span className="text-sm">Unidade padrão<span className="block text-xs text-muted">De 1 a 6 letras, como UN ou ML.</span></span>
          <Input maxLength={6} className="w-24" value={unidade} onChange={(e) => setUnidade(e.target.value)} aria-label="Unidade" />
        </label>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-alert">{error}</p>}
      <div className="mt-5 flex justify-end">
        <Button loading={pending} disabled={same} onClick={() => start(async () => {
          const r = await salvarEstoqueConfig(next);
          setError(r.ok ? null : r.error);
          toast(r.ok ? "Estoque salvo" : r.error, r.ok ? "ok" : "error");
        })}>Salvar</Button>
      </div>
    </section>
  );
}
