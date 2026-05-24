import {
  INTEGRATIONS,
  AUTH_LABEL,
  DEPLOYMENT_LABEL,
  DIRECTION_LABEL,
  STATUS_LABEL,
  type IntegrationSpec,
} from "@/data/integrations";
import { BrandLogo, getBrandName } from "./logos";

// Productized companion to the integration constellation: the same source-of-
// truth list, but rendered as a table a buyer can actually compare against.
// Constellation = the hook ("we connect to all this"); matrix = the answer
// ("here's exactly how, and where the data lives").

export function IntegrationsMatrix() {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-background">
      {/* Mobile: card list. Tables collapse badly under 640px. */}
      <div className="md:hidden divide-y divide-border">
        {INTEGRATIONS.map((spec) => (
          <MobileRow key={spec.brand} spec={spec} />
        ))}
      </div>

      {/* Desktop: the real matrix. */}
      <table className="hidden md:table w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border bg-foreground/[0.02]">
            <Th>Integration</Th>
            <Th>Status</Th>
            <Th>Auth</Th>
            <Th>Where it runs</Th>
            <Th>Data direction</Th>
            <Th className="hidden lg:table-cell">Role · limits</Th>
          </tr>
        </thead>
        <tbody>
          {INTEGRATIONS.map((spec) => (
            <DesktopRow key={spec.brand} spec={spec} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DesktopRow({ spec }: { spec: IntegrationSpec }) {
  return (
    <tr className="border-b border-border last:border-b-0 hover:bg-foreground/[0.015] transition-colors">
      <Td>
        <div className="flex items-center gap-3">
          <BrandLogo brand={spec.brand} size={28} />
          <span className="font-medium tracking-tight">
            {getBrandName(spec.brand)}
          </span>
        </div>
      </Td>
      <Td>
        <StatusPill status={spec.status} />
      </Td>
      <Td>
        <span className="font-mono text-xs text-foreground/80">
          {AUTH_LABEL[spec.auth]}
        </span>
      </Td>
      <Td>
        <span className="text-foreground/80">
          {DEPLOYMENT_LABEL[spec.deployment]}
        </span>
      </Td>
      <Td>
        <span className="text-foreground/80">
          {DIRECTION_LABEL[spec.direction]}
        </span>
      </Td>
      <Td className="hidden lg:table-cell">
        <div className="text-foreground/80 leading-snug">{spec.role}</div>
        <div className="text-[11px] text-muted leading-snug mt-0.5">
          {spec.limits}
        </div>
      </Td>
    </tr>
  );
}

function MobileRow({ spec }: { spec: IntegrationSpec }) {
  return (
    <div className="p-4 space-y-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <BrandLogo brand={spec.brand} size={28} />
          <span className="font-medium text-sm tracking-tight">
            {getBrandName(spec.brand)}
          </span>
        </div>
        <StatusPill status={spec.status} />
      </div>
      <div className="text-xs text-muted leading-snug">{spec.role}</div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] pt-1">
        <MobileField label="Auth">{AUTH_LABEL[spec.auth]}</MobileField>
        <MobileField label="Where">{DEPLOYMENT_LABEL[spec.deployment]}</MobileField>
        <MobileField label="Direction">{DIRECTION_LABEL[spec.direction]}</MobileField>
        <MobileField label="Limits">{spec.limits}</MobileField>
      </div>
    </div>
  );
}

function MobileField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-0.5">
      <div className="text-[10px] uppercase tracking-wider text-muted font-mono">
        {label}
      </div>
      <div className="text-foreground/85 leading-snug">{children}</div>
    </div>
  );
}

function StatusPill({ status }: { status: IntegrationSpec["status"] }) {
  const cls =
    status === "live"
      ? "bg-severity-green/15 text-severity-green border-severity-green/30"
      : status === "beta"
        ? "bg-severity-action-bg text-severity-action border-severity-action/30"
        : "bg-foreground/[0.04] text-muted border-border";
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-mono uppercase tracking-wider ${cls}`}
    >
      <span
        aria-hidden
        className={`w-1.5 h-1.5 rounded-full ${
          status === "live"
            ? "bg-severity-green"
            : status === "beta"
              ? "bg-severity-action"
              : "bg-slate-400"
        }`}
      />
      {STATUS_LABEL[status]}
    </span>
  );
}

function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`px-4 py-3 text-[10px] uppercase tracking-wider text-muted font-mono font-normal ${className}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-4 py-3 align-top ${className}`}>{children}</td>;
}
