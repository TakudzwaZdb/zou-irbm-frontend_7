import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/Button";

export function ErrorState({ message = "Something went wrong while loading this data.", onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-rose-200 bg-rose-50 p-8 text-center">
      <AlertTriangle size={22} className="mb-2 text-rose-400" />
      <p className="text-sm font-medium text-rose-700">{message}</p>
      {onRetry && <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>Try again</Button>}
    </div>
  );
}
