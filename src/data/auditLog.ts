import type { AuditEntry } from "@/types/audit";

export const auditLog: AuditEntry[] = [
  { id: "a1", user: "P. Ndlovu", role: "Sub-programme Rep", action: "submitted", module: "Performance Submission", record: "Budget absorption rate — Aug 2026", previousValue: "54", newValue: "58", timestamp: "2026-08-04 10:12", device: "Chrome · 197.221.x.x" },
  { id: "a2", user: "Corporate Planning Unit", role: "CPU", action: "returned", module: "CPU Approval", record: "Estates maintenance requests closed", previousValue: null, newValue: "62", timestamp: "2026-08-06 14:03", device: "Chrome · 197.221.x.x", reason: "Figure inconsistent with helpdesk export, please re-verify." },
  { id: "a3", user: "Corporate Planning Unit", role: "CPU", action: "approved", module: "CPU Approval", record: "Staff performance appraisals completed", previousValue: null, newValue: "93", timestamp: "2026-08-02 09:47", device: "Chrome · 197.221.x.x" },
  { id: "a4", user: "K. Moyo", role: "Sub-programme Head", action: "edited", module: "KPI Management", record: "System uptime", previousValue: "96.8", newValue: "97.4", timestamp: "2026-07-29 11:30", device: "Firefox · 41.190.x.x", reason: "Retroactive correction after monitoring log reconciliation." },
  { id: "a5", user: "Corporate Planning Unit", role: "CPU", action: "overridden", module: "Manual Override", record: "Regional library visits", previousValue: "14900", newValue: "15400", timestamp: "2026-07-30 15:18", device: "Chrome · 197.221.x.x", reason: "System count excluded two regional campuses during a network outage." },
  { id: "a6", user: "M. Chuma", role: "Sub-programme Rep", action: "submitted", module: "Performance Submission", record: "Peer-reviewed publications — Aug 2026", previousValue: "50", newValue: "52", timestamp: "2026-08-04 08:55", device: "Chrome · 102.68.x.x" },
  { id: "a7", user: "Corporate Planning Unit", role: "CPU", action: "approved", module: "CPU Approval", record: "Student pass rate", previousValue: null, newValue: "81", timestamp: "2026-08-01 13:20", device: "Chrome · 197.221.x.x" },
  { id: "a8", user: "ICT Systems Admin", role: "ICT", action: "created", module: "Programme Management", record: "Sub-programme: Innovation Hub unit added", previousValue: null, newValue: "Innovation Hub", timestamp: "2026-07-10 10:00", device: "Chrome · 197.221.x.x" },
  { id: "a9", user: "Prof. E. Mavhu", role: "Vice-Chancellor", action: "logged in", module: "Authentication", record: "Session start", previousValue: null, newValue: null, timestamp: "2026-08-15 07:40", device: "Safari · 41.190.x.x" },
];
