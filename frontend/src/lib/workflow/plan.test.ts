import { describe, expect, it } from "vitest";
import type { Claim, RunSetting } from "@/lib/api/types";
import { buildPlanTasks, validateEdits } from "./plan";

const setting = (name: string, value: string, source: RunSetting["source"] = "assumption"): RunSetting => ({
  id: name, run_id: "1", name, value, source, source_ref: null, reason: null,
});
const claim = (metric: string): Claim => ({ id: metric, paper_id: "1", description: metric, value: 1, unit: null, page: 4, table_ref: null, position_on_page: null, condition: null, metric_name: metric });

describe("coding plan", () => {
  it("is built from the real claims and settings (counts and metric names)", () => {
    const tasks = buildPlanTasks([], [claim("a_errors"), claim("b_errors")], [setting("x", "1", "compute_change"), setting("y", "2")]);
    expect(tasks.map((t) => t.id)).toEqual(["write", "review", "run", "tests", "score", "gap"]);
    expect(tasks[0]!.because).toContain("2 labelled settings");
    expect(tasks[0]!.because).toContain("1 of them reduced");
    expect(tasks[2]!.acceptance).toContain("a_errors, b_errors");
    expect(tasks[3]!.because).toContain("(2)");
    expect(tasks[0]!.dependsOn).toBeNull();
    expect(tasks[1]!.dependsOn).toBe(tasks[0]!.title);
  });
});

describe("plan edit validation", () => {
  const settings = [setting("train.epochs", "8"), setting("optimizer", "sgd"), setting("data.shuffle", "true"), setting("lr", "0.05")];
  it("returns only real changes with their original types", () => {
    const r = validateEdits(settings, { "train.epochs": "12", optimizer: "sgd", "data.shuffle": "false", lr: "0.1" });
    expect(r.errors).toEqual({});
    expect(r.changes).toEqual({ "train.epochs": 12, "data.shuffle": false, lr: 0.1 });
  });
  it("rejects empty values and wrong types", () => {
    const r = validateEdits(settings, { "train.epochs": "many", optimizer: "  ", "data.shuffle": "maybe" });
    expect(r.errors).toEqual({ "train.epochs": "Enter a number", optimizer: "Value is required", "data.shuffle": "Use true or false" });
    expect(r.changes).toEqual({});
  });
  it("ignores settings the user did not touch", () => {
    expect(validateEdits(settings, {})).toEqual({ changes: {}, errors: {} });
  });
});
