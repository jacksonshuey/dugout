"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

// Minimal toast — used to surface auto-resolutions (and could host other
// transient confirmations later). Fixed bottom-right, auto-dismisses.

export interface Toast {
  id: string;
  message: string;
  detail?: string;
  tone?: "success" | "info" | "warn";
  durationMs?: number;
}

const TONE_STYLES: Record<NonNullable<Toast["tone"]>, string> = {
  success: "border-severity-green/30 bg-severity-green-bg text-severity-green",
  info: "border-border bg-background text-foreground",
  warn:
    "border-severity-action/30 bg-severity-action-bg text-severity-action",
};

export function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}) {
  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2 max-w-sm w-full pointer-events-none">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: (id: string) => void;
}) {
  useEffect(() => {
    const id = setTimeout(() => onDismiss(toast.id), toast.durationMs ?? 5000);
    return () => clearTimeout(id);
  }, [toast.id, toast.durationMs, onDismiss]);

  return (
    <div
      className={cn(
        "rounded-lg border px-4 py-3 shadow-md text-sm pointer-events-auto cursor-pointer",
        TONE_STYLES[toast.tone ?? "info"],
      )}
      onClick={() => onDismiss(toast.id)}
      role="status"
    >
      <div className="font-medium">{toast.message}</div>
      {toast.detail && (
        <div className="text-xs opacity-80 mt-0.5">{toast.detail}</div>
      )}
    </div>
  );
}

// Convenience hook for managing the toast queue locally.
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  function push(toast: Omit<Toast, "id">) {
    const id = `t_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev, { ...toast, id }]);
  }

  function dismiss(id: string) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  return { toasts, push, dismiss };
}
