import { latency } from "./mockUtils";
import { DEFAULT_THRESHOLDS, type RagThresholds } from "@/utils/ragStatus";

const KEY = "zou_irbm_rag_thresholds";

function read(): RagThresholds {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as RagThresholds;
  } catch {
    // fall through to defaults
  }
  return DEFAULT_THRESHOLDS;
}

export const settingsService = {
  // Synchronous read used internally by kpiService, which needs the current
  // thresholds while building its (Promise-wrapped) response.
  getThresholdsSync: read,

  getThresholds: (): Promise<RagThresholds> => latency(read()),

  setThresholds: (thresholds: RagThresholds): Promise<RagThresholds> => {
    localStorage.setItem(KEY, JSON.stringify(thresholds));
    return latency(thresholds, 250);
  },
};
