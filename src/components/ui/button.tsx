"use client";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "gold";
type Size = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 font-medium whitespace-nowrap select-none transition-[background,color,box-shadow,transform,opacity] duration-150 ease-[var(--ease-out-soft)] active:scale-[0.98] disabled:opacity-45 disabled:pointer-events-none pointer-coarse:min-h-11";
const variants: Record<Variant, string> = {
  primary: "bg-ink text-paper hover:bg-ink-2 shadow-[inset_0_1px_0_rgb(255_255_255/0.08)]",
  secondary: "bg-paper text-ink border border-line-strong hover:bg-paper-2",
  ghost: "text-ink hover:bg-paper-2",
  danger: "bg-alert text-white hover:brightness-110",
  gold: "bg-gold text-ink hover:brightness-105",
};
const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-sm rounded-[8px]",
  md: "h-10 px-4 text-base rounded-[var(--radius-control)]",
  lg: "h-12 px-5 text-base rounded-[var(--radius-control)]",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, className, children, disabled, ...rest }, ref,
) {
  return (
    <button ref={ref} className={cn(base, variants[variant], sizes[size], className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading && <span className="size-3.5 rounded-full border-2 border-current border-r-transparent animate-spin" aria-hidden />}
      {children}
    </button>
  );
});
