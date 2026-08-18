import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/utils/cn";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;

export function DialogContent({ className, children, title, ...props }: React.ComponentProps<typeof DialogPrimitive.Content> & { title: string }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-slate-900/40 data-[state=open]:animate-in data-[state=open]:fade-in" />
      <DialogPrimitive.Content
        className={cn("fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl bg-white shadow-xl", className)}
        {...props}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <DialogPrimitive.Title className="text-sm font-medium text-slate-900">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Close className="text-slate-400 hover:text-slate-600" aria-label="Close">
            <X size={16} />
          </DialogPrimitive.Close>
        </div>
        <div className="max-h-[75vh] overflow-y-auto p-5">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
