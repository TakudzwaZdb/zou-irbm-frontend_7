import * as ToastPrimitive from "@radix-ui/react-toast";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { CheckCircle2, XCircle, Info, X } from "lucide-react";
import { cn } from "@/utils/cn";

type ToastKind = "success" | "error" | "info";
interface ToastItem { id: number; title: string; description?: string; kind: ToastKind }
const ToastContext = createContext<{ toast: (t: Omit<ToastItem, "id">) => void } | null>(null);

const ICONS = { success: CheckCircle2, error: XCircle, info: Info };
const COLORS = { success: "text-emerald-600", error: "text-rose-600", info: "text-indigo-600" };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const toast = useCallback((t: Omit<ToastItem, "id">) => {
    const id = Date.now();
    setItems((prev) => [...prev, { ...t, id }]);
    setTimeout(() => setItems((prev) => prev.filter((i) => i.id !== id)), 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      <ToastPrimitive.Provider swipeDirection="right">
        {children}
        {items.map((item) => {
          const Icon = ICONS[item.kind];
          return (
            <ToastPrimitive.Root
              key={item.id}
              className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-white p-3.5 shadow-lg data-[state=open]:animate-in data-[state=open]:slide-in-from-right"
              onOpenChange={(open) => !open && setItems((prev) => prev.filter((i) => i.id !== item.id))}
            >
              <Icon size={16} className={cn("mt-0.5 shrink-0", COLORS[item.kind])} />
              <div className="flex-1">
                <ToastPrimitive.Title className="text-xs font-medium text-slate-900">{item.title}</ToastPrimitive.Title>
                {item.description && <ToastPrimitive.Description className="mt-0.5 text-[11px] text-slate-500">{item.description}</ToastPrimitive.Description>}
              </div>
              <ToastPrimitive.Close className="text-slate-300 hover:text-slate-500"><X size={13} /></ToastPrimitive.Close>
            </ToastPrimitive.Root>
          );
        })}
        <ToastPrimitive.Viewport className="fixed bottom-4 right-4 z-[100] flex w-80 flex-col gap-2" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
