import { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { Resolver } from "react-hook-form";
import { Plus } from "lucide-react";
import { useUsers, useCreateUser } from "@/hooks/useUsers";
import { useAuth } from "@/context/AuthContext";
import { profileSchema, type ProfileFormValues } from "@/forms/profileSchema";
import { orgUnits } from "@/data/organisation";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { FormField } from "@/components/ui/FormField";
import { Dialog, DialogContent } from "@/components/ui/Dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";
import { ROLE_LABEL } from "@/config/roleLabels";
import { initials } from "@/utils/format";
import type { User, Role } from "@/types/user";

const ALL_ROLES: Role[] = ["vc", "council", "programme_head", "subprogramme_head", "subprogramme_rep", "cpu", "ict"];

function RegisterUserDialog({ onClose }: { onClose: () => void }) {
  const { user: currentUser } = useAuth();
  const { toast } = useToast();
  const createUser = useCreateUser();
  const { register, handleSubmit, control, formState: { errors, isSubmitting } } = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema) as Resolver<ProfileFormValues>,
    defaultValues: { role: "subprogramme_rep" },
  });

  async function onSubmit(values: ProfileFormValues) {
    const station = orgUnits.find((u) => u.id === values.stationId);
    await createUser.mutateAsync({
      payload: { name: values.name, email: values.email, role: values.role, stationId: values.stationId, unit: station?.name ?? "" },
      createdBy: currentUser?.name ?? "Administrator",
    });
    toast({ title: "User registered", description: `${values.name} can now sign in.`, kind: "success" });
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title="Register a new user">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <FormField label="Full name" error={errors.name?.message}>
            <Input placeholder="e.g. P. Ndlovu" {...register("name")} error={!!errors.name} />
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

export default function UsersPage() {
  const { data: users = [], isLoading } = useUsers();
  const [registerOpen, setRegisterOpen] = useState(false);

  const columns: Column<User>[] = [
    { key: "name", header: "User", sortValue: (u) => u.name, render: (u) => (
      <div className="flex items-center gap-2.5">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-100 text-[11px] font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">{initials(u.name)}</div>
        <div><p className="font-medium text-slate-800 dark:text-slate-200">{u.name}</p><p className="text-[11px] text-slate-500 dark:text-slate-400">{u.email}</p></div>
      </div>
    ) },
    { key: "role", header: "Role", sortValue: (u) => u.role, render: (u) => <Badge>{ROLE_LABEL[u.role]}</Badge> },
    { key: "unit", header: "Station", render: (u) => u.unit || <span className="text-slate-400">Not set</span> },
    { key: "status", header: "Status", render: (u) => <Badge variant={u.status === "active" ? "success" : "default"}>{u.status === "active" ? "Active" : "Suspended"}</Badge> },
    { key: "lastLogin", header: "Last login", sortValue: (u) => u.lastLogin, render: (u) => <span className="text-xs text-slate-400">{u.lastLogin}</span> },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <Breadcrumbs items={["Administration", "Users & roles"]} />
          <h1 className="text-lg font-medium text-slate-900 dark:text-slate-100">Users &amp; roles</h1>
          <p className="text-sm leading-relaxed text-slate-500 dark:text-slate-400">Three-tier access model: Council &amp; VC (read-only), Sub-programme Reps (data entry), CPU &amp; ICT (full admin)</p>
        </div>
        <Button onClick={() => setRegisterOpen(true)}><Plus size={14} /> Register user</Button>
      </div>

      <DataTable columns={columns} rows={users} pageSize={10} loading={isLoading} />

      {registerOpen && <RegisterUserDialog onClose={() => setRegisterOpen(false)} />}
    </div>
  );
}
