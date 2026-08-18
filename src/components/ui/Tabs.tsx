import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/utils/cn";

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn("mb-4 flex gap-1 border-b border-slate-200", className)} {...props} />;
}
export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "border-b-2 border-transparent px-3 py-2 text-sm font-medium text-slate-500 transition-colors hover:text-slate-700 data-[state=active]:border-indigo-600 data-[state=active]:text-indigo-700",
        className
      )}
      {...props}
    />
  );
}
export function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn(className)} {...props} />;
}
