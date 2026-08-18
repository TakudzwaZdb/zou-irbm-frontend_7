import * as LabelPrimitive from "@radix-ui/react-label";
import { cn } from "@/utils/cn";

export function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return <LabelPrimitive.Root className={cn("mb-1 block text-xs font-medium text-slate-600", className)} {...props} />;
}
