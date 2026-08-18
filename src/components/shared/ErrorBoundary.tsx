import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

interface Props { children: ReactNode }
interface State { hasError: boolean }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // In production this is where you'd forward to an error-tracking service.
    console.error("Unhandled UI error:", error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6 dark:bg-slate-950">
        <div className="max-w-sm rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <AlertTriangle size={22} className="mx-auto mb-3 text-rose-400" />
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Something went wrong</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            This screen hit an unexpected error. Reloading usually fixes it.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
