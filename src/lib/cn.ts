import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Junta classes resolvendo conflitos do Tailwind (a última vence: "text-ink" + "text-alert" = "text-alert"). */
export function cn(...parts: ClassValue[]) {
  return twMerge(clsx(parts));
}
