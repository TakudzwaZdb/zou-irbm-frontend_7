import { useApp } from '../context/AppContext.jsx';

// Shows the live submission-window state for whichever period is currently
// selected (see AppContext's submissionWindow / backend's GET
// /kpis/submission-window) — nothing when the window is plainly open (the
// common case shouldn't need a banner), a warning while it's not yet open
// or in the late-but-accepted grace window, and a critical banner once it's
// closed outright. This is what lets someone see BEFORE they try to submit
// why the button below is disabled, rather than only after a rejected
// request.
export default function SubmissionWindowBanner() {
  const { submissionWindow: win } = useApp();
  if (!win || win.status === 'open') return null;

  if (win.status === 'late') {
    return (
      <div className="mb-4 rounded-lg bg-warning-soft text-warning text-[12.8px] px-3.5 py-2.5 font-semibold">
        Late-submission grace window — anything submitted now for this period is accepted, but flagged late.
      </div>
    );
  }

  const tone = win.status === 'closed' ? 'bg-critical-soft text-critical' : 'bg-warning-soft text-warning';
  return (
    <div className={`mb-4 rounded-lg ${tone} text-[12.8px] px-3.5 py-2.5 font-semibold`}>
      {win.message || (win.status === 'not_open' ? 'Submissions are not open yet for this period.' : 'Submissions are closed for this period.')}
      {' '}Saving a draft is still fine — only submitting for review is affected.
    </div>
  );
}
