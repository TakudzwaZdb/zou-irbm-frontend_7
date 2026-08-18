import type { ReactNode } from "react";
import zouLogo from "@/assets/zou-logo.png";

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-indigo-950 p-4">
      <img
        src={zouLogo}
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 w-[140%] max-w-none -translate-x-1/2 -translate-y-1/2 opacity-[0.06] sm:w-[90%]"
      />
      <div className="relative w-full max-w-2xl">
        <div className="mb-7 flex flex-col items-center gap-5 text-center">
          <div className="w-full rounded-2xl bg-white p-4 shadow-[0_0_45px_rgba(99,102,241,0.6)]">
            <img src={zouLogo} alt="Zimbabwe Open University" className="h-auto w-full" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold uppercase leading-snug tracking-wide text-white [text-shadow:0_0_16px_rgba(165,180,252,0.9),0_0_36px_rgba(99,102,241,0.6)] sm:text-3xl">
              Integrated Result Based Management System
            </h1>
            <p className="mt-3 text-sm italic text-indigo-300">&ldquo;Empowerment Through Open Learning&rdquo;</p>
          </div>
        </div>
        <div className="mx-auto max-w-sm rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900">{children}</div>
      </div>
    </div>
  );
}
