"use client";

import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { Button } from "./button";

export type ToastVariant = "success" | "error" | "info";

interface ToastRecord {
  id: number;
  message: string;
  variant: ToastVariant;
}

interface ToastValue {
  /** Show a toast. Defaults to the success variant for source compatibility. */
  notify(message: string, variant?: ToastVariant): void;
}

const ToastContext = createContext<ToastValue | null>(null);

const AUTO_DISMISS_MS: Record<ToastVariant, number> = {
  success: 4500,
  info: 6000,
  // Failures stay long enough to read and act on.
  error: 9000,
};

const VARIANT_ICON = {
  success: CheckCircle2,
  error: AlertTriangle,
  info: Info,
} as const;

const MAX_VISIBLE = 3;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback(
    (message: string, variant: ToastVariant = "success") => {
      const id = nextId.current++;
      // A queue, not a slot: a second notify no longer erases the first.
      setToasts((current) => [...current, { id, message, variant }].slice(-MAX_VISIBLE));
      timers.current.set(
        id,
        window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS[variant]),
      );
    },
    [dismiss],
  );

  // Clear pending timers on unmount so no state update lands after teardown.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) window.clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const value = useMemo(() => ({ notify }), [notify]);

  const polite = toasts.filter((toast) => toast.variant !== "error");
  const assertive = toasts.filter((toast) => toast.variant === "error");

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-region">
        {/* Severity-matched politeness: failures interrupt, confirmations do not. */}
        <div aria-live="polite" className="toast-region__group">
          {polite.map((toast) => (
            <ToastCard key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
          ))}
        </div>
        <div aria-live="assertive" className="toast-region__group">
          {assertive.map((toast) => (
            <ToastCard key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
          ))}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ toast, onDismiss }: { toast: ToastRecord; onDismiss: () => void }) {
  const Icon = VARIANT_ICON[toast.variant];
  return (
    <div className={`toast toast--${toast.variant}`}>
      {/* Icon plus text: status is never carried by colour alone. */}
      <Icon aria-hidden="true" size={16} />
      <span>{toast.message}</span>
      <Button variant="ghost" size="icon" onClick={onDismiss} aria-label="Dismiss notification">
        <X aria-hidden="true" size={14} />
      </Button>
    </div>
  );
}

export function useToast() {
  const value = useContext(ToastContext);
  if (!value) throw new Error("useToast must be used within ToastProvider.");
  return value;
}
