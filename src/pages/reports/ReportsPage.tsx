import { useState } from "react";
import { FileText, Download, Eye } from "lucide-react";
import { useReports, useExportReport } from "@/hooks/useReports";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogContent } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import type { ReportItem } from "@/types/report";

const REPORT_TYPES = [
  "Monthly Performance Report", "Quarterly Performance Report", "Bi-annual Performance Report", "Annual Performance Report",
  "KPI Achievement Report", "Programme Performance Report", "Sub-programme Performance Report",
  "Submission Compliance Report", "Underperformance Report", "Audit Report",
];

export default function ReportsPage() {
  const { data: reports = [], isLoading } = useReports();
  const exportReport = useExportReport();
  const { toast } = useToast();
  const [preview, setPreview] = useState<ReportItem | null>(null);

  async function handleExport(report: ReportItem) {
    await exportReport.mutateAsync({ id: report.id, format: report.format });
    toast({ title: "Export queued", description: `${report.title} will be ready shortly (mock — backend not yet connected).`, kind: "info" });
  }

  const columns: Column<ReportItem>[] = [
    { key: "title", header: "Report", sortValue: (r) => r.title, render: (r) => (
      <div className="flex items-center gap-2"><FileText size={14} className="shrink-0 text-slate-400" /><span className="font-medium text-slate-800">{r.title}</span></div>
    ) },
    { key: "type", header: "Type", render: (r) => <span className="text-xs text-slate-500">{r.type}</span> },
    { key: "period", header: "Period", render: (r) => r.period },
    { key: "generatedAt", header: "Generated", sortValue: (r) => r.generatedAt, render: (r) => r.generatedAt },
    { key: "format", header: "Format", render: (r) => r.format },
    { key: "actions", header: "", render: (r) => (
      <div className="flex justify-end gap-1">
        <Button variant="ghost" size="sm" onClick={() => setPreview(r)}><Eye size={12} /> Preview</Button>
        <Button variant="outline" size="sm" onClick={() => handleExport(r)}><Download size={12} /> Export</Button>
      </div>
    ), align: "right" },
  ];

  return (
    <div className="space-y-5">
      <div>
        <Breadcrumbs items={["Reporting", "Reports"]} />
        <h1 className="text-lg font-medium text-slate-900 dark:text-slate-100">Reports</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Auto-generated directly from monthly-fed KPI data across all supported report types</p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {REPORT_TYPES.map((t) => <span key={t} className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-500">{t}</span>)}
      </div>

      <DataTable columns={columns} rows={reports} pageSize={10} loading={isLoading} />

      {preview && (
        <Dialog open onOpenChange={(open) => !open && setPreview(null)}>
          <DialogContent title={preview.title}>
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div><p className="text-slate-400">Type</p><p className="text-slate-700">{preview.type}</p></div>
                <div><p className="text-slate-400">Period</p><p className="text-slate-700">{preview.period}</p></div>
                <div><p className="text-slate-400">Generated</p><p className="text-slate-700">{preview.generatedAt}</p></div>
                <div><p className="text-slate-400">Format</p><p className="text-slate-700">{preview.format}</p></div>
              </div>
              <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-xs text-slate-400">
                Full report preview renders here once the reporting API is connected.
              </div>
              <div className="flex justify-end"><Button size="sm" onClick={() => handleExport(preview)}><Download size={12} /> Export {preview.format}</Button></div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
