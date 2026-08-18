import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "@/utils/cn";

const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100",
      className
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";
export { Textarea };
