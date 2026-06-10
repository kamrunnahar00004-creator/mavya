import type { NextRequest } from "next/server";

function firstHeaderIp(value: string | null): string | null {
  const ip = value?.split(",")[0]?.trim();
  return ip || null;
}

export function clientIp(req: NextRequest): string {
  return (
    firstHeaderIp(req.headers.get("x-vercel-forwarded-for")) ??
    firstHeaderIp(req.headers.get("x-forwarded-for")) ??
    firstHeaderIp(req.headers.get("x-real-ip")) ??
    "local"
  );
}
