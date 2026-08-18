export interface AuditEntry {
  id: string;
  user: string;
  role: string;
  action: "submitted" | "approved" | "rejected" | "returned" | "edited" | "overridden" | "created" | "logged in";
  module: string;
  record: string;
  previousValue: string | null;
  newValue: string | null;
  timestamp: string;
  device: string;
  reason?: string;
}
