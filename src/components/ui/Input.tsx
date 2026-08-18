import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/utils/cn";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

const Input = forwardRef<HTMLInputElement, InputProps>(({ className, error, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "h-9 w-full rounded-lg border bg-white px-3 text-sm text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-indigo-500 disabled:bg-slate-50 disabled:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:disabled:bg-slate-800 dark:disabled:text-slate-500",
      error ? "border-rose-400" : "border-slate-300",
      className
    )}
    {...props}
  />
));
Input.displayName = "Input";
export { Input };
