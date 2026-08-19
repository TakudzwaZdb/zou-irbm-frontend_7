import type { ReactNode } from "react";
import { Label } from "./Label";

export function FormField({
  label, error, children, hint,
}: { label: string; error?: string; children: ReactNode; hint?: string }) {
  return (
    <div>
      <Label>{label}</Label>
      {children}
      {hint && !error && <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{hint}</p>}
      {error && <p className="mt-1 text-[11px] text-rose-600">{error}</p>}
    </div>
  );
}
