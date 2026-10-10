"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  CaretDown,
  CaretRight,
  CheckCircle,
  CircleNotch,
  FileCode,
  Hourglass,
  PaperPlaneTilt,
  Robot,
  ShieldCheck,
  Stop,
  Terminal,
  Timer,
  WarningCircle,
  Wrench,
  X,
  XCircle,
} from "@phosphor-icons/react";
import { assistantApi } from "@/lib/api/services";
import type { MCPTask, MCPTaskStatus, MCPTaskStep } from "@/lib/api/types";
import { qk, useAssistantTask, useAssistantTasks, useAssistantTools } from "@/lib/hooks/queries";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/overlays";
import { Badge, Card, StatusDot, type Tone } from "@/components/ui/primitives";

const STATUS_META: Record<MCPTaskStatus, { label: string; tone: Tone; icon: React.ElementType }> = {
  pending: { label: "Pending", tone: "faint", icon: Hourglass },
  running: { label: "Reasoning & Executing", tone: "sky", icon: CircleNotch },
  waiting_approval: { label: "Awaiting Your Approval", tone: "sun", icon: WarningCircle },
  completed: { label: "Completed", tone: "mint", icon: CheckCircle },
  failed: { label: "Failed", tone: "coral", icon: XCircle },
  cancelled: { label: "Cancelled", tone: "faint", icon: Stop },
};

const QUICK_PROMPTS = [
  { label: "Paper claims & methodology", prompt: "Retrieve the paper claims, methodology, and citations, and compare them with our workspace setup." },
  { label: "Run static checks & tests", prompt: "Run static checks and execute the tests in the sandbox to verify code integrity." },
  { label: "Self-heal last error", prompt: "Inspect the latest execution error, propose a minimal patch, and test the fix in a fresh sandbox." },
  { label: "Compare experiment metrics", prompt: "Compare our measured experiment metrics against the baseline paper claims and identify gaps." },
  { label: "Validate & publish to Hugging Face", prompt: "Validate model artifacts, generate a comprehensive model card, and prepare Hugging Face publishing." },
];

export function AssistantPanel({
  runId,
  className,
  onClose,
}: {
  runId: string;
  className?: string;
  onClose?: () => void;
}) {
  const qc = useQueryClient();
  const [prompt, setPrompt] = React.useState("");
  const [provider, setProvider] = React.useState<"claude" | "arina">("claude");
  const [selectedTaskId, setSelectedTaskId] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [approving, setApproving] = React.useState(false);
  const [cancelling, setCancelling] = React.useState(false);
  const [showToolsDrawer, setShowToolsDrawer] = React.useState(false);

  const toolsQ = useAssistantTools();
  const tasksQ = useAssistantTasks(runId);

  // Auto-select latest task if none is manually selected
  const activeTask = React.useMemo(() => {
    const list = tasksQ.data ?? [];
    if (!list.length) return null;
    if (selectedTaskId) {
      return list.find((t) => t.id === selectedTaskId) ?? list[0];
    }
    // Prefer any running/waiting task, otherwise latest
    const pending = list.find((t) => t.status === "running" || t.status === "waiting_approval");
    return pending ?? list[0];
  }, [tasksQ.data, selectedTaskId]);

  const taskDetailQ = useAssistantTask(activeTask?.id ?? null);
  const currentTask: MCPTask | null = taskDetailQ.data ?? activeTask ?? null;

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const text = prompt.trim();
    if (!text || submitting) return;

    setSubmitting(true);
    try {
      const task = await assistantApi.createTask(runId, text, provider);
      setPrompt("");
      setSelectedTaskId(task.id);
      await qc.invalidateQueries({ queryKey: qk.assistantTasks(runId) });
      toast.success("AI Assistant task started", `Orchestrating tools with ${provider === "claude" ? "Claude 3.5 Sonnet" : "Arina AI"}...`);
    } catch (err: unknown) {
      toast.error("Failed to start assistant task", err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleApprove = async (approved: boolean) => {
    if (!currentTask || approving) return;
    setApproving(true);
    try {
      await assistantApi.approveTask(currentTask.id, approved, approved ? "Approved by user" : "Rejected by user");
      await Promise.all([
        qc.invalidateQueries({ queryKey: qk.assistantTask(currentTask.id) }),
        qc.invalidateQueries({ queryKey: qk.assistantTasks(runId) }),
      ]);
      toast.success(approved ? "Tool approved and resuming execution" : "Tool rejected");
    } catch (err: unknown) {
      toast.error("Approval error", err instanceof Error ? err.message : String(err));
    } finally {
      setApproving(false);
    }
  };

  const handleCancel = async () => {
    if (!currentTask || cancelling) return;
    setCancelling(true);
    try {
      await assistantApi.cancelTask(currentTask.id);
      await Promise.all([
        qc.invalidateQueries({ queryKey: qk.assistantTask(currentTask.id) }),
        qc.invalidateQueries({ queryKey: qk.assistantTasks(runId) }),
      ]);
      toast.success("Task cancelled");
    } catch (err: unknown) {
      toast.error("Cancel error", err instanceof Error ? err.message : String(err));
    } finally {
      setCancelling(false);
    }
  };

  const isLive = currentTask?.status === "running" || currentTask?.status === "pending";

  return (
    <div className={cn("flex flex-col rounded-3xl border border-line-cool bg-white shadow-soft overflow-hidden", className)}>
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between border-b border-line px-5 py-3.5 bg-lavender-soft/30">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-purple text-white shadow-sm">
            <Robot size={18} weight="bold" />
          </div>
          <div>
            <h3 className="font-display text-base font-semibold text-ink flex items-center gap-2">
              Autonomous MCP Research Assistant
              <Badge tone="purple" solid className="text-[10px] uppercase tracking-wider">
                MCP SDK
              </Badge>
            </h3>
            <p className="text-xs text-muted">
              Official MCP tools for papers, code, sandbox, debugger, metrics, and publishing
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Provider selector */}
          <div className="flex items-center rounded-full bg-white p-0.5 border border-line text-xs font-medium">
            <button
              type="button"
              onClick={() => setProvider("claude")}
              className={cn(
                "rounded-full px-2.5 py-1 transition-all",
                provider === "claude" ? "bg-purple text-white shadow-xs font-semibold" : "text-ink-soft hover:text-ink"
              )}
            >
              Claude 3.5 Sonnet
            </button>
            <button
              type="button"
              onClick={() => setProvider("arina")}
              className={cn(
                "rounded-full px-2.5 py-1 transition-all",
                provider === "arina" ? "bg-purple text-white shadow-xs font-semibold" : "text-ink-soft hover:text-ink"
              )}
            >
              Arina AI (gpt-5-mini)
            </button>
          </div>

          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowToolsDrawer(!showToolsDrawer)}
            className="text-xs gap-1.5"
            aria-label="Toggle registered MCP tools list"
          >
            <Wrench size={14} />
            Tools ({toolsQ.data?.length ?? 0})
          </Button>

          {onClose && (
            <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Close assistant">
              <X size={16} />
            </Button>
          )}
        </div>
      </div>

      {/* Tools Drawer (collapsible) */}
      {showToolsDrawer && (
        <div className="border-b border-line bg-surface-cool/60 px-5 py-3">
          <div className="flex items-center justify-between pb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted">
              Registered Model Context Protocol Tools
            </span>
            <span className="text-[11px] text-muted">Transport: Streamable HTTP (/mcp)</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2 max-h-48 overflow-y-auto pr-1">
            {toolsQ.data?.map((tool) => (
              <div key={tool.name} className="rounded-xl border border-line bg-white p-2 text-xs shadow-xs">
                <div className="flex items-center justify-between gap-1 mb-0.5">
                  <code className="font-semibold text-purple-deep truncate">{tool.name}</code>
                  <Badge tone="lavender" className="text-[9px] uppercase px-1 py-0">{tool.group}</Badge>
                </div>
                <p className="line-clamp-2 text-[11px] text-muted">{tool.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main Body */}
      <div className="grid grid-cols-1 lg:grid-cols-12 flex-1 min-h-[480px]">
        {/* Left: Task History sidebar (lg: 3 cols) */}
        <div className="lg:col-span-3 border-r border-line bg-surface-cool/30 p-3 flex flex-col gap-2 max-h-[620px] overflow-y-auto">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-semibold text-muted uppercase tracking-wider">Task History</span>
            <Badge tone="faint" className="text-[10px]">{tasksQ.data?.length ?? 0}</Badge>
          </div>

          {!tasksQ.data?.length ? (
            <div className="py-8 text-center text-xs text-muted">
              No tasks yet. Ask a question or submit a prompt below.
            </div>
          ) : (
            tasksQ.data.map((task) => {
              const meta = STATUS_META[task.status];
              const Icon = meta.icon;
              const isSelected = currentTask?.id === task.id;
              return (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => setSelectedTaskId(task.id)}
                  className={cn(
                    "text-left rounded-2xl p-2.5 transition-all border text-xs flex flex-col gap-1.5",
                    isSelected
                      ? "border-purple bg-lavender-soft/40 shadow-xs"
                      : "border-transparent bg-white hover:border-line hover:bg-surface-cool"
                  )}
                >
                  <div className="flex items-center justify-between gap-1.5">
                    <Badge tone={meta.tone} className="text-[10px] py-0.5 px-2">
                      <Icon size={11} className={task.status === "running" ? "animate-spin" : ""} />
                      {meta.label}
                    </Badge>
                    <span className="text-[10px] text-muted">
                      {new Date(task.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                  <p className="line-clamp-2 font-medium text-ink leading-snug">{task.prompt}</p>
                  <div className="flex items-center gap-2 text-[10px] text-muted">
                    <span>{task.steps?.length ?? task.current_step} steps</span>
                    <span>·</span>
                    <span>{task.id.slice(0, 8)}</span>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Right: Active Task Details & Interactive Execution Stream (lg: 9 cols) */}
        <div className="lg:col-span-9 flex flex-col justify-between max-h-[620px] overflow-hidden">
          {/* Scrollable details view */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {currentTask ? (
              <div className="space-y-4">
                {/* Task Header Card */}
                <div className="rounded-2xl border border-line bg-surface-cool/40 p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge tone={STATUS_META[currentTask.status].tone} solid className="text-xs px-2.5 py-1">
                        {currentTask.status === "running" && <StatusDot tone="sky" pulse />}
                        {STATUS_META[currentTask.status].label}
                      </Badge>
                      <span className="text-xs text-muted">
                        Step {currentTask.current_step} of {currentTask.max_steps} max
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {isLive && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={handleCancel}
                          disabled={cancelling}
                          className="text-xs gap-1 text-coral hover:text-coral-deep"
                        >
                          <Stop size={13} weight="bold" />
                          Cancel
                        </Button>
                      )}
                    </div>
                  </div>

                  <div>
                    <h4 className="text-sm font-semibold text-ink leading-relaxed">
                      {currentTask.prompt}
                    </h4>
                  </div>
                </div>

                {/* Sensitive Action Approval Required Card */}
                {currentTask.status === "waiting_approval" && currentTask.pending_approval && (
                  <Card variant="bento" className="border-2 border-sun p-4 bg-sun-soft/30 space-y-3">
                    <div className="flex items-center gap-2 text-sun-deep font-semibold text-sm">
                      <WarningCircle size={20} weight="fill" className="text-sun" />
                      <span>Security Gate: Human Confirmation Required</span>
                    </div>

                    <p className="text-xs text-ink leading-relaxed">
                      {currentTask.pending_approval.prompt}
                    </p>

                    <div className="rounded-xl bg-white border border-line p-2.5 text-xs font-mono space-y-1">
                      <div className="text-muted font-bold">Tool to execute:</div>
                      <div className="text-purple-deep font-semibold">{currentTask.pending_approval.tool_name}</div>
                      <div className="text-muted font-bold mt-1">Arguments:</div>
                      <pre className="text-[11px] overflow-x-auto text-ink-soft bg-surface-cool p-2 rounded-lg">
                        {JSON.stringify(currentTask.pending_approval.arguments, null, 2)}
                      </pre>
                    </div>

                    <div className="flex items-center gap-3 pt-1">
                      <Button
                        size="sm"
                        variant="purple"
                        onClick={() => handleApprove(true)}
                        disabled={approving}
                        className="gap-1.5"
                      >
                        <ShieldCheck size={16} weight="bold" />
                        Approve & Execute Action
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleApprove(false)}
                        disabled={approving}
                        className="gap-1.5 text-coral hover:bg-coral-soft/20"
                      >
                        <XCircle size={16} weight="bold" />
                        Reject & Abort
                      </Button>
                    </div>
                  </Card>
                )}

                {/* Steps Timeline */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                      Execution Steps ({currentTask.steps?.length ?? 0})
                    </span>
                    {isLive && (
                      <span className="flex items-center gap-1.5 text-xs font-semibold text-purple-deep">
                        <CircleNotch size={14} className="animate-spin text-purple" />
                        Tool executing...
                      </span>
                    )}
                  </div>

                  {!currentTask.steps?.length ? (
                    <div className="rounded-2xl border border-dashed border-line p-6 text-center text-xs text-muted">
                      Initializing multi-step reasoning plan...
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {currentTask.steps.map((step, idx) => (
                        <StepCard key={step.id || idx} step={step} isLatest={idx === (currentTask.steps?.length ?? 0) - 1} />
                      ))}
                    </div>
                  )}
                </div>

                {/* Final Result / Outcome */}
                {currentTask.status === "completed" && currentTask.result && (
                  <Card variant="bento" className="p-4 border-mint bg-mint-soft/30 space-y-2">
                    <div className="flex items-center gap-2 text-mint-deep font-semibold text-sm">
                      <CheckCircle size={18} weight="fill" />
                      <span>Task Completed Successfully</span>
                    </div>
                    <div className="text-xs text-ink whitespace-pre-wrap leading-relaxed">
                      {currentTask.result}
                    </div>
                  </Card>
                )}

                {/* Error Banner */}
                {currentTask.status === "failed" && currentTask.error && (
                  <Card variant="bento" className="p-4 border-coral bg-coral-soft/30 space-y-2">
                    <div className="flex items-center gap-2 text-coral-deep font-semibold text-sm">
                      <XCircle size={18} weight="fill" />
                      <span>Execution Error</span>
                    </div>
                    <p className="text-xs font-mono text-coral-deep leading-relaxed">
                      {currentTask.error}
                    </p>
                  </Card>
                )}
              </div>
            ) : (
              <div className="py-16 text-center space-y-3">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-lavender-soft text-purple">
                  <Robot size={28} />
                </div>
                <div>
                  <h4 className="text-base font-semibold text-ink">AI Research Copilot</h4>
                  <p className="text-xs text-muted max-w-sm mx-auto mt-1">
                    Ask questions, verify claims, trigger sandboxed code tests, heal bugs, or publish verified models using official MCP tools.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Quick Prompts Chips */}
          <div className="border-t border-line bg-surface-cool/30 px-5 pt-3 pb-1">
            <div className="flex gap-1.5 overflow-x-auto pb-1 text-xs">
              {QUICK_PROMPTS.map((qp) => (
                <button
                  key={qp.label}
                  type="button"
                  onClick={() => setPrompt(qp.prompt)}
                  className="shrink-0 rounded-full border border-line bg-white px-3 py-1 text-[11px] font-medium text-ink-soft hover:border-purple hover:text-purple-deep transition-all shadow-xs"
                >
                  {qp.label}
                </button>
              ))}
            </div>
          </div>

          {/* Bottom Prompt Input Form */}
          <form onSubmit={handleSubmit} className="border-t border-line p-4 bg-white flex gap-2 items-center">
            <div className="relative flex-1">
              <input
                type="text"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Direct the assistant (e.g. 'Run static checks on workspace and execute tests in sandbox')..."
                className="w-full rounded-2xl border border-line bg-surface-cool/50 px-4 py-2.5 text-sm text-ink placeholder:text-muted focus:border-purple focus:bg-white focus:outline-none focus:ring-2 focus:ring-purple/20 transition-all"
                disabled={submitting}
              />
            </div>
            <Button
              type="submit"
              variant="purple"
              disabled={!prompt.trim() || submitting}
              className="rounded-2xl gap-1.5 px-4 h-10"
            >
              {submitting ? (
                <CircleNotch size={16} className="animate-spin" />
              ) : (
                <PaperPlaneTilt size={16} weight="bold" />
              )}
              <span>Execute</span>
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}

function StepCard({ step, isLatest }: { step: MCPTaskStep; isLatest: boolean }) {
  const [expanded, setExpanded] = React.useState(true);
  const [tab, setTab] = React.useState<"output" | "logs" | "diff">("output");

  const hasDiff = !!step.diff && step.diff.trim().length > 0;
  const hasLogs = !!(step.stdout || step.stderr);
  const hasOutput = !!step.output && Object.keys(step.output).length > 0;
  const isErr = !!step.error;

  return (
    <div
      className={cn(
        "rounded-2xl border transition-all text-xs overflow-hidden",
        isErr
          ? "border-coral/50 bg-coral-soft/10"
          : isLatest
          ? "border-purple/40 bg-white shadow-clay-sm"
          : "border-line bg-white shadow-xs"
      )}
    >
      {/* Step Header */}
      <div
        className="flex items-center justify-between p-3 cursor-pointer bg-surface-cool/20 hover:bg-surface-cool/40 select-none"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2.5">
          <button type="button" className="text-muted hover:text-ink">
            {expanded ? <CaretDown size={14} /> : <CaretRight size={14} />}
          </button>

          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-purple/10 font-bold text-[10px] text-purple-deep">
            {step.step_number}
          </span>

          <code className="font-semibold text-purple-deep font-mono text-xs">
            {step.tool_name}
          </code>

          {isErr ? (
            <Badge tone="coral" className="text-[10px]">Failed</Badge>
          ) : (
            <Badge tone="mint" className="text-[10px]">Success</Badge>
          )}
        </div>

        <div className="flex items-center gap-3 text-muted text-[11px]">
          {step.duration_ms > 0 && (
            <span className="flex items-center gap-1">
              <Timer size={12} />
              {step.duration_ms}ms
            </span>
          )}
        </div>
      </div>

      {/* Step Content */}
      {expanded && (
        <div className="p-3 border-t border-line space-y-2.5">
          {/* Input arguments summary */}
          {step.input && Object.keys(step.input).length > 0 && (
            <div className="space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted">Input Parameters</span>
              <pre className="rounded-xl bg-surface-cool p-2 font-mono text-[11px] text-ink-soft overflow-x-auto max-h-32">
                {JSON.stringify(step.input, null, 2)}
              </pre>
            </div>
          )}

          {/* Navigation tabs for multi-faceted outputs */}
          {(hasDiff || hasLogs) && (
            <div className="flex gap-1 border-b border-line pb-1.5 pt-1">
              {hasOutput && (
                <button
                  type="button"
                  onClick={() => setTab("output")}
                  className={cn(
                    "rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-all",
                    tab === "output" ? "bg-purple text-white shadow-xs" : "text-ink-soft hover:bg-surface-cool"
                  )}
                >
                  Structured Result
                </button>
              )}
              {hasDiff && (
                <button
                  type="button"
                  onClick={() => setTab("diff")}
                  className={cn(
                    "rounded-lg px-2.5 py-1 text-[11px] font-semibold flex items-center gap-1 transition-all",
                    tab === "diff" ? "bg-purple text-white shadow-xs" : "text-ink-soft hover:bg-surface-cool"
                  )}
                >
                  <FileCode size={12} />
                  Code Diff
                </button>
              )}
              {hasLogs && (
                <button
                  type="button"
                  onClick={() => setTab("logs")}
                  className={cn(
                    "rounded-lg px-2.5 py-1 text-[11px] font-semibold flex items-center gap-1 transition-all",
                    tab === "logs" ? "bg-purple text-white shadow-xs" : "text-ink-soft hover:bg-surface-cool"
                  )}
                >
                  <Terminal size={12} />
                  Logs / Output
                </button>
              )}
            </div>
          )}

          {/* Tab Content */}
          {tab === "diff" && hasDiff && (
            <div className="space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted">File Modifications</span>
              <div className="rounded-xl bg-[#1e1e2e] p-2.5 font-mono text-[11px] text-[#cdd6f4] overflow-x-auto max-h-56 leading-relaxed">
                {step.diff!.split("\n").map((line, idx) => {
                  const isAdd = line.startsWith("+");
                  const isDel = line.startsWith("-");
                  return (
                    <div
                      key={idx}
                      className={cn(
                        "px-1 rounded-xs",
                        isAdd ? "bg-[#a6e3a1]/20 text-[#a6e3a1]" : isDel ? "bg-[#f38ba8]/20 text-[#f38ba8]" : ""
                      )}
                    >
                      {line}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {tab === "logs" && hasLogs && (
            <div className="space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted">Live Sandbox Console</span>
              <div className="rounded-xl bg-[#181825] p-2.5 font-mono text-[11px] overflow-x-auto max-h-48 text-[#cdd6f4]">
                {step.stdout && (
                  <pre className="text-[#a6e3a1] whitespace-pre-wrap">{step.stdout}</pre>
                )}
                {step.stderr && (
                  <pre className="text-[#f38ba8] whitespace-pre-wrap mt-1">{step.stderr}</pre>
                )}
              </div>
            </div>
          )}

          {(tab === "output" || (!hasDiff && !hasLogs)) && hasOutput && (
            <div className="space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted">Result Data</span>
              <pre className="rounded-xl bg-surface-cool p-2 font-mono text-[11px] text-ink-soft overflow-x-auto max-h-44">
                {JSON.stringify(step.output, null, 2)}
              </pre>
            </div>
          )}

          {/* Error Message */}
          {step.error && (
            <div className="rounded-xl bg-coral-soft/30 border border-coral/30 p-2 text-xs font-mono text-coral-deep">
              {step.error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
