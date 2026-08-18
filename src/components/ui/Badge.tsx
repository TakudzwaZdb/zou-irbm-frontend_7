import type { HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/utils/cn";

const badgeVariants = cva("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium", {
  variants: {
    variant: {
      default: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
      success: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
      warning: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
      danger: "bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
      info: "bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",
    },
  },
  defaultVariants: { variant: "default" },
});

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
