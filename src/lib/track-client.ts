import type { FunnelEvent } from "./analytics-events";

export function trackClientEvent(event: FunnelEvent): void {
  if (typeof window === "undefined") return;

  const body = JSON.stringify({ event });
  if (navigator.sendBeacon) {
    navigator.sendBeacon(
      "/api/track",
      new Blob([body], { type: "application/json" })
    );
    return;
  }

  fetch("/api/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => undefined);
}
