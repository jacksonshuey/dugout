"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { Task } from "@/lib/tasks";
import { SeverityBadge } from "./ui";
import { playbooks } from "@/data/playbooks";
import { PlaybookView } from "./playbook-view";

const STATUS_STYLES = {
  open: "",
  done: "opacity-60",
  snoozed: "opacity-70",
  muted: "opacity-50",
};

export function TaskCard({
  task,
  dealName,
  isOwner,
  viewerName = "you",
  compact = false,
  onMarkDone,
  onSnooze,
  onMute,
  onReopen,
  onAddNote,
  onAddCoachingNote,
}: {
  task: Task;
  dealName?: string; // shown when this card is rendered outside a deal context (Today view)
  isOwner: boolean; // viewer is the deal owner — controls which actions show
  viewerName?: string;
  compact?: boolean;
  onMarkDone: () => void;
  onSnooze: (hours: number) => void;
  onMute: (reason: string) => void;
  onReopen: () => void;
  onAddNote: (text: string) => void;
  onAddCoachingNote: (text: string) => void;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const [showPlaybook, setShowPlaybook] = useState(false);
  const [muteOpen, setMuteOpen] = useState(false);
  const [muteText, setMuteText] = useState("");
  const [workNote, setWorkNote] = useState("");
  const [coachNote, setCoachNote] = useState("");

  const playbook = task.playbookId ? playbooks[task.playbookId] : null;
  const isClosed = task.status !== "open";

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-background p-4 space-y-3",
        STATUS_STYLES[task.status],
      )}
    >
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="pt-0.5 shrink-0">
          <SeverityBadge severity={task.severity} />
        </div>
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn("text-sm font-medium", task.status === "done" && "line-through")}>
              {task.title}
            </span>
            {task.status !== "open" && <StatusChip status={task.status} />}
            {dealName && (
              <span className="text-xs text-muted">· {dealName}</span>
            )}
          </div>
          {!compact && (
            <p className="text-sm text-muted leading-relaxed">{task.body}</p>
          )}
          {!compact && (
            <p className="text-sm">
              <span className="text-muted">Action: </span>
              <span>{task.suggestedAction}</span>
              {task.assetLink && (
                <span className="ml-2 text-brand font-medium">
                  → {task.assetLink}
                </span>
              )}
            </p>
          )}
        </div>
      </div>

      {/* Mute reason banner */}
      {task.status === "muted" && task.muteReason && (
        <div className="text-xs text-muted bg-slate-100 rounded px-2 py-1">
          Muted: {task.muteReason}
        </div>
      )}

      {/* Snooze reminder */}
      {task.status === "snoozed" && task.snoozedUntil && (
        <div className="text-xs text-muted bg-slate-100 rounded px-2 py-1">
          Snoozed until {new Date(task.snoozedUntil).toLocaleString()}
        </div>
      )}

      {/* Notes */}
      {task.notes.length > 0 && (
        <div className="space-y-1 pt-1">
          {task.notes.map((n, i) => (
            <div
              key={i}
              className={cn(
                "text-xs rounded px-2 py-1.5 border",
                n.kind === "coaching"
                  ? "bg-brand/5 border-brand/20 text-foreground"
                  : "bg-slate-50 border-border text-muted",
              )}
            >
              <div className="font-medium text-foreground/80">
                {n.kind === "coaching" ? "Coaching" : "Note"}
                <span className="font-normal text-muted ml-1">
                  · {new Date(n.at).toLocaleString()}
                </span>
              </div>
              <div className="mt-0.5">{n.text}</div>
            </div>
          ))}
        </div>
      )}

      {/* Action panel */}
      {!isClosed && (
        <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-border">
          <ActionBtn primary onClick={onMarkDone}>
            ✓ Done
          </ActionBtn>
          <ActionBtn onClick={() => onSnooze(24)}>Snooze 24h</ActionBtn>
          <ActionBtn onClick={() => setMuteOpen((v) => !v)}>Mute…</ActionBtn>
          {playbook && (
            <ActionBtn onClick={() => setShowPlaybook((v) => !v)}>
              {showPlaybook ? "Hide playbook" : "Playbook"}
            </ActionBtn>
          )}
          <button
            onClick={() => setShowHistory((v) => !v)}
            className="text-[11px] text-muted hover:text-foreground ml-auto"
          >
            {showHistory ? "Hide history" : `History (${task.history.length})`}
          </button>
        </div>
      )}

      {isClosed && (
        <div className="flex items-center gap-2 pt-1 border-t border-border">
          <ActionBtn onClick={onReopen}>Reopen</ActionBtn>
          <button
            onClick={() => setShowHistory((v) => !v)}
            className="text-[11px] text-muted hover:text-foreground ml-auto"
          >
            {showHistory ? "Hide history" : `History (${task.history.length})`}
          </button>
        </div>
      )}

      {/* Mute dialog */}
      {muteOpen && (
        <div className="space-y-2 pt-1">
          <textarea
            value={muteText}
            onChange={(e) => setMuteText(e.target.value)}
            placeholder="Why are you muting this? (required — shows up in noise audits)"
            rows={2}
            className="w-full text-sm rounded border border-border px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
          />
          <div className="flex gap-2">
            <ActionBtn
              primary
              onClick={() => {
                if (muteText.trim()) {
                  onMute(muteText.trim());
                  setMuteOpen(false);
                  setMuteText("");
                }
              }}
            >
              Confirm mute
            </ActionBtn>
            <ActionBtn onClick={() => setMuteOpen(false)}>Cancel</ActionBtn>
          </div>
        </div>
      )}

      {/* Add note / coaching note inputs */}
      {!isClosed && (
        <div className="grid sm:grid-cols-2 gap-2 pt-1">
          <NoteInput
            value={workNote}
            onChange={setWorkNote}
            placeholder={isOwner ? "Add a work note…" : "Add a note…"}
            onSubmit={() => {
              if (workNote.trim()) {
                onAddNote(workNote.trim());
                setWorkNote("");
              }
            }}
          />
          {!isOwner && (
            <NoteInput
              value={coachNote}
              onChange={setCoachNote}
              placeholder="Add a coaching note (visible to AE)…"
              onSubmit={() => {
                if (coachNote.trim()) {
                  onAddCoachingNote(coachNote.trim());
                  setCoachNote("");
                }
              }}
              accent
            />
          )}
        </div>
      )}

      {/* Playbook expander */}
      {showPlaybook && playbook && <PlaybookView playbook={playbook} />}

      {/* History */}
      {showHistory && (
        <div className="text-[11px] space-y-1 pt-2 border-t border-border">
          {task.history
            .slice()
            .reverse()
            .map((h, i) => (
              <div key={i} className="flex gap-2 text-muted">
                <span className="font-mono shrink-0">
                  {new Date(h.at).toLocaleString()}
                </span>
                <span>·</span>
                <span>
                  <span className="text-foreground">{h.by ?? viewerName}</span>{" "}
                  {h.action}
                  {h.detail && (
                    <span className="text-foreground/60"> — {h.detail}</span>
                  )}
                </span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

function ActionBtn({
  primary,
  onClick,
  children,
}: {
  primary?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "text-[11px] font-medium px-2 py-1 rounded transition-colors",
        primary
          ? "bg-foreground text-background hover:bg-foreground/85"
          : "border border-border bg-background hover:bg-slate-50 text-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function StatusChip({ status }: { status: Task["status"] }) {
  const label =
    status === "done" ? "DONE" : status === "snoozed" ? "SNOOZED" : "MUTED";
  return (
    <span className="text-[10px] font-semibold tracking-wider px-1.5 py-0.5 rounded bg-slate-100 text-muted">
      {label}
    </span>
  );
}

function NoteInput({
  value,
  onChange,
  placeholder,
  onSubmit,
  accent,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  onSubmit: () => void;
  accent?: boolean;
}) {
  return (
    <div className="flex gap-1">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onSubmit()}
        placeholder={placeholder}
        className={cn(
          "flex-1 text-xs rounded border px-2 h-7 focus:outline-none focus:ring-2",
          accent
            ? "border-brand/30 focus:ring-brand/30 focus:border-brand"
            : "border-border focus:ring-brand/30 focus:border-brand",
        )}
      />
      <button
        onClick={onSubmit}
        disabled={!value.trim()}
        className={cn(
          "text-[11px] px-2 rounded disabled:opacity-40",
          accent
            ? "bg-brand text-white hover:bg-brand-dark"
            : "border border-border hover:bg-slate-50",
        )}
      >
        Add
      </button>
    </div>
  );
}
