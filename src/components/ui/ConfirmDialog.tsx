import { Dialog, DialogContent } from "./Dialog";
import { Button } from "./Button";

export function ConfirmDialog({
  open, onOpenChange, title, description, confirmLabel = "Confirm", destructive, onConfirm,
}: {
  open: boolean; onOpenChange: (v: boolean) => void; title: string; description: string;
  confirmLabel?: string; destructive?: boolean; onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title}>
        <p className="text-sm text-slate-600 dark:text-slate-300">{description}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            onClick={() => { onConfirm(); onOpenChange(false); }}
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
