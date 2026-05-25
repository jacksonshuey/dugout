import { cn } from "@/lib/utils";
import type { DealHealth, SignalSeverity } from "@/lib/types";

// Hand-rolled UI primitives. Kept in one file because there are 5 of them and
// pulling in shadcn for this is overkill - and makes the codebase legible to
// someone reading it in an interview ("yeah, I wrote that").

export function Card({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-background shadow-[0_1px_2px_rgba(0,0,0,0.04)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Section({
  title,
  subtitle,
  children,
  rightSlot,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  rightSlot?: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          {subtitle && (
            <p className="text-sm text-muted mt-0.5">{subtitle}</p>
          )}
        </div>
        {rightSlot}
      </div>
      {children}
    </section>
  );
}

const SEVERITY_STYLES: Record<SignalSeverity, string> = {
  blocking:
    "bg-severity-blocking-bg text-severity-blocking border-severity-blocking/20",
  action:
    "bg-severity-action-bg text-severity-action border-severity-action/20",
  awareness:
    "bg-severity-awareness-bg text-severity-awareness border-severity-awareness/20",
};

const SEVERITY_LABELS: Record<SignalSeverity, string> = {
  blocking: "BLOCKING",
  action: "ACTION",
  awareness: "AWARENESS",
};

export function SeverityBadge({ severity }: { severity: SignalSeverity }) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold tracking-wider border",
        SEVERITY_STYLES[severity],
      )}
    >
      {SEVERITY_LABELS[severity]}
    </span>
  );
}

export function GreenBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold tracking-wider border bg-severity-green-bg text-severity-green border-severity-green/20">
      {children}
    </span>
  );
}

const HEALTH_STYLES: Record<DealHealth, string> = {
  Healthy:
    "bg-severity-green-bg text-severity-green border-severity-green/20",
  Monitor: "bg-slate-100 text-slate-700 border-slate-200",
  "At Risk":
    "bg-severity-action-bg text-severity-action border-severity-action/20",
  Critical:
    "bg-severity-blocking-bg text-severity-blocking border-severity-blocking/20",
};

export function HealthBadge({ health }: { health: DealHealth }) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold tracking-wider border",
        HEALTH_STYLES[health],
      )}
      title={`Deal Health: ${health}`}
    >
      {health.toUpperCase()}
    </span>
  );
}

export function StageBadge({ stage }: { stage: string }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-100 text-slate-700">
      {stage}
    </span>
  );
}

export function Button({
  children,
  variant = "primary",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 px-4 h-9 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
        variant === "primary" &&
          "bg-brand text-white hover:bg-brand-dark",
        variant === "secondary" &&
          "bg-slate-100 text-slate-900 hover:bg-slate-200",
        variant === "ghost" &&
          "text-muted hover:text-foreground hover:bg-black/[0.04]",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="space-y-0.5">
      <div className="text-xs uppercase tracking-wider text-muted font-medium">
        {label}
      </div>
      <div className="text-2xl font-semibold tracking-tight">{value}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  );
}
