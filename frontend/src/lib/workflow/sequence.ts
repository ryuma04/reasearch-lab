/**
 * How the research agents relate in time. The relationship is read from REAL start/finish timestamps:
 * an agent that started after another finished ran "after" it; one that started while another was
 * still running ran "in parallel". An agent that has not started has no measured relationship yet.
 */
import type { AgentActivity } from "./activity";

export type Relation =
  | { kind: "first" }
  | { kind: "after"; agent: string }
  | { kind: "parallel"; agent: string }
  | { kind: "waiting"; agent: string; blocked: boolean };

export function relate(acts: AgentActivity[]): Relation[] {
  return acts.map((a, i) => {
    if (i === 0) return { kind: "first" } as Relation;
    const prev = acts[i - 1]!;
    if (a.startedAt) {
      if (prev.startedAt && prev.endedAt && Date.parse(a.startedAt) >= Date.parse(prev.endedAt)) return { kind: "after", agent: prev.id } as Relation;
      if (prev.startedAt && (!prev.endedAt || Date.parse(a.startedAt) < Date.parse(prev.endedAt))) return { kind: "parallel", agent: prev.id } as Relation;
      return { kind: "after", agent: prev.id } as Relation; // prev never reported a start: still ran after it in the fixed order
    }
    // Not started: it follows the previous agent in the registry order.
    return { kind: "waiting", agent: prev.id, blocked: prev.status === "working" || prev.status === "waiting" } as Relation;
  });
}
