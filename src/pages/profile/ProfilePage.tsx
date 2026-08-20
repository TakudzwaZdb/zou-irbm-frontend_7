import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { Resolver } from "react-hook-form";
import { UserCircle2 } from "lucide-react";
import { profileSchema, type ProfileFormValues } from "@/forms/profileSchema";
import { useAuth } from "@/context/AuthContext";
import { useUpdateUser } from "@/hooks/useUsers";
import { orgUnits } from "@/data/organisation";
import { ROLE_LABEL } from "@/config/roleLabels";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { FormField } from "@/components/ui/FormField";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";
import { initials } from "@/utils/format";
import type { Role } from "@/types/user";

const ALL_ROLES: Role[] = ["vc", "council", "programme_head", "subprogramme_head", "subprogramme_rep", "cpu", "ict"];

export default function ProfilePage() {
  const { user, updateCurrentUser } = useAuth();
  const { toast } = useToast();
  const updateUser = useUpdateUser();

  const currentStation = orgUnits.find((u) => u.id === user?.stationId);

  const { register, handleSubmit, control, formState: { errors, isSubmitting } } = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema) as Resolver<ProfileFormValues>,
    defaultValues: {
      name: user?.name ?? "",
      email: user?.email ?? "",
      role: user?.role ?? "subprogramme_rep",
      stationId: user?.stationId ?? "",
    },
  });

  async function onSubmit(values: ProfileFormValues) {
    if (!user) return;
    const station = orgUnits.find((u) => u.id === values.stationId);
    const changes = { name: values.name, email: values.email, role: values.role, stationId: values.stationId, unit: station?.name ?? user.unit };
    await updateUser.mutateAsync({ id: user.id, changes, updatedBy: user.name });
    updateCurrentUser(changes);
    toast({ title: "Profile updated", description: "Your details have been saved.", kind: "success" });
  }

  if (!user) return null;

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <Breadcrumbs items={["Account", "My profile"]} />
        <h1 className="text-lg font-medium text-slate-900 dark:text-slate-100">My profile</h1>
        <p className="text-sm leading-relaxed text-slate-500 dark:text-slate-400">
          Your registration details — full name, email, role, and station (Regional Campus, Department, Directorate,
          or Faculty).
        </p>
      </div>

      <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
          {initials(user.name)}
        </div>
        <div>
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{user.name}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">{ROLE_LABEL[user.role]} · {currentStation ? `${currentStation.name} (${currentStation.type})` : "No station set"}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-1 flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-slate-100">
          <UserCircle2 size={16} className="text-slate-400" /> Registration details
        </div>

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
              <SelectContent>
                {ALL_ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>)}
              </SelectContent>
            </Select>
          )} />
        </FormField>

        <FormField label="Station" error={errors.stationId?.message} hint="Your Regional Campus, Department, Directorate, or Faculty">
          <Controller name="stationId" control={control} render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger><SelectValue placeholder="Select your station" /></SelectTrigger>
              <SelectContent>
                {orgUnits.map((u) => <SelectItem key={u.id} value={u.id}>{u.name} ({u.type})</SelectItem>)}
              </SelectContent>
            </Select>
          )} />
        </FormField>

        <div className="flex justify-end pt-2">
          <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Saving…" : "Save changes"}</Button>
        </div>
      </form>
    </div>
  );
}
