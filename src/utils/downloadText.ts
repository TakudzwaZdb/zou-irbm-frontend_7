// Client-side downloads — no backend needed.

export function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  downloadBlob(filename, blob);
}

// Downloads the actual uploaded File object (the real attached document),
// not a generated summary.
export function downloadFile(file: File) {
  downloadBlob(file.name, file);
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function buildStaffReportText(r: {
  staffName: string; unitName: string; recipientHead: string; recipientUnitName: string;
  weekEnding: string; activitySummary: string; score: number | null;
  submittedAt: string; appraisedBy?: string; appraisedAt?: string; appraisalComment?: string;
  feedback?: string; feedbackBy?: string; feedbackAt?: string;
  attachmentName?: string; attachmentUploadedAt?: string;
}): string {
  return [
    "ZOU IRBM — Weekly Job Activity Report",
    "======================================",
    `Staff member: ${r.staffName}`,
    `Unit: ${r.unitName}`,
    `Sent to: ${r.recipientHead} (${r.recipientUnitName})`,
    `Week ending: ${r.weekEnding}`,
    `Submitted: ${r.submittedAt}`,
    r.attachmentName ? `Attached document: ${r.attachmentName} (uploaded ${r.attachmentUploadedAt})` : "",
    "",
    "Activity summary:",
    r.activitySummary,
    "",
    r.score !== null ? `Score: ${r.score}%` : "Score: not yet appraised",
    r.appraisedBy ? `Appraised by: ${r.appraisedBy} on ${r.appraisedAt}` : "",
    r.appraisalComment ? `Appraisal comment: ${r.appraisalComment}` : "",
    r.feedback ? `Feedback from ${r.feedbackBy} on ${r.feedbackAt}: ${r.feedback}` : "",
  ].filter(Boolean).join("\n");
}

export function buildUnitHeadReportText(r: {
  unitHeadName: string; unitName: string; recipient: string; weekEnding: string; jobSummary: string;
  score: number | null; submittedAt: string; evaluatedBy?: string; evaluatedAt?: string; evaluationComment?: string;
  attachmentName?: string; attachmentUploadedAt?: string;
}): string {
  return [
    "ZOU IRBM — Unit Head Individual Performance Report",
    "===================================================",
    `Unit Head: ${r.unitHeadName}`,
    `Unit: ${r.unitName}`,
    `Sent to: ${r.recipient}`,
    `Week ending: ${r.weekEnding}`,
    `Submitted: ${r.submittedAt}`,
    r.attachmentName ? `Attached document: ${r.attachmentName} (uploaded ${r.attachmentUploadedAt})` : "",
    "",
    "Job summary:",
    r.jobSummary,
    "",
    r.score !== null ? `Score: ${r.score}%` : "Score: not yet evaluated",
    r.evaluatedBy ? `Evaluated by: ${r.evaluatedBy} on ${r.evaluatedAt}` : "",
    r.evaluationComment ? `Evaluation comment: ${r.evaluationComment}` : "",
  ].filter(Boolean).join("\n");
}

export function buildOperationalPlanText(p: {
  title: string; unitName: string; unitHeadName: string; period: string; status: string; submittedAt: string;
  attachmentName?: string; attachmentUploadedAt?: string;
  programmeHeadReviewedBy?: string; programmeHeadReviewedAt?: string;
  vcReviewedBy?: string; vcReviewedAt?: string;
  cpuValidatedBy?: string; cpuValidatedAt?: string; budgetComment?: string; feasibilityComment?: string;
  rejectedStage?: string; rejectedBy?: string; rejectedAt?: string; rejectionReason?: string;
}): string {
  return [
    "ZOU IRBM — Operational Plan",
    "============================",
    `Title: ${p.title}`,
    `Unit: ${p.unitName}`,
    `Submitted by: ${p.unitHeadName}`,
    `Period: ${p.period}`,
    `Status: ${p.status.replace(/_/g, " ")}`,
    `Submitted: ${p.submittedAt}`,
    p.attachmentName ? `Attached document: ${p.attachmentName} (uploaded ${p.attachmentUploadedAt})` : "",
    "",
    "Approval trail:",
    p.programmeHeadReviewedBy ? `- Programme Head: ${p.programmeHeadReviewedBy} on ${p.programmeHeadReviewedAt}` : "- Programme Head: pending",
    p.vcReviewedBy ? `- Vice-Chancellor: ${p.vcReviewedBy} on ${p.vcReviewedAt}` : "- Vice-Chancellor: pending",
    p.cpuValidatedBy ? `- CPU validation: ${p.cpuValidatedBy} on ${p.cpuValidatedAt}` : "- CPU validation: pending",
    p.budgetComment ? `  Budget assessment: ${p.budgetComment}` : "",
    p.feasibilityComment ? `  Feasibility assessment: ${p.feasibilityComment}` : "",
    p.rejectedBy ? `\nRejected at ${p.rejectedStage} stage by ${p.rejectedBy} on ${p.rejectedAt}\nReason: ${p.rejectionReason}` : "",
  ].filter(Boolean).join("\n");
}
