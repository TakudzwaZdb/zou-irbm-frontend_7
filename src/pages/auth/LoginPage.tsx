import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { loginSchema, type LoginFormValues } from "@/forms/loginSchema";
import { useAuth } from "@/context/AuthContext";
import { AuthLayout } from "@/layouts/AuthLayout";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { FormField } from "@/components/ui/FormField";
import { ROLE_LABEL } from "@/config/roleLabels";
import type { Role } from "@/types/user";
import { useToast } from "@/components/ui/Toast";

const DEMO_ROLES: Role[] = ["staff", "unit_head", "administration", "vc", "programme_head", "subprogramme_head", "subprogramme_rep", "cpu", "ict"];

export default function LoginPage() {
  const { login, loginAsRole } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register, handleSubmit, formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({ resolver: zodResolver(loginSchema) });

  async function onSubmit(values: LoginFormValues) {
    setServerError(null);
    try {
      await login(values.email, values.password);
      navigate("/dashboard");
    } catch (e) {
      setServerError(e instanceof Error ? e.message : "Login failed.");
    }
  }

  async function quickLogin(role: Role) {
    await loginAsRole(role);
    toast({ title: "Signed in", description: `Viewing as ${ROLE_LABEL[role]}`, kind: "success" });
    navigate("/dashboard");
  }

  return (
    <AuthLayout>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <h1 className="text-sm font-medium text-slate-900 dark:text-slate-100">Sign in</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">Use your ZOU credentials to access the dashboard.</p>
        </div>

        <FormField label="Email" error={errors.email?.message}>
          <Input type="email" placeholder="you@zou.ac.zw" {...register("email")} error={!!errors.email} />
        </FormField>
        <FormField label="Password" error={errors.password?.message} hint="Demo password: zou-demo-2026">
          <Input type="password" placeholder="••••••••" {...register("password")} error={!!errors.password} />
        </FormField>

        {serverError && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600">{serverError}</p>}

        <Button type="submit" disabled={isSubmitting} className="w-full justify-center">
          {isSubmitting ? "Signing in…" : "Sign in"}
        </Button>

        <div className="relative py-1 text-center">
          <span className="bg-white px-2 text-[10px] uppercase tracking-wide text-slate-400 dark:bg-slate-900 dark:text-slate-500">Or preview as a role</span>
          <div className="absolute left-0 right-0 top-1/2 -z-10 h-px bg-slate-200" />
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          {DEMO_ROLES.map((role) => (
            <button
              key={role}
              type="button"
              onClick={() => quickLogin(role)}
              className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-medium text-slate-600 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-indigo-950 dark:hover:text-indigo-300"
            >
              {ROLE_LABEL[role]}
            </button>
          ))}
        </div>
      </form>
    </AuthLayout>
  );
}
