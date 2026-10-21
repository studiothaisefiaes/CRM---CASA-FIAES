import { PREFERENCE_LABEL, type Preference } from "@/lib/appointment-preference";
import { cn } from "@/lib/cn";

/** Selo da preferência (6.11): "♥ Pediu ela" em destaque; "Tanto faz" em cinza; nada quando não informado. */
export function PreferenceTag({ value, className }: { value: Preference | null | undefined; className?: string }) {
  if (!value) return null;
  return (
    <span data-preferencia={value} title={value === "escolhida" ? "A cliente pediu esta profissional" : "A cliente aceita qualquer profissional"}
      className={cn("inline-flex shrink-0 items-center gap-0.5 rounded-[4px] px-1 text-xs font-semibold",
        value === "escolhida" ? "bg-gold-soft text-gold-ink" : "bg-paper-3 text-muted", className)}>
      {value === "escolhida" && <span aria-hidden>♥</span>}{PREFERENCE_LABEL[value]}
    </span>
  );
}
