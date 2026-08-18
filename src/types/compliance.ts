export type SubmissionStatus = "on-time" | "late" | "missing";

export interface ComplianceRecord {
  id: string;
  subProgrammeId: string;
  subProgramme: string;
  month: string;
  dueDate: string;
  submittedDate: string | null;
  status: SubmissionStatus;
}
