import { latency } from "./mockUtils";
import { compliance as seed } from "@/data/compliance";
import { loadStore, saveStore } from "@/utils/persistedStore";
import type { ComplianceRecord, SubmissionStatus } from "@/types/compliance";

const KEY = "zou_irbm_store_compliance";
let store: ComplianceRecord[] = loadStore(KEY, seed);

function persist() {
  saveStore(KEY, store);
}

export const complianceService = {
  list: () => latency(store),

  // Called when a real performance submission comes in, so this page
  // reflects live activity instead of only ever showing its seed data.
  // Upserts (rather than appends) so resubmitting in the same month for the
  // same Sub-programme updates the existing record instead of duplicating it.
  recordSubmission: (subProgrammeId: string, subProgramme: string, month: string, status: SubmissionStatus): ComplianceRecord => {
    const id = `c-${subProgrammeId}-${month}`;
    const record: ComplianceRecord = {
      id, subProgrammeId, subProgramme, month,
      dueDate: `${month}-05`,
      submittedDate: status === "missing" ? null : new Date().toISOString().slice(0, 10),
      status,
    };
    const idx = store.findIndex((r) => r.id === id);
    store = idx >= 0 ? store.map((r, i) => (i === idx ? record : r)) : [record, ...store];
    persist();
    return record;
  },
};
