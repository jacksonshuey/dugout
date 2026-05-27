"use client";

import { useEffect, useState } from "react";
import type {
  IntegrationSpec,
  SetupField,
} from "@/data/integration-specs/types";

// Per-source "Connect" popup. Renders the setup fields the user types
// into to bring an integration online: API keys, OAuth client IDs,
// webhook URLs. Lists the OAuth scopes Dugout will request, the webhook
// events Dugout will receive, the rate limit Dugout will respect, and
// the sync cadence the user can expect.
//
// Form submission is local-only (no backend write yet) - this is the
// shape of the real flow, instrumented with a fake success state for
// the demo. Real credential storage will go through Supabase Vault.

export function IntegrationConnectModal({
  spec,
  onClose,
  onConnected,
}: {
  spec: IntegrationSpec;
  onClose: () => void;
  // Fires when the user successfully submits the setup form (no
  // backend verification yet - it's the demo's "save" moment).
  // Parent table uses this to flip the row's status to Connected.
  onConnected?: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of spec.setupFields) init[f.key] = "";
    return init;
  });
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  function update(key: string, v: string) {
    setValues((prev) => ({ ...prev, [key]: v }));
  }

  function canSubmit(): boolean {
    return spec.setupFields.every(
      (f) => !f.required || (values[f.key] && values[f.key].trim().length > 0),
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit()) return;
    setSubmitted(true);
    onConnected?.();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Connect ${spec.source}`}
      className="fixed inset-0 z-50 flex items-start justify-center p-4 bg-foreground/50 backdrop-blur-sm overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="my-8 bg-background rounded-xl border border-border shadow-xl w-full max-w-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <ModalHeader spec={spec} onClose={onClose} />
        {submitted ? (
          <SuccessState spec={spec} />
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="px-5 py-4 space-y-5">
              <AuthBanner spec={spec} />
              <SetupFieldsSection
                spec={spec}
                values={values}
                onChange={update}
              />
              {spec.requiredScopes.length > 0 && (
                <ScopesSection spec={spec} />
              )}
              {spec.webhooks.length > 0 && <WebhooksSection spec={spec} />}
              <OperationalSection spec={spec} />
              {spec.keyGotchas.length > 0 && <GotchasSection spec={spec} />}
            </div>
            <ModalFooter spec={spec} canSubmit={canSubmit()} onCancel={onClose} />
          </form>
        )}
      </div>
    </div>
  );
}

function ModalHeader({
  spec,
  onClose,
}: {
  spec: IntegrationSpec;
  onClose: () => void;
}) {
  return (
    <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
      <div className="flex items-start gap-3 min-w-0">
        <SourceMark source={spec.source} />
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.2em] font-mono text-muted">
            Connect integration
          </div>
          <h3 className="text-base font-semibold tracking-tight mt-0.5 truncate">
            {spec.source}
          </h3>
          <p className="text-xs text-muted mt-0.5 leading-snug">
            {spec.tagline}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="shrink-0 rounded-md border border-border w-7 h-7 inline-flex items-center justify-center hover:border-brand hover:text-brand transition-colors"
      >
        <svg
          aria-hidden
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          className="w-4 h-4"
        >
          <path d="M4 4 L12 12" />
          <path d="M12 4 L4 12" />
        </svg>
      </button>
    </header>
  );
}

function SourceMark({ source }: { source: string }) {
  // Single-letter fallback mark. The real BrandLogo lives in
  // landing/logos.tsx but only knows the customer-facing brand keys; some
  // catalog sources (SEC EDGAR, NewsAPI) won't have one. Letter mark works
  // for everyone.
  const letter = source.charAt(0).toUpperCase();
  return (
    <span
      aria-hidden
      className="shrink-0 w-9 h-9 rounded-md border border-border bg-foreground/[0.04] inline-flex items-center justify-center font-semibold text-sm"
    >
      {letter}
    </span>
  );
}

function AuthBanner({ spec }: { spec: IntegrationSpec }) {
  const labels: Record<string, string> = {
    oauth2: "OAuth 2.0",
    api_key: "API Key",
    personal_access_token: "Personal Access Token",
    jwt: "JWT (server-to-server)",
    none: "No authentication (public API)",
  };
  return (
    <div className="space-y-2">
      <DirectionPill spec={spec} />
      <div className="rounded-md border border-border bg-foreground/[0.02] px-3 py-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-[0.15em] font-mono text-muted">
            Auth
          </span>
          <span className="font-semibold">{labels[spec.auth.method]}</span>
          <a
            href={spec.auth.docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto text-brand hover:underline"
          >
            docs ↗
          </a>
        </div>
        {spec.auth.notes && (
          <p className="text-muted mt-1 leading-snug">{spec.auth.notes}</p>
        )}
      </div>
    </div>
  );
}

function DirectionPill({ spec }: { spec: IntegrationSpec }) {
  if (spec.direction === "read") {
    return (
      <div className="rounded-md border border-severity-action/40 bg-severity-action-bg text-severity-action px-3 py-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.15em]">
            Read-only
          </span>
          <span className="text-foreground/80">
            Dugout pulls from {spec.source}. Never writes back.
          </span>
        </div>
      </div>
    );
  }
  if (spec.direction === "write") {
    return (
      <div className="rounded-md border border-brand/40 bg-brand/[0.06] text-brand px-3 py-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.15em]">
            Outbound only
          </span>
          <span className="text-foreground/80">
            Dugout posts to {spec.source}. Nothing flows back into the
            ontology.
          </span>
        </div>
        {spec.writes && (
          <p className="text-muted mt-1 leading-snug">{spec.writes}</p>
        )}
      </div>
    );
  }
  // both
  return (
    <div className="rounded-md border border-severity-awareness/40 bg-severity-awareness-bg text-severity-awareness px-3 py-2 text-xs">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.15em]">
          Read + write
        </span>
        <span className="text-foreground/80">
          Dugout reads from and writes to {spec.source}.
        </span>
      </div>
      {spec.writes && (
        <p className="text-muted mt-1 leading-snug">{spec.writes}</p>
      )}
    </div>
  );
}

function SetupFieldsSection({
  spec,
  values,
  onChange,
}: {
  spec: IntegrationSpec;
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  return (
    <div>
      <SectionLabel>Setup</SectionLabel>
      <div className="space-y-3 mt-2">
        {spec.setupFields.map((f) => (
          <FieldInput
            key={f.key}
            field={f}
            value={values[f.key] ?? ""}
            onChange={(v) => onChange(f.key, v)}
          />
        ))}
      </div>
    </div>
  );
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: SetupField;
  value: string;
  onChange: (v: string) => void;
}) {
  const inputType =
    field.type === "password" || field.secret ? "password" : field.type;
  return (
    <label className="block">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-semibold">
          {field.label}
          {field.required && <span className="text-brand ml-1">*</span>}
        </span>
        {field.secret && (
          <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-muted">
            stored in vault
          </span>
        )}
      </div>
      {field.type === "select" && field.options ? (
        <select
          required={field.required}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
        >
          <option value="">Choose…</option>
          {field.options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={inputType}
          required={field.required}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          autoComplete={field.secret ? "off" : undefined}
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
        />
      )}
      <p className="text-[11px] text-muted mt-1 leading-snug">
        {field.description}
      </p>
    </label>
  );
}

function ScopesSection({ spec }: { spec: IntegrationSpec }) {
  return (
    <div>
      <SectionLabel>Scopes Dugout will request</SectionLabel>
      <ul className="mt-2 space-y-1">
        {spec.requiredScopes.map((s) => (
          <li
            key={s}
            className="flex items-baseline gap-2 text-[11px] font-mono"
          >
            <span className="text-brand">●</span>
            <span>{s}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function WebhooksSection({ spec }: { spec: IntegrationSpec }) {
  return (
    <div>
      <SectionLabel>Webhook events Dugout receives</SectionLabel>
      <ul className="mt-2 grid sm:grid-cols-2 gap-1.5">
        {spec.webhooks.map((w) => (
          <li
            key={w.event}
            className="text-[11px] leading-snug"
            title={w.description}
          >
            <span className="font-mono font-semibold">{w.event}</span>
            <span className="text-muted"> — {w.description}</span>
          </li>
        ))}
      </ul>
      {spec.webhookSigning !== "n/a" && (
        <p className="text-[11px] text-muted mt-2 leading-snug">
          Signing: {spec.webhookSigning}
        </p>
      )}
    </div>
  );
}

function OperationalSection({ spec }: { spec: IntegrationSpec }) {
  const syncLabels: Record<string, string> = {
    realtime: "Real-time",
    webhooks: "Webhooks (event-driven)",
    hourly_poll: "Hourly poll",
    daily_sync: "Daily sync",
    bulk_export: "Bulk export",
    on_demand: "On-demand",
  };
  return (
    <div className="grid grid-cols-3 gap-2 text-[11px]">
      <OpCard label="Sync" value={syncLabels[spec.syncModel] ?? spec.syncModel} />
      <OpCard label="Freshness" value={spec.dataFreshness} />
      <OpCard label="Rate limit" value={spec.rateLimit} />
    </div>
  );
}

function OpCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-foreground/[0.02] px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-[0.15em] font-mono text-muted">
        {label}
      </div>
      <div className="font-medium mt-0.5 leading-tight">{value}</div>
    </div>
  );
}

function GotchasSection({ spec }: { spec: IntegrationSpec }) {
  return (
    <div>
      <SectionLabel>Before you connect</SectionLabel>
      <ul className="mt-2 space-y-1">
        {spec.keyGotchas.map((g, i) => (
          <li
            key={i}
            className="text-[11px] text-muted leading-snug flex items-baseline gap-2"
          >
            <span className="text-brand shrink-0">·</span>
            <span>{g}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] uppercase tracking-[0.2em] font-mono text-muted">
      {children}
    </div>
  );
}

function ModalFooter({
  spec,
  canSubmit,
  onCancel,
}: {
  spec: IntegrationSpec;
  canSubmit: boolean;
  onCancel: () => void;
}) {
  const buttonLabel =
    spec.auth.method === "oauth2"
      ? `Authorize with ${spec.source}`
      : spec.auth.method === "none"
        ? "Connect"
        : "Verify & save";
  return (
    <footer className="flex items-center justify-between gap-3 border-t border-border bg-foreground/[0.02] px-5 py-3">
      <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-muted">
        {spec.headlessSetup
          ? "Self-serve setup"
          : "Requires admin console step"}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="text-sm px-3 py-1.5 rounded-md border border-border hover:border-foreground/40 transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!canSubmit}
          className="text-sm px-3 py-1.5 rounded-md bg-brand text-white font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-brand/90 transition-colors"
        >
          {buttonLabel}
        </button>
      </div>
    </footer>
  );
}

function SuccessState({ spec }: { spec: IntegrationSpec }) {
  return (
    <div className="px-5 py-6 text-center">
      <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-severity-action-bg text-severity-action mb-3">
        <svg
          aria-hidden
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-5 h-5"
        >
          <path d="M3 8 L7 12 L13 4" />
        </svg>
      </div>
      <h4 className="font-semibold tracking-tight">
        {spec.source} connected
      </h4>
      <p className="text-xs text-muted mt-1 max-w-sm mx-auto leading-snug">
        Verified. Initial sync starts now. Data will start landing in the
        canonical objects within {spec.dataFreshness}.
      </p>
    </div>
  );
}
