"use client";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

type Size = "md" | "lg";
const sizes: Record<Size, string> = {
  md: "size-8 rounded-[var(--radius-control)]",
  lg: "size-10 rounded-[var(--radius-control)]",
};

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> & {
  /** Nome acessível (obrigatório: o botão não tem texto). Também vira o tooltip. */
  label: string;
  size?: Size;
  children: ReactNode;
};

/** Botão só de ícone. No toque (pointer: coarse) o alvo chega a 44 px sem mudar o ícone. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, size = "md", className, children, type = "button", ...rest }, ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        "inline-grid shrink-0 place-items-center text-graphite select-none transition-[background,color,transform] duration-150 ease-[var(--ease-out-soft)] hover:bg-paper-2 hover:text-ink active:scale-[0.96] disabled:opacity-45 disabled:pointer-events-none pointer-coarse:min-h-11 pointer-coarse:min-w-11",
        sizes[size], className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});
