// Q31: "This follows the org hierarchy rather than a flat distribution
// list: Unit Head → Sub-programme Head → Programme Head → Vice-Chancellor
// ... each level is notified because they are personally accountable for
// that result through their own performance contract, not just informed
// as a courtesy." A static escalationStep set once at alert creation
// doesn't capture that — an alert that sits unacknowledged should actually
// climb the chain over time. This computes the CURRENT step live from the
// alert's age, rather than trusting whatever was set when it was created.
import type { Alert } from "@/types/alert";

const ESCALATION_CHAIN = ["Unit Head", "Sub-programme Head", "Programme Head", "Vice-Chancellor"] as const;
const DAYS_PER_ESCALATION_STEP = 3;

export function currentEscalationStep(alert: Alert, now: Date = new Date()): Alert["escalationStep"] {
  const baseIndex = ESCALATION_CHAIN.indexOf(alert.escalationStep as (typeof ESCALATION_CHAIN)[number]);
  // Targets outside the hierarchy chain (e.g. Corporate Planning Unit) don't escalate.
  if (baseIndex === -1 || alert.acknowledged) return alert.escalationStep;

  const ageMs = now.getTime() - new Date(alert.createdAt).getTime();
  const ageDays = Math.max(0, Math.floor(ageMs / (1000 * 60 * 60 * 24)));
  const stepsUp = Math.floor(ageDays / DAYS_PER_ESCALATION_STEP);
  const newIndex = Math.min(ESCALATION_CHAIN.length - 1, baseIndex + stepsUp);
  return ESCALATION_CHAIN[newIndex];
}

export function hasAutoEscalated(alert: Alert, now: Date = new Date()): boolean {
  return currentEscalationStep(alert, now) !== alert.escalationStep;
}
