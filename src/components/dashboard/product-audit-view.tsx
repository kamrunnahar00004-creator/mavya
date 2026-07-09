"use client";

import { useRouter } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { AuditWorkspace } from "@/components/audit-workspace";
import type { DemoState } from "@/data/demo-states";

type Props = {
  state: DemoState;
  imageSrc: string;
};

/**
 * Read-only product rating view (Phase 2). Renders the saved audit with the
 * existing workspace UI, without improve/edit handlers — so the buttons are
 * hidden and it just shows the score, pillars, next steps, and Etsy preview.
 * Phase 3 wires improve/edit + supporting photos + persistence here.
 */
export function ProductAuditView({ state, imageSrc }: Props) {
  const router = useRouter();
  return (
    <>
      <AppHeader />
      <AuditWorkspace
        state={state}
        uploadedSrc={imageSrc}
        panelMode="main"
        onCta={() => router.push("/dashboard")}
        animate
      />
    </>
  );
}
