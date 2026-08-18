import type { RagStatus } from "@/types/kpi";

export interface RagThresholds {
  onTrack: number; // minimum % progress toward target to show green
  atRisk: number;  // minimum % progress toward target to show amber
}

export const DEFAULT_THRESHOLDS: RagThresholds = { onTrack: 85, atRisk: 60 };

export function ragFor(actual: number, target: number, baseline: number, thresholds: RagThresholds = DEFAULT_THRESHOLDS): RagStatus {
  const progress = (actual - baseline) / (target - baseline || 1);
  if (progress >= thresholds.onTrack / 100) return "on-track";
  if (progress >= thresholds.atRisk / 100) return "at-risk";
  return "off-track";
}
