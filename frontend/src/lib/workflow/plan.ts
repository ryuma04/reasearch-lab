/**
 * The Coding Plan, built from what the backend really has at the plan checkpoint: the run's
 * labelled settings, the Claims List and the fixed pipeline agents. File-level tasks do not exist
 * before coding (the Code Writer decides them), so the plan shows pipeline steps, not invented files.
 */
import type { Claim, RunSetting } from "@/lib/api/types";

export interface PlanAgent {
  id: string;
  name: string;
  description: string;
}

export interface PlanTask {
  id: string;
  title: string;
  explanation: string;
  /** Why this step follows from the research (counts come from the real claims/settings). */
  because: string;
  dependsOn: string | null;
  acceptance: string;
}

export function buildPlanTasks(agents: PlanAgent[], claims: Claim[], settings: RunSetting[]): PlanTask[] {
  const by = (id: string) => agents.find((a) => a.id === id);
  const metricNames = [...new Set(claims.map((c) => c.metric_name).filter(Boolean))] as string[];
  const compute = settings.filter((s) => s.source === "compute_change").length;
  const tasks: Omit<PlanTask, "dependsOn">[] = [
    {
      id: "write", title: by("coding.writer")?.name ?? "Write the project",
      explanation: by("coding.writer")?.description ?? "Write the implementation and a configuration file.",
      because: `Implements the method with the ${settings.length} labelled settings below${compute ? `, ${compute} of them reduced to fit your compute budget` : ""}.`,
      acceptance: "The project files and configs/config.yaml are written; every script writes results/metrics.json.",
    },
    {
      id: "review", title: by("coding.reviewer")?.name ?? "Review and debug",
      explanation: "Reviews the code against the Research Brief, installs the requirements and times a short test drive.",
      because: "Catches setting mismatches (for example a different temperature) before any expensive run.",
      acceptance: "Dependencies install in the sandbox and the estimated run time fits the budget (or you choose a shorter run).",
    },
    {
      id: "run", title: "Run the experiment in the sandbox",
      explanation: "Executes the code offline in an isolated container with CPU, memory and time limits.",
      because: `The paper reports ${claims.length} result${claims.length === 1 ? "" : "s"} that must come from a real run, never from model text.`,
      acceptance: metricNames.length ? `results/metrics.json reports: ${metricNames.join(", ")}.` : "results/metrics.json is written by the code.",
    },
    {
      id: "tests", title: by("testing.designer")?.name ?? "Write tests",
      explanation: by("testing.designer")?.description ?? "Write correctness and claim tests.",
      because: `One claim test per reported result (${claims.length}) plus correctness tests of the code.`,
      acceptance: "Test files exist for every claim and run without collection errors.",
    },
    {
      id: "score", title: by("testing.runner")?.name ?? "Run tests and score claims",
      explanation: by("testing.runner")?.description ?? "Run the tests and fill the Claim Scorecard.",
      because: "Compares each measured number with the paper's number within its tolerance.",
      acceptance: "Every claim is Match, Close or Different, linked to its run, code version and log line.",
    },
    {
      id: "gap", title: by("gap_detective")?.name ?? "Explain differences",
      explanation: "Only if a claim is Different: runs small one-change experiments to find out why.",
      because: "A difference should be explained by evidence, not guessed.",
      acceptance: "An explanation whose every number is backed by a recorded run.",
    },
  ];
  return tasks.map((t, i) => ({ ...t, dependsOn: i ? tasks[i - 1]!.title : null }));
}

export type DraftValue = string | number | boolean;

/** Check a draft of setting edits. Numeric and boolean settings must stay numeric / boolean. */
export function validateEdits(settings: RunSetting[], draft: Record<string, string>): { changes: Record<string, DraftValue>; errors: Record<string, string> } {
  const changes: Record<string, DraftValue> = {};
  const errors: Record<string, string> = {};
  for (const s of settings) {
    if (!(s.name in draft)) continue;
    const next = draft[s.name]!.trim();
    if (next === s.value.trim()) continue;
    if (next === "") {
      errors[s.name] = "Value is required";
      continue;
    }
    const wasNumber = s.value.trim() !== "" && Number.isFinite(Number(s.value));
    const wasBool = s.value === "true" || s.value === "false";
    if (wasNumber) {
      if (!Number.isFinite(Number(next))) errors[s.name] = "Enter a number";
      else changes[s.name] = Number(next);
    } else if (wasBool) {
      if (next !== "true" && next !== "false") errors[s.name] = "Use true or false";
      else changes[s.name] = next === "true";
    } else {
      if (next.length > 200) errors[s.name] = "Too long";
      else changes[s.name] = next;
    }
  }
  return { changes, errors };
}
