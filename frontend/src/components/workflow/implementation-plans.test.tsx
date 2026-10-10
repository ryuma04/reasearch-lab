import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ImplementationPlans, planReviewOf, type PlanReview } from "./implementation-plans";

const task = (id: string, title: string) => ({ id, title, kind: "code", completion: "done", validation: "run it", failure: "exit 1" });
const OK = { ok: true, errors: [], warnings: [] };
const review: PlanReview = {
  ready: "optimized",
  initial: { plan: { objective: "Original", tasks: [task("T1", "Install")] }, validation: OK },
  optimized: { plan: { objective: "Improved", tasks: [task("T1", "Install"), task("T2", "Regression tests")] }, validation: OK,
    weaknesses: [{ issue: "No tests", fix: "Added T2" }],
    diff: { added: ["T2: Regression tests"], removed: [], changed: [], reordered: [], tests_added: ["T2: Regression tests"], risks_added: [], decisions_added: [] } },
};

describe("ImplementationPlans", () => {
  it("labels the original and optimized plans and shows what changed", () => {
    render(<ImplementationPlans review={review} />);
    expect(screen.getByText("Improved")).toBeInTheDocument();
    expect(screen.getByText(/Added T2/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /Initial plan \(original proposal\)/ }));
    expect(screen.getByText("Original")).toBeInTheDocument();
    expect(screen.queryByText("T2")).not.toBeInTheDocument();
  });

  it("explains a failed optimization and keeps the optimized tab disabled", () => {
    render(<ImplementationPlans review={{ ...review, optimized: { plan: null, failure: "no usable plan; the initial plan is kept" } }} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/Optimization did not produce a plan/);
    expect(screen.getByRole("tab", { name: "Optimized plan" })).toBeDisabled();
  });

  it("states that coding cannot start when no plan passed validation", () => {
    render(<ImplementationPlans review={{ ...review, ready: null, optimized: null, initial: { plan: review.initial!.plan, validation: { ok: false, errors: ["The plan has no test task"], warnings: [] } } }} />);
    expect(screen.getAllByText(/no test task/).length).toBeGreaterThan(0);
    expect(screen.getByText(/coding cannot start/)).toBeInTheDocument();
  });

  it("returns null for runs from before the planners existed", () => {
    expect(planReviewOf({})).toBeNull();
    expect(planReviewOf({ implementation_plans: review })?.ready).toBe("optimized");
  });
});
