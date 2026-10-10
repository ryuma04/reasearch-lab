import { redirect } from "next/navigation";

export default async function ResultsIndex({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ run?: string }> }) {
  const { id } = await params;
  const { run } = await searchParams;
  redirect(`/workspaces/${id}/results/scorecard${run ? `?run=${encodeURIComponent(run)}` : ""}`);
}
