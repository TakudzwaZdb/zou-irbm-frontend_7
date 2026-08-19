// ── AI Assistant service ─────────────────────────────────────────────────
//
// This is a MOCK stand-in for a real LLM integration. It demonstrates the
// architecture — role-scoped context assembly, then a natural-language
// answer — without an actual model call, because a browser cannot safely
// hold an LLM API key. In production, `ask()` below becomes a single
// `apiClient.post('/ai/query', { query })` call to a backend endpoint that:
//   1. Derives the caller's role/permissions from their authenticated
//      session (never trusts a role sent from the client)
//   2. Assembles only the data that role is allowed to see (the same
//      ROLE_DATA_ACCESS + record-level scoping below, enforced server-side)
//   3. Sends that scoped context + the question to the LLM
//   4. Returns the answer
// Every page that calls this service today will keep working unchanged
// when that swap happens — this file is the only thing that changes.

import { latency } from "./mockUtils";
import { kpiService } from "./kpiService";
import { operationalPlanService } from "./operationalPlanService";
import { complianceService } from "./complianceService";
import { auditService } from "./auditService";
import { alertService } from "./alertService";
import { staffAppraisalService } from "./staffAppraisalService";
import { unitHeadAppraisalService } from "./unitHeadAppraisalService";
import { userService } from "./userService";
import { programmeService } from "./programmeService";
import { orgUnits } from "@/data/organisation";
import { staffMembers } from "@/data/staff";
import { unitHeadIdFor } from "@/utils/unitHeadId";
import type { DataDomain } from "@/types/assistant";
import type { Role, User } from "@/types/user";

// Which data domains each role is permitted to ask the assistant about.
// This mirrors (and should stay in sync with) the route-level access rules
// in src/config/nav.ts — the assistant must never surface more than the UI
// already exposes to that role.
export const ROLE_DATA_ACCESS: Record<Role, DataDomain[]> = {
  vc: ["kpis", "programmes", "operationalPlans", "compliance", "audit", "alerts"],
  council: ["operationalPlans", "compliance"],
  cpu: ["kpis", "programmes", "operationalPlans", "compliance", "audit", "alerts", "staffAppraisals", "unitHeadAppraisals", "users"],
  ict: ["kpis", "programmes", "operationalPlans", "compliance", "audit", "alerts", "staffAppraisals", "unitHeadAppraisals", "users"],
  programme_head: ["kpis", "programmes", "operationalPlans", "unitHeadAppraisals"],
  subprogramme_head: ["kpis", "programmes"],
  subprogramme_rep: ["kpis"],
  unit_head: ["staffAppraisals", "operationalPlans"],
  administration: ["unitHeadAppraisals"],
  staff: ["staffAppraisals"],
};

interface Intent { pattern: RegExp; domain: DataDomain }

const INTENTS: Intent[] = [
  { pattern: /\bkpi|target|off.?track|on.?track|at.?risk|achievement\b/i, domain: "kpis" },
  { pattern: /\bprogramme|programm|sub-?programme\b/i, domain: "programmes" },
  { pattern: /\boperational plan|annual plan|budget|feasibilit/i, domain: "operationalPlans" },
  { pattern: /\bcompliance|late submission|missing submission|on-?time\b/i, domain: "compliance" },
  { pattern: /\baudit|log|history of change/i, domain: "audit" },
  { pattern: /\balert|escalat/i, domain: "alerts" },
  { pattern: /\bunit head|programme head evaluation|evaluate/i, domain: "unitHeadAppraisals" },
  { pattern: /\bstaff (report|appraisal|score)|weekly report/i, domain: "staffAppraisals" },
  { pattern: /\buser|role|account\b/i, domain: "users" },
];

export function detectDomains(query: string): DataDomain[] {
  const matched = INTENTS.filter((i) => i.pattern.test(query)).map((i) => i.domain);
  return Array.from(new Set(matched));
}

// Record-level scoping — mirrors exactly what each role can see on the
// actual pages (Operational Plans page scopes by Programme for Programme
// Heads, Administration/Programme Head evaluation queues scope by
// recipient, etc). The assistant must never answer with more than those
// pages already show that role.
function myUnitId(user: User): string | undefined {
  return orgUnits.find((u) => u.head === user.name)?.id;
}
async function myProgrammeId(user: User): Promise<string | undefined> {
  const programmes = await programmeService.list();
  return programmes.find((p) => p.head === user.name)?.id;
}
function myStaffId(user: User): string | undefined {
  return staffMembers.find((s) => s.name === user.name)?.id;
}

async function answerForDomain(domain: DataDomain, user: User): Promise<string> {
  switch (domain) {
    case "kpis": {
      let kpis = await kpiService.list();
      if (user.role === "programme_head") {
        const pid = await myProgrammeId(user);
        if (pid) kpis = kpis.filter((k) => k.programmeId === pid);
      }
      const onTrack = kpis.filter((k) => k.status === "on-track").length;
      const atRisk = kpis.filter((k) => k.status === "at-risk").length;
      const offTrack = kpis.filter((k) => k.status === "off-track").length;
      return `Across ${kpis.length} KPIs${user.role === "programme_head" ? " in your Programme" : ""}: ${onTrack} on track, ${atRisk} at risk, ${offTrack} off track.`;
    }
    case "programmes": {
      const programmes = await programmeService.list();
      return `ZOU has ${programmes.length} Programmes: ${programmes.map((p) => `${p.code} ${p.name}`).join("; ")}.`;
    }
    case "operationalPlans": {
      let plans = await operationalPlanService.list();
      let scopeNote = "";
      if (user.role === "programme_head") {
        const pid = await myProgrammeId(user);
        if (pid) { plans = plans.filter((p) => p.programmeId === pid); scopeNote = " in your Programme"; }
      } else if (user.role === "unit_head") {
        const uid = myUnitId(user);
        if (uid) { plans = plans.filter((p) => p.unitHeadId === unitHeadIdFor(uid)); scopeNote = " you've submitted"; }
      }
      const byStatus = {
        pending_programme_head: plans.filter((p) => p.status === "pending_programme_head").length,
        pending_vc: plans.filter((p) => p.status === "pending_vc").length,
        pending_cpu: plans.filter((p) => p.status === "pending_cpu").length,
        validated: plans.filter((p) => p.status === "validated").length,
        rejected: plans.filter((p) => p.status === "rejected").length,
      };
      return `${plans.length} operational plans${scopeNote} — ${byStatus.validated} validated, ${byStatus.pending_programme_head} awaiting Programme Head, ${byStatus.pending_vc} awaiting VC, ${byStatus.pending_cpu} awaiting CPU validation, ${byStatus.rejected} rejected.`;
    }
    case "compliance": {
      const records = await complianceService.list();
      const onTime = records.filter((r) => r.status === "on-time").length;
      const rate = records.length ? Math.round((onTime / records.length) * 100) : 0;
      return `Submission compliance is running at ${rate}% on-time across ${records.length} tracked submissions.`;
    }
    case "audit": {
      const entries = await auditService.list();
      return `The audit trail has ${entries.length} recorded actions. Most recent: "${entries[0]?.action}" on "${entries[0]?.record}" by ${entries[0]?.user} (${entries[0]?.timestamp}).`;
    }
    case "alerts": {
      const alerts = await alertService.list();
      const active = alerts.filter((a) => !a.acknowledged).length;
      return `There are ${active} active alerts out of ${alerts.length} total.`;
    }
    case "staffAppraisals": {
      let reports = await staffAppraisalService.list();
      let scopeNote = "";
      if (user.role === "staff") {
        const sid = myStaffId(user);
        if (sid) { reports = reports.filter((r) => r.staffId === sid); scopeNote = " you've submitted"; }
      } else if (user.role === "unit_head") {
        const uid = myUnitId(user);
        if (uid) { reports = reports.filter((r) => r.recipientUnitId === uid); scopeNote = " sent to you"; }
      }
      const scored = reports.filter((r) => r.score !== null);
      const avg = scored.length ? Math.round((scored.reduce((a, r) => a + (r.score ?? 0), 0) / scored.length) * 10) / 10 : 0;
      return `${reports.length} staff weekly reports${scopeNote}, ${scored.length} scored, average score ${avg}%.`;
    }
    case "unitHeadAppraisals": {
      let reports = await unitHeadAppraisalService.list();
      let scopeNote = "";
      if (user.role === "administration") {
        reports = reports.filter((r) => r.recipient === "Administration Office");
        scopeNote = " sent to Administration";
      } else if (user.role === "programme_head") {
        reports = reports.filter((r) => r.recipient.startsWith(user.name));
        scopeNote = " sent to you";
      }
      const pending = reports.filter((r) => r.status === "submitted").length;
      return `${reports.length} Unit Head performance reports${scopeNote}, ${pending} awaiting evaluation.`;
    }
    case "users": {
      const users = await userService.list();
      return `${users.length} user accounts, ${users.filter((u) => u.status === "active").length} active.`;
    }
  }
}

export const aiService = {
  ask: async (query: string, user: User): Promise<{ answer: string; domains: DataDomain[]; denied: boolean }> => {
    const allowed = ROLE_DATA_ACCESS[user.role];
    const requested = detectDomains(query);

    if (requested.length === 0) {
      return latency({
        answer: "I can answer questions about KPIs, Programmes, operational plans, compliance, alerts, audit history, and appraisals — try asking about one of those.",
        domains: [], denied: false,
      }, 400);
    }

    const permitted = requested.filter((d) => allowed.includes(d));
    const blocked = requested.filter((d) => !allowed.includes(d));

    if (permitted.length === 0) {
      return latency({
        answer: `Your role doesn't have access to ${blocked.join(", ")} data, so I can't answer that. Ask about something within your access level instead.`,
        domains: [], denied: true,
      }, 400);
    }

    const parts = await Promise.all(permitted.map((d) => answerForDomain(d, user)));
    const answer = parts.join(" ") + (blocked.length ? ` (I skipped ${blocked.join(", ")} — outside your access level.)` : "");
    return latency({ answer, domains: permitted, denied: false }, 500);
  },
};
