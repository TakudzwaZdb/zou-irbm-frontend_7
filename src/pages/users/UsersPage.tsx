import { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { Resolver } from "react-hook-form";
<<<<<<< HEAD
import { CheckCircle2, Plus, XCircle } from "lucide-react";
import { useUsers, useCreateUser, useApproveUser, useRejectUser } from "@/hooks/useUsers";
=======
import { Plus } from "lucide-react";
import { useUsers, useCreateUser } from "@/hooks/useUsers";
>>>>>>> 7766e67ea15f7e1d0e6c85da5d24ea3d8fc97fe3
import { useAuth } from "@/context/AuthContext";
import { profileSchema, type ProfileFormValues } from "@/forms/profileSchema";
import { orgUnits } from "@/data/organisation";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
<<<<<<< HEAD
import { Textarea } from "@/components/ui/Textarea";
=======
>>>>>>> 7766e67ea15f7e1d0e6c85da5d24ea3d8fc97fe3
import { FormField } from "@/components/ui/FormField";
import { Dialog, DialogContent } from "@/components/ui/Dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";
import { ROLE_LABEL } from "@/config/roleLabels";
import { initials } from "@/utils/format";
import type { User, Role } from "@/types/user";

const ALL_ROLES: Role[] = ["staff", "unit_head", "administration", "vc", "council", "programme_head", "subprogramme_head", "subprogramme_rep", "cpu", "ict"];

<<<<<<< HEAD
const STATUS_VARIANT: Record<User["status"], "success" | "warning" | "default" | "danger"> = {
  active: "success", pending: "warning", suspended: "default", rejected: "danger",
};
const STATUS_LABEL: Record<User["status"], string> = {
  active: "Active", pending: "Pending approval", suspended: "Suspended", rejected: "Rejected",
};

=======
>>>>>>> 7766e67ea15f7e1d0e6c85da5d24ea3d8fc97fe3
function RegisterUserDialog({ onClose }: { onClose: () => void }) {
  const { user: currentUser } = useAuth();
  const { toast } = useToast();
  const createUser = useCreateUser();
  const { register, handleSubmit, control, formState: { errors, isSubmitting } } = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema) as Resolver<ProfileFormValues>,
    defaultValues: { role: "staff" },
  });

  async function onSubmit(values: ProfileFormValues) {
    const station = orgUnits.find((u) => u.id === values.stationId);
<<<<<<< HEAD
    // Created directly by an admin, so it's active immediately — an admin
    // creating the account already is the approval. Self-registration via
    // /register is what lands in the pending queue below instead.
=======
>>>>>>> 7766e67ea15f7e1d0e6c85da5d24ea3d8fc97fe3
    await createUser.mutateAsync({
      payload: { name: values.name, email: values.email, role: values.role, stationId: values.stationId, unit: station?.name ?? "" },
      createdBy: currentUser?.name ?? "Administrator",
    });
<<<<<<< HEAD
    toast({ title: "User registered", description: `${values.name} can sign in immediately.`, kind: "success" });
=======
    toast({ title: "User registered", description: `${values.name} can now sign in.`, kind: "success" });
>>>>>>> 7766e67ea15f7e1d0e6c85da5d24ea3d8fc97fe3
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title="Register a new user">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <FormField label="Full name" error={errors.name?.message}>
            <Input placeholder="e.g. T. Marufu" {...register("name")} error={!!errors.name} />
          </FormField>
          <FormField label="Email" error={errors.email?.message}>
            <Input type="email" placeholder="you@zou.ac.zw" {...register("email")} error={!!errors.email} />
          </FormField>
          <FormField label="Role" error={errors.role?.message}>
            <Controller name="role" control={control} render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{ALL_ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>)}</SelectContent>
              </Select>
            )} />
          </FormField>
          <FormField label="Station" error={errors.stationId?.message} hint="Regional Campus, Department, Directorate, or Faculty">
            <Controller name="stationId" control={control} render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger><SelectValue placeholder="Select a station" /></SelectTrigger>
                <SelectContent>{orgUnits.map((u) => <SelectItem key={u.id} value={u.id}>{u.name} ({u.type})</SelectItem>)}</SelectContent>
              </Select>
            )} />
          </FormField>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Registering…" : "Register user"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
<<<<<<< HEAD

function RejectControl({ onReject }: { onReject: (reason: string) => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!open) {
    return <Button size="sm" variant="outline" onClick={() => setOpen(true)}><XCircle size={13} /> Reject</Button>;
  }
  return (
    <div className="flex flex-1 items-end gap-2">
      <div className="flex-1"><Textarea rows={1} placeholder="Reason for declining this registration…" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
      <Button size="sm" variant="destructive" disabled={!reason.trim()} onClick={() => { onReject(reason); setOpen(false); setReason(""); }}>Confirm reject</Button>
    </div>
  );
}

function PendingRow({ pendingUser }: { pendingUser: User }) {
  const { user: currentUser } = useAuth();
  const { toast } = useToast();
  const approve = useApproveUser();
  const reject = useRejectUser();
  const station = orgUnits.find((u) => u.id === pendingUser.stationId);

  async function handleApprove() {
    await approve.mutateAsync({ id: pendingUser.id, approvedBy: currentUser?.name ?? "Administrator" });
    toast({ title: "Account approved", description: `${pendingUser.name} can now sign in.`, kind: "success" });
  }

  async function handleReject(reason: string) {
    await reject.mutateAsync({ id: pendingUser.id, rejectedBy: currentUser?.name ?? "Administrator", reason });
    toast({ title: "Registration declined", kind: "info" });
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 dark:border-amber-900 dark:bg-amber-950/30">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-xs font-medium text-amber-700 dark:bg-amber-900 dark:text-amber-300">{initials(pendingUser.name)}</div>
          <div>
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{pendingUser.name}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">{pendingUser.email} · requesting {ROLE_LABEL[pendingUser.role]}{station && ` · ${station.name} (${station.type})`}</p>
          </div>
        </div>
        <Badge variant="warning">Pending approval</Badge>
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <Button size="sm" onClick={handleApprove}><CheckCircle2 size={13} /> Approve</Button>
        <RejectControl onReject={handleReject} />
      </div>
    </div>
  );
}
=======
>>>>>>> 7766e67ea15f7e1d0e6c85da5d24ea3d8fc97fe3

export default function UsersPage() {
  const { data: users = [], isLoading } = useUsers();
  const [registerOpen, setRegisterOpen] = useState(false);
<<<<<<< HEAD

  const pending = users.filter((u) => u.status === "pending");
=======
>>>>>>> 7766e67ea15f7e1d0e6c85da5d24ea3d8fc97fe3

  const columns: Column<User>[] = [
    { key: "name", header: "User", sortValue: (u) => u.name, render: (u) => (
      <div className="flex items-center gap-2.5">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-100 text-[11px] font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">{initials(u.name)}</div>
        <div><p className="font-medium text-slate-800 dark:text-slate-200">{u.name}</p><p className="text-[11px] text-slate-500 dark:text-slate-400">{u.email}</p></div>
      </div>
    ) },
    { key: "role", header: "Role", sortValue: (u) => u.role, render: (u) => <Badge>{ROLE_LABEL[u.role]}</Badge> },
    { key: "unit", header: "Station", render: (u) => u.unit || <span className="text-slate-400">Not set</span> },
<<<<<<< HEAD
    { key: "status", header: "Status", render: (u) => <Badge variant={STATUS_VARIANT[u.status]}>{STATUS_LABEL[u.status]}</Badge> },
=======
    { key: "status", header: "Status", render: (u) => <Badge variant={u.status === "active" ? "success" : "default"}>{u.status === "active" ? "Active" : "Suspended"}</Badge> },
>>>>>>> 7766e67ea15f7e1d0e6c85da5d24ea3d8fc97fe3
    { key: "lastLogin", header: "Last login", sortValue: (u) => u.lastLogin, render: (u) => <span className="text-xs text-slate-400">{u.lastLogin}</span> },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <Breadcrumbs items={["Administration", "Users & roles"]} />
          <h1 className="text-lg font-medium text-slate-900 dark:text-slate-100">Users &amp; roles</h1>
          <p className="text-sm leading-relaxed text-slate-500 dark:text-slate-400">Role-based navigation and permissions across all ten ZOU IRBM user roles</p>
        </div>
        <Button onClick={() => setRegisterOpen(true)}><Plus size={14} /> Register user</Button>
      </div>

<<<<<<< HEAD
      <div>
        <p className="mb-3 text-sm font-medium text-slate-900 dark:text-slate-100">Pending approval ({pending.length})</p>
        {pending.length === 0 ? (
          <EmptyState title="No registrations awaiting approval" message="New self-registrations from the login screen will appear here." />
        ) : (
          <div className="space-y-3">{pending.map((u) => <PendingRow key={u.id} pendingUser={u} />)}</div>
        )}
      </div>

      <div>
        <p className="mb-3 text-sm font-medium text-slate-900 dark:text-slate-100">All users</p>
        <DataTable columns={columns} rows={users} pageSize={10} loading={isLoading} />
      </div>
=======
      <DataTable columns={columns} rows={users} pageSize={10} loading={isLoading} />
>>>>>>> 7766e67ea15f7e1d0e6c85da5d24ea3d8fc97fe3

      {registerOpen && <RegisterUserDialog onClose={() => setRegisterOpen(false)} />}
    </div>
  );
}
