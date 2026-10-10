import { Suspense } from "react";
import { WorkspaceHeader } from "@/components/run/workspace-header";

export default async function WorkspaceLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="space-y-6">
      <Suspense>
        <WorkspaceHeader id={id} />
      </Suspense>
      <Suspense>{children}</Suspense>
    </div>
  );
}
