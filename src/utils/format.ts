export function formatValue(value: number, unit: "%" | "count" | "number"): string {
  if (unit === "%") return `${value}%`;
  if (unit === "number") return value.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  return value.toLocaleString();
}

export function progressPct(baseline: number, target: number, actual: number): number {
  const p = (actual - baseline) / (target - baseline || 1);
  return Math.max(0, Math.min(100, Math.round(p * 100)));
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function initials(name: string): string {
  return name
    .split(" ")
    .filter((w) => w.length > 1 || /[A-Za-z]/.test(w))
    .slice(0, 2)
    .map((w) => w.replace(/[^A-Za-z]/g, "")[0])
    .join("")
    .toUpperCase();
}
