import * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";
import { cn } from "@/utils/cn";

export const DropdownMenu = DropdownPrimitive.Root;
export const DropdownMenuTrigger = DropdownPrimitive.Trigger;

export function DropdownMenuContent({ className, ...props }: React.ComponentProps<typeof DropdownPrimitive.Content>) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content
        className={cn("z-50 min-w-[10rem] rounded-lg border border-slate-200 bg-white p-1 shadow-lg", className)}
        sideOffset={4}
        {...props}
      />
    </DropdownPrimitive.Portal>
  );
}
export function DropdownMenuItem({ className, ...props }: React.ComponentProps<typeof DropdownPrimitive.Item>) {
  return (
    <DropdownPrimitive.Item
      className={cn("cursor-pointer rounded-md px-2.5 py-1.5 text-xs text-slate-600 outline-none data-[highlighted]:bg-slate-100", className)}
      {...props}
    />
  );
}
