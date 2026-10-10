import { WorkflowGate } from "@/components/workflow/workflow-gate";

/** Full-screen layout for the dedicated run tab: no app navigation, but the same sign-in gate. */
export default function WorkflowLayout({ children }: { children: React.ReactNode }) {
  return <WorkflowGate>{children}</WorkflowGate>;
}
