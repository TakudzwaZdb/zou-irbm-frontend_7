import { Plus } from "lucide-react";
import { useUsers } from "@/hooks/useUsers";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { ROLE_LABEL } from "@/config/roleLabels";
import { initials } from "@/utils/format";
import type { User } from "@/types/user";

export default function UsersPage() {
  const { data: users = [], isLoading } = useUsers();

  const columns: Column<User>[] = [
    { key: "name", header: "User", sortValue: (u) => u.name, render: (u) => (
      <div className="flex items-center gap-2.5">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-100 text-[11px] font-medium text-indigo-700">{initials(u.name)}</div>
        <div><p className="font-medium text-slate-800">{u.name}</p><p className="text-[11px] text-slate-400">{u.email}</p></div>
      </div>
    ) },
    { key: "role", header: "Role", sortValue: (u) => u.role, render: (u) => <Badge>{ROLE_LABEL[u.role]}</Badge> },
    { key: "unit", header: "Unit", render: (u) => u.unit },
    { key: "status", header: "Status", render: (u) => <Badge variant={u.status === "active" ? "success" : "default"}>{u.status === "active" ? "Active" : "Suspended"}</Badge> },
    { key: "lastLogin", header: "Last login", sortValue: (u) => u.lastLogin, render: (u) => <span className="text-xs text-slate-400">{u.lastLogin}</span> },
    { key: "actions", header: "", render: () => <Button variant="ghost" size="sm">Manage</Button>, align: "right" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <Breadcrumbs items={["Administration", "Users & roles"]} />
          <h1 className="text-lg font-medium text-slate-900 dark:text-slate-100">Users &amp; roles</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Role-based navigation and permissions for all seven ZOU IRBM user roles</p>
        </div>
        <Button><Plus size={14} /> Invite user</Button>
      </div>

      <DataTable columns={columns} rows={users} pageSize={10} loading={isLoading} />
    </div>
  );
}
