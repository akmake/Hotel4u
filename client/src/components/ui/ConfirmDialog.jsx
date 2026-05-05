import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button.jsx";
import { AlertTriangle } from "lucide-react";

export function ConfirmDialog({ open, onOpenChange, title, description, confirmText = "אישור", cancelText = "ביטול", variant = "destructive", onConfirm }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-right">
            <AlertTriangle className="text-red-500 shrink-0" size={20} />
            {title}
          </DialogTitle>
          {description && <DialogDescription className="text-right">{description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>{cancelText}</Button>
          <Button
            variant={variant}
            onClick={() => { onConfirm(); onOpenChange(false); }}
          >
            {confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
