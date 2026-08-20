import { useState } from "react";
import { Link } from "react-router-dom";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { Resolver } from "react-hook-form";
import { CheckCircle2 } from "lucide-react";
import { registerSchema, type RegisterFormValues } from "@/forms/registerSchema";
import { useAuth } from "@/context/AuthContext";
import { orgUnits } from "@/data/organisation";
import { ROLE_LABEL } from "@/config/roleLabels";
import { AuthLayout } from "@/layouts/AuthLayout";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { FormField } from "@/components/ui/FormField";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/Select";
import type { Role } from "@/types/user";

const ALL_ROLES: Role[] = ["staff", "unit_head", "administration", "vc", "council", "programme_head", "subprogramme_head", "subprogramme_rep", "cpu", "ict"];

function PendingApprovalScreen({ email }: { email: string }) {
  return (
    <div className="space-y-4 text-center">
      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-950">
        <CheckCircle2 size={22} className="text-emerald-600 dark:text-emerald-400" />
      </div>
      <div>
        <h1 className="text-sm font-medium text-slate-900 dark:text-slate-100">Profile submitted</h1>
        <p className="mt-1.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          Your details have been sent to the Corporate Planning Unit for approval. Once approved, you'll be able to
          sign in with <span className="font-medium text-slate-700 dark:text-slate-300">{email}</span> and the
          password you just set.
        </p>
      </div>
      <Link to="/login">
        <Button variant="outline" className="w-full justify-center">Back to sign in</Button>
      </Link>
    </div>
  );
}

export default function RegisterPage() {
  const { register: registerAccount } = useAuth();
  const [serverError, setServerError] = useState<string | null>(null);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);

  const { register, handleSubmit, control, formState: { errors, isSubmitting } } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema) as Resolver<RegisterFormValues>,
    defaultValues: { role: "staff" },
  });

  async function onSubmit(values: RegisterFormValues) {
    setServerError(null);
    try {
      const station = orgUnits.find((u) => u.id === values.stationId);
      await registerAccount(
        { name: values.name, email: values.email, role: values.role, stationId: values.stationId, unit: station?.name ?? "" },
        values.password
      );
      setSubmittedEmail(values.email);
    } catch (e) {
      setServerError(e instanceof Error ? e.message : "Registration failed.");
    }
  }

  if (submittedEmail) {
    return (
      <AuthLayout>
        <PendingApprovalScreen email={submittedEmail} />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <h1 className="text-sm font-medium text-slate-900 dark:text-slate-100">Create your profile</h1>
          <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            Not in the system yet? Register below. Your work email doubles as your login, and the Corporate Planning
            Unit will need to approve your account before you can sign in.
          </p>
        </div>

        <FormField label="Full name" error={errors.name?.message}>
          <Input placeholder="e.g. T. Marufu" {...register("name")} error={!!errors.name} />
        </FormField>

        <FormField label="Work email" error={errors.email?.message} hint="This is what you'll sign in with">
          <Input type="email" placeholder="you@zou.ac.zw" {...register("email")} error={!!errors.email} />
        </FormField>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Password" error={errors.password?.message}>
            <Input type="password" placeholder="8+ characters" {...register("password")} error={!!errors.password} />
          </FormField>
          <FormField label="Confirm password" error={errors.confirmPassword?.message}>
            <Input type="password" placeholder="Repeat password" {...register("confirmPassword")} error={!!errors.confirmPassword} />
          </FormField>
        </div>

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

        {serverError && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600 dark:bg-rose-950 dark:text-rose-300">{serverError}</p>}

        <Button type="submit" disabled={isSubmitting} className="w-full justify-center">
          {isSubmitting ? "Submitting…" : "Submit for approval"}
        </Button>

        <p className="text-center text-xs text-slate-500 dark:text-slate-400">
          Already have an account?{" "}
          <Link to="/login" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">Sign in</Link>
        </p>
      </form>
    </AuthLayout>
  );
}
