"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMe } from "@/lib/hooks/queries";

/** A visitor who already has a valid session goes straight to the dashboard (the server still authorises every call). */
export function LandingRedirect() {
  const router = useRouter();
  const me = useMe();
  React.useEffect(() => {
    if (me.data) router.replace("/dashboard");
  }, [me.data, router]);
  return null;
}
