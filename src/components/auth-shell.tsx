import type { ReactNode } from "react";

export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <main className="ds-congelada min-h-dvh grid lg:grid-cols-[1fr_minmax(420px,520px)] bg-paper">
      <section className="relative hidden lg:flex flex-col justify-between bg-ink text-paper p-12 overflow-hidden">
        <svg className="absolute -left-10 bottom-10 w-[140%] text-gold/30" viewBox="0 0 600 160" aria-hidden>
          <path d="M0 120 C60 120 70 40 120 48 C170 56 140 140 100 124 C60 108 110 28 180 52 C250 76 236 150 206 140 C170 128 214 40 290 66 C350 86 346 140 320 134 C290 128 330 52 400 78 C460 100 520 104 600 90" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </svg>
        <p className="text-sm text-paper/60">Casa Fiaes, Salvador</p>
        <div className="relative">
          <p className="font-display text-[56px] leading-[0.95] font-light">Nenhuma cliente<br /><em className="text-gold">esquecida.</em></p>
          <p className="mt-5 text-paper/70 max-w-[36ch]">Cada conversa do WhatsApp vira um atendimento acompanhado, do primeiro &quot;oi&quot; ao agendamento.</p>
        </div>
        <p className="text-xs text-paper/40">CRM Casa Fiaes</p>
      </section>
      <section className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-[380px]">
          <p className="lg:hidden font-display text-[22px] mb-10">Casa <em className="text-gold">Fiaes</em></p>
          <h1 className="font-display text-[40px] leading-none font-light">{title}</h1>
          {subtitle && <p className="text-graphite mt-3 mb-8">{subtitle}</p>}
          {children}
        </div>
      </section>
    </main>
  );
}
