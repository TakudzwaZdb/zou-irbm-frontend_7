import { useEffect, useRef, useState } from "react";
import { Bot, Send, Sparkles, ShieldAlert, User as UserIcon } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useAskAssistant } from "@/hooks/useAiAssistant";
import { ROLE_DATA_ACCESS } from "@/services/aiService";
import { ROLE_LABEL } from "@/config/roleLabels";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { Badge } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { ChatMessage } from "@/types/assistant";

const DOMAIN_LABEL: Record<string, string> = {
  kpis: "KPIs", programmes: "Programmes", operationalPlans: "Operational plans", compliance: "Compliance",
  audit: "Audit trail", alerts: "Alerts", staffAppraisals: "Staff appraisals", unitHeadAppraisals: "Unit Head appraisals", users: "Users",
};

const SUGGESTIONS: Record<string, string[]> = {
  cpu: ["How many KPIs are off track?", "What's our submission compliance rate?", "How many operational plans are pending validation?"],
  ict: ["Show me the audit trail summary", "How many active user accounts are there?"],
  vc: ["What's the overall KPI status?", "How many operational plans are awaiting my approval?"],
  programme_head: ["What KPIs are in my Programme?", "Are there Unit Head reports awaiting my evaluation?"],
  subprogramme_head: ["How are my KPIs performing?"],
  subprogramme_rep: ["What's the status of my KPI submissions?"],
  unit_head: ["What's the status of my operational plan?", "How many staff reports have I appraised?"],
  administration: ["How many Unit Head reports are pending evaluation?"],
  staff: ["What's the status of my weekly reports?"],
  council: ["How many operational plans are validated?"],
};

export default function AiAssistantPage() {
  const { user } = useAuth();
  const ask = useAskAssistant();
  const storageKey = user ? `zou_irbm_chat_${user.id}` : "";
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    if (!storageKey) return [];
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? (JSON.parse(raw) as ChatMessage[]) : [];
    } catch {
      return [];
    }
  });
  const [input, setInput] = useState("");
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!storageKey) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(messages));
    } catch {
      // storage full/unavailable — conversation just won't persist this time
    }
  }, [messages, storageKey]);

  const myAccess = user ? ROLE_DATA_ACCESS[user.role] : [];

  async function handleAsk(query: string) {
    if (!user || !query.trim()) return;
    const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: "user", content: query, timestamp: new Date().toLocaleTimeString() };
    setMessages((m) => [...m, userMsg]);
    setInput("");

    try {
      const result = await ask.mutateAsync({ query, user });
      const assistantMsg: ChatMessage = {
        id: `a-${Date.now()}`, role: "assistant", content: result.answer,
        timestamp: new Date().toLocaleTimeString(), domains: result.domains, denied: result.denied,
      };
      setMessages((m) => [...m, assistantMsg]);
    } catch {
      const errorMsg: ChatMessage = {
        id: `a-${Date.now()}`, role: "assistant",
        content: "Something went wrong answering that — please try again.",
        timestamp: new Date().toLocaleTimeString(), denied: true,
      };
      setMessages((m) => [...m, errorMsg]);
    }
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <Breadcrumbs items={["Assistant", "Ask ZOU IRBM AI"]} />
          <h1 className="text-lg font-medium text-slate-900 dark:text-slate-100">AI Assistant</h1>
          <p className="text-sm leading-relaxed text-slate-500 dark:text-slate-400">
            Ask questions in plain language — answers are scoped to what {ROLE_LABEL[user?.role ?? "staff"]} can see.
          </p>
        </div>
        {messages.length > 0 && (
          <button
            onClick={() => setConfirmClearOpen(true)}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            Clear conversation
          </button>
        )}
      </div>

      <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 dark:border-indigo-900 dark:bg-indigo-950">
        <p className="flex items-center gap-1.5 text-xs font-medium text-indigo-700 dark:text-indigo-300">
          <ShieldAlert size={13} /> Your access level
        </p>
        <p className="mt-1 text-xs leading-relaxed text-indigo-600 dark:text-indigo-400">
          {myAccess.length > 0
            ? `You can ask about: ${myAccess.map((d) => DOMAIN_LABEL[d]).join(", ")}.`
            : "No data domains are configured for your role yet."}
        </p>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-950">
              <Sparkles size={20} className="text-indigo-600 dark:text-indigo-400" />
            </div>
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Try one of these to get started</p>
            <div className="flex flex-wrap justify-center gap-2">
              {(SUGGESTIONS[user?.role ?? "staff"] ?? []).map((s) => (
                <button
                  key={s}
                  onClick={() => handleAsk(s)}
                  className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-indigo-950"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className={`flex gap-2.5 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
            <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${m.role === "user" ? "bg-slate-200 dark:bg-slate-700" : "bg-indigo-100 dark:bg-indigo-950"}`}>
              {m.role === "user" ? <UserIcon size={13} className="text-slate-600 dark:text-slate-300" /> : <Bot size={13} className="text-indigo-600 dark:text-indigo-400" />}
            </div>
            <div className={`max-w-[75%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed ${
              m.role === "user" ? "bg-indigo-600 text-white" : m.denied ? "bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300" : "bg-slate-50 text-slate-700 dark:bg-slate-800 dark:text-slate-200"
            }`}>
              <p>{m.content}</p>
              {m.domains && m.domains.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {m.domains.map((d) => <Badge key={d} variant="info" className="text-[10px]">{DOMAIN_LABEL[d]}</Badge>)}
                </div>
              )}
              <p className={`mt-1 text-[10px] ${m.role === "user" ? "text-indigo-200" : "text-slate-400"}`}>{m.timestamp}</p>
            </div>
          </div>
        ))}

        {ask.isPending && (
          <div className="flex gap-2.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-950">
              <Bot size={13} className="text-indigo-600 dark:text-indigo-400" />
            </div>
            <div className="rounded-xl bg-slate-50 px-3.5 py-2.5 text-sm text-slate-400 dark:bg-slate-800">Thinking…</div>
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); handleAsk(input); }}
        className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-2 shadow-sm dark:border-slate-800 dark:bg-slate-900"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about KPIs, plans, compliance, appraisals…"
          className="flex-1 bg-transparent px-2 text-sm text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-100"
        />
        <button
          type="submit"
          disabled={ask.isPending || !input.trim()}
          className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
        >
          <Send size={13} /> Ask
        </button>
      </form>

      <ConfirmDialog
        open={confirmClearOpen}
        onOpenChange={setConfirmClearOpen}
        title="Clear this conversation?"
        description="This removes every message in this chat. It can't be undone."
        confirmLabel="Clear conversation"
        destructive
        onConfirm={() => setMessages([])}
      />
    </div>
  );
}
