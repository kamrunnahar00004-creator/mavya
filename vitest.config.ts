import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "node",
    // eval/live-eval.test.ts self-skips unless RUN_LIVE_AI_EVALS=true, so
    // normal `npm test` stays free and deterministic.
    include: ["tests/**/*.test.ts", "eval/**/*.test.ts"],
  },
});
