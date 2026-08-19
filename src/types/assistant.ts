export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  timestamp: string;
  domains?: DataDomain[]; // which data domains the assistant drew on, for transparency
  denied?: boolean; // true if the question touched data outside the user's access level
}

// The categories of underlying data the assistant can be asked about. Access
// to each is gated per role — see ROLE_DATA_ACCESS in aiService.ts.
export type DataDomain =
  | "kpis" | "programmes" | "operationalPlans" | "compliance"
  | "audit" | "alerts" | "staffAppraisals" | "unitHeadAppraisals" | "users";
