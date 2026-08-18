import type { ReactNode } from "react";
import { Inbox } from "lucide-react";

export function EmptyState({ title, message, action }: { title: string; message?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-900">
      <Inbox size={22} className="mb-2 text-slate-300" />
      <p className="text-sm font-medium text-slate-600 dark:text-slate-300">{title}</p>
      {message && <p className="mt-1 text-xs text-slate-400">{message}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
