import { Redis } from "@upstash/redis";

export const FUNNEL_EVENTS = [
  "photo_uploaded",
  "audit_completed",
  "improve_clicked",
  "improve_completed",
  "edit_clicked",
  "edit_completed",
  "download_clicked",
  "checkout_started",
  "payment_verified",
] as const;

export type FunnelEvent = (typeof FUNNEL_EVENTS)[number];

let redis: Redis | null = null;

function redisConfigured(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  );
}

function getRedis(): Redis {
  if (redis) return redis;
  redis = Redis.fromEnv();
  return redis;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function isFunnelEvent(value: unknown): value is FunnelEvent {
  return (
    typeof value === "string" &&
    (FUNNEL_EVENTS as readonly string[]).includes(value)
  );
}

export async function trackFunnelEvent(event: FunnelEvent): Promise<void> {
  if (!redisConfigured()) return;

  try {
    const date = todayKey();
    const pipeline = getRedis().pipeline();
    pipeline.incr(`metrics:total:${event}`);
    pipeline.incr(`metrics:daily:${date}:${event}`);
    await pipeline.exec();
  } catch (err) {
    console.error("[analytics] track failed:", err);
  }
}

export async function funnelMetrics(): Promise<{
  date: string;
  total: Record<FunnelEvent, number>;
  today: Record<FunnelEvent, number>;
}> {
  if (!redisConfigured()) {
    throw new Error("UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required.");
  }

  const date = todayKey();
  const totalKeys = FUNNEL_EVENTS.map((event) => `metrics:total:${event}`);
  const todayKeys = FUNNEL_EVENTS.map((event) => `metrics:daily:${date}:${event}`);
  const [totalValues, todayValues] = await Promise.all([
    getRedis().mget<number[]>(...totalKeys),
    getRedis().mget<number[]>(...todayKeys),
  ]);

  const total = {} as Record<FunnelEvent, number>;
  const today = {} as Record<FunnelEvent, number>;
  FUNNEL_EVENTS.forEach((event, index) => {
    total[event] = Number(totalValues[index] ?? 0);
    today[event] = Number(todayValues[index] ?? 0);
  });

  return { date, total, today };
}
