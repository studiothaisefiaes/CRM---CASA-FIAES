import { cn } from "@/lib/cn";

/**
 * Três estilos (dsgfix): PRIMÁRIO (cheio: `primary` preto confirma; `gold` é a ação do dia; `danger` destrói), SECUNDÁRIO (contorno) e
 * DISCRETO (`ghost`, fundo só no mouse; `link`, texto dourado). Alturas fixas: sm 32 (só no computador), md 40, lg 48; no toque, ≥ 44.
 */
export type Variant = "primary" | "secondary" | "ghost" | "link" | "danger" | "gold";
export type Size = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 font-medium whitespace-nowrap select-none transition-[background,color,box-shadow,transform,opacity] duration-150 ease-[var(--ease-out-soft)] active:scale-[0.98] disabled:opacity-45 disabled:pointer-events-none pointer-coarse:min-h-11";
const variants: Record<Variant, string> = {
  primary: "bg-ink text-paper hover:bg-ink-2 shadow-[inset_0_1px_0_rgb(255_255_255/0.08)]",
  secondary: "bg-paper text-ink border border-line-strong hover:bg-paper-2",
  ghost: "text-ink hover:bg-paper-2",
  danger: "bg-alert text-white hover:brightness-110",
  gold: "bg-gold text-ink hover:brightness-105",
  link: "text-gold-ink underline-offset-4 hover:underline",
};
const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-sm rounded-[var(--radius-control)]",
  md: "h-10 px-4 text-base rounded-[var(--radius-control)]",
  lg: "h-12 px-5 text-base rounded-[var(--radius-control)]",
};

/** As classes do botão, para um `<Link>` com cara de botão. */
export const buttonClass = ({ variant = "primary", size = "md", className }: { variant?: Variant; size?: Size; className?: string } = {}) =>
  cn(base, variants[variant], sizes[size], variant === "link" && "px-1", className);

