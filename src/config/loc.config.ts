import type { Approach } from "@/core/domain/benchmark";

export const benchmarkLoc: Record<Approach, number> = {
  cli: 92,
  api: 184,
  mcp: 71,
};

export function getConfiguredLoc(approach: Approach): number {
  return benchmarkLoc[approach];
}
