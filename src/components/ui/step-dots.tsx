import { cn } from "@/lib/cn";

/** Andamento de um assistente (dsgfix, r68 #7): pontinhos em vez de "Passo 1 de 4" escrito; o leitor de tela ouve "Etapa 1 de 4". */
export function StepDots({ current, total, className }: { current: number; total: number; className?: string }) {
  return (
    <div role="img" aria-label={`Etapa ${current} de ${total}`} className={cn("flex items-center gap-1.5", className)}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} aria-hidden className={cn("h-1.5 rounded-full transition-[width,background-color] duration-200", i < current ? "w-6 bg-gold" : "w-1.5 bg-line-strong")} />
      ))}
    </div>
  );
}
