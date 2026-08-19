import { useState } from "react";
import { Paperclip, X, AlertTriangle } from "lucide-react";

const MAX_SIZE_MB = 10;
const ACCEPTED_EXTENSIONS = [".pdf", ".doc", ".docx", ".jpg", ".jpeg", ".png"];

export function FileAttachmentField({
  file, onChange, required,
}: { file: File | null; onChange: (f: File | null) => void; required?: boolean }) {
  const [error, setError] = useState<string | null>(null);

  function handleFile(selected: File | null) {
    if (!selected) {
      setError(null);
      onChange(null);
      return;
    }
    const ext = `.${selected.name.split(".").pop()?.toLowerCase()}`;
    if (!ACCEPTED_EXTENSIONS.includes(ext)) {
      setError(`Unsupported file type — use ${ACCEPTED_EXTENSIONS.join(", ")}`);
      onChange(null);
      return;
    }
    if (selected.size > MAX_SIZE_MB * 1024 * 1024) {
      setError(`File is too large — maximum ${MAX_SIZE_MB} MB`);
      onChange(null);
      return;
    }
    setError(null);
    onChange(selected);
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <label className="flex flex-1 cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2.5 text-xs text-slate-500 transition-colors hover:border-indigo-300 hover:bg-indigo-50/40 dark:border-slate-700 dark:text-slate-400 dark:hover:border-indigo-600 dark:hover:bg-indigo-950/40">
          <Paperclip size={14} className="shrink-0" />
          <span className="truncate">{file ? file.name : required ? "Attach the document (required)" : "Attach a document"}</span>
          <input type="file" accept={ACCEPTED_EXTENSIONS.join(",")} className="hidden" onChange={(e) => handleFile(e.target.files?.[0] ?? null)} />
        </label>
        {file && (
          <button type="button" onClick={() => handleFile(null)} className="shrink-0 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-rose-600 dark:hover:bg-slate-800" aria-label="Remove attachment">
            <X size={14} />
          </button>
        )}
      </div>
      {error ? (
        <p className="mt-1 flex items-center gap-1 text-xs text-rose-600"><AlertTriangle size={11} /> {error}</p>
      ) : (
        <p className="mt-1 text-[11px] text-slate-400">PDF, Word, or image · up to {MAX_SIZE_MB} MB</p>
      )}
    </div>
  );
}
