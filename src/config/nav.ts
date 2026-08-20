import {
  LayoutDashboard, Building2, Layers, MapPin, Target, ClipboardEdit, ShieldCheck,
  BarChart3, FileText, BellRing, ClipboardCheck, History, Users, Settings,
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
  items: NavItem[];
}

// Every item lists only the roles it's relevant to, matching the
// three-tier access model from the questionnaire (Q21): Council/VC
// read-only executive access, Sub-programme Reps data-entry, CPU/ICT full
// admin — with Programme Head and Sub-programme Head added for the
// cascading target-setting workflow (Q16), since neither of those roles
// is optional once targets actually cascade downward.
export const NAV: NavGroup[] = [
  {
    group: "Overview",
    items: [
      { to: "/dashboard", label: "Executive dashboard", icon: LayoutDashboard, roles: ["vc", "cpu"] },
    ],
  },
  {
    group: "Structure",
    items: [
      { to: "/programmes", label: "Programmes", icon: Building2, roles: ["vc", "council", "programme_head", "subprogramme_head", "subprogramme_rep", "cpu", "ict"] },
      { to: "/sub-programmes", label: "Sub-programmes", icon: Layers, roles: ["vc", "council", "programme_head", "subprogramme_head", "subprogramme_rep", "cpu", "ict"] },
      { to: "/units", label: "Organisational units", icon: MapPin, roles: ["vc", "programme_head", "subprogramme_head", "cpu", "ict"] },
    ],
  },
  {
    group: "Performance",
    items: [
      { to: "/kpis", label: "KPI management", icon: Target, roles: ["vc", "programme_head", "subprogramme_head", "cpu", "ict"] },
      { to: "/performance/submit", label: "Submit performance", icon: ClipboardEdit, roles: ["subprogramme_rep", "subprogramme_head", "ict"] },
      { to: "/performance/review", label: "CPU validation & approval", icon: ShieldCheck, roles: ["cpu", "ict"] },
      { to: "/analytics", label: "Performance analytics", icon: BarChart3, roles: ["vc", "council", "programme_head", "subprogramme_head", "cpu", "ict"] },
    ],
  },
  {
    group: "Reporting & compliance",
    items: [
      { to: "/reports", label: "Reports", icon: FileText, roles: ["vc", "council", "programme_head", "subprogramme_head", "cpu", "ict"] },
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
  vc: "/dashboard",
  council: "/reports",
  programme_head: "/programmes",
  subprogramme_head: "/kpis",
  subprogramme_rep: "/performance/submit",
  cpu: "/performance/review",
  ict: "/kpis",
};
