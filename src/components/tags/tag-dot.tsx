import { cn } from "@/lib/cn";

/** Bolinha da cor da etiqueta. Decorativa: o nome está sempre escrito ao lado. */
export function TagDot({ color, className }: { color: string | null | undefined; className?: string }) {
  if (!color) return null;
  return <span aria-hidden className={cn("inline-block size-2 shrink-0 rounded-full", className)} style={{ background: color }} />;
}
