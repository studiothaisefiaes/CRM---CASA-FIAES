import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes, type SelectHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

const control =
  "w-full bg-paper border border-control/70 rounded-[10px] px-3 text-[14px] text-ink placeholder:text-muted transition-[border-color,box-shadow] duration-150 hover:border-graphite/40 focus:outline-none focus:border-ink focus:shadow-[0_0_0_3px_rgb(184_134_63/0.22)] aria-[invalid=true]:border-alert disabled:bg-paper-2 disabled:text-muted";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={cn(control, "h-10", className)} {...p} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...p }, ref) {
  return <textarea ref={ref} className={cn(control, "py-2.5 min-h-20 resize-y leading-relaxed", className)} {...p} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...p }, ref) {
  return (
    <select ref={ref} className={cn(control, "h-10 pr-8 appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 12 12%22><path d=%22M3 4.5l3 3 3-3%22 fill=%22none%22 stroke=%22%235c5c5c%22 stroke-width=%221.5%22/></svg>')] bg-no-repeat bg-[right_10px_center]", className)} {...p}>
      {children}
    </select>
  );
});

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[12.5px] font-medium text-graphite">{label}</label>
      {children}
      {error ? <p className="text-[12.5px] text-alert" role="alert">{error}</p> : hint ? <p className="text-[12.5px] text-muted">{hint}</p> : null}
    </div>
  );
}
