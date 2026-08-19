import {
  LayoutDashboard, Building2, Layers, MapPin, Target, ClipboardEdit, ShieldCheck,
  BarChart3, FileText, BellRing, ClipboardCheck, History, Users, Settings,
  ClipboardList, UserCog, ClipboardCheck as EvalIcon, FolderKanban, Gauge, Sparkles,
} from "lucide-react";
import type { Role } from "@/types/user";

export interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  roles: Role[]; // roles allowed to see this item
}

export interface NavGroup {
  group: string;
  // Marks the group as the signed-in user's own step-by-step workflow —
  // rendered with numbered badges and a highlighted container in the
  // sidebar, since it's the most relevant section for that role.
  workflow?: boolean;
  items: NavItem[];
}

// Each item lists only the roles it is actually relevant to — no blanket
// "every role sees everything" group. Groups are ordered to read as a
// hierarchy: what's mine to act on first, then the org structure it sits
// in, then performance/reporting, then admin.
export const NAV: NavGroup[] = [
  {
    group: "Overview",
    items: [
      { to: "/dashboard", label: "Executive dashboard", icon: LayoutDashboard, roles: ["vc", "cpu"] },
      { to: "/cpu/dashboard", label: "CPU dashboard", icon: Gauge, roles: ["cpu", "ict"] },
      { to: "/assistant", label: "AI Assistant", icon: Sparkles, roles: ["staff", "unit_head", "administration", "vc", "council", "programme_head", "subprogramme_head", "subprogramme_rep", "cpu", "ict"] },
    ],
  },
  {
    group: "Your workflow",
    workflow: true,
    items: [
      { to: "/appraisal/staff-report", label: "Submit weekly report", icon: ClipboardList, roles: ["staff"] },
      { to: "/appraisal/unit-head-review", label: "Appraise staff reports", icon: ShieldCheck, roles: ["unit_head"] },
      { to: "/appraisal/unit-head-performance", label: "Submit my performance report", icon: UserCog, roles: ["unit_head"] },
      { to: "/appraisal/administration-evaluation", label: "Evaluate Unit Heads", icon: EvalIcon, roles: ["administration"] },
      { to: "/appraisal/programme-head-evaluation", label: "Evaluate Unit Heads", icon: EvalIcon, roles: ["programme_head"] },
      { to: "/appraisal/operational-plans", label: "Operational plans", icon: FolderKanban, roles: ["unit_head", "programme_head", "vc", "council", "cpu", "ict"] },
    ],
  },
  {
    group: "Organisation",
    items: [
      { to: "/programmes", label: "Programmes", icon: Building2, roles: ["vc", "council", "programme_head", "subprogramme_head", "subprogramme_rep", "cpu", "ict"] },
      { to: "/sub-programmes", label: "Sub-programmes", icon: Layers, roles: ["vc", "council", "programme_head", "subprogramme_head", "subprogramme_rep", "cpu", "ict"] },
      { to: "/units", label: "Organisational units", icon: MapPin, roles: ["vc", "programme_head", "subprogramme_head", "unit_head", "cpu", "ict"] },
    ],
  },
  {
    group: "Performance & reporting",
    items: [
      { to: "/kpis", label: "KPI management", icon: Target, roles: ["vc", "programme_head", "subprogramme_head", "cpu", "ict"] },
      { to: "/performance/submit", label: "Submit performance", icon: ClipboardEdit, roles: ["subprogramme_rep", "subprogramme_head", "ict"] },
      { to: "/performance/review", label: "CPU validation & approval", icon: ShieldCheck, roles: ["cpu", "ict"] },
      { to: "/analytics", label: "Performance analytics", icon: BarChart3, roles: ["vc", "council", "programme_head", "subprogramme_head", "cpu", "ict"] },
      { to: "/reports", label: "Reports", icon: FileText, roles: ["vc", "council", "programme_head", "subprogramme_head", "administration", "cpu", "ict"] },
      { to: "/alerts", label: "Alerts & escalation", icon: BellRing, roles: ["vc", "programme_head", "subprogramme_head", "cpu", "ict"] },
      { to: "/compliance", label: "Submission compliance", icon: ClipboardCheck, roles: ["vc", "programme_head", "subprogramme_head", "cpu", "ict"] },
      { to: "/audit", label: "Audit trail", icon: History, roles: ["cpu", "ict", "vc"] },
    ],
  },
  {
    group: "Administration",
    items: [
      { to: "/users", label: "Users & roles", icon: Users, roles: ["ict", "cpu"] },
      { to: "/settings", label: "System settings", icon: Settings, roles: ["ict", "cpu"] },
    ],
  },
];

// Where each role lands after login / when hitting a route they can't see.
export const DEFAULT_ROUTE: Record<Role, string> = {
  staff: "/appraisal/staff-report",
  unit_head: "/appraisal/unit-head-review",
  administration: "/appraisal/administration-evaluation",
  vc: "/dashboard",
  council: "/appraisal/operational-plans",
  programme_head: "/programmes",
  subprogramme_head: "/kpis",
  subprogramme_rep: "/performance/submit",
  cpu: "/cpu/dashboard",
  ict: "/cpu/dashboard",
};
