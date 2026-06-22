import type { Approach } from "@/core/domain/benchmark";

export interface LocProvider {
  getLoc(approach: Approach): number;
}
