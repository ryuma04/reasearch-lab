import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <div className="max-w-md rounded-[28px] border-2 border-ink bg-white p-10 text-center shadow-pop-lg">
        <p className="font-display text-6xl font-bold">404</p>
        <p className="mt-3 text-ink-soft">This page doesn&apos;t exist.</p>
        <Button asChild className="mt-6"><Link href="/dashboard">Back to the lab</Link></Button>
      </div>
    </div>
  );
}
