import { useEffect, useRef, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, ReferenceLine, Tooltip, XAxis, YAxis, ResponsiveContainer } from 'recharts';

// Reserved status colors again for the "Actual" bar (matches the RAG chips'
// meaning: on/ahead of pace reads good, behind pace reads critical) — the
// "Expected pace" bar stays a single neutral ink-muted tone throughout,
// since it's a reference line, not a status.
const FLAG_COLOR = { attention: '#d03b3b', ahead: '#0ca30c', 'on-pace': '#2f6fed', none: '#c7c4b8' };

// A tick with two lines instead of one: the KPI's own (truncated) name on
// top, who owns it underneath in a smaller, muted line — so a bar reads
// correctly on its own even once there are dozens of them side by side and
// several share a similar name (see the "owner" field VarianceChart's
// callers now attach — Overview.jsx's per-KPI variance list). Reads off
// `chartData` by index via closure rather than through recharts' own tick
// payload, since that only ever hands back the single dataKey value (here,
// `name`) — never the rest of that row's data.
function truncateLabel(text, max) {
  if (!text) return text;
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}
function makeOwnerTick(chartData) {
  return function OwnerTick({ x, y, payload }) {
    const item = chartData[payload.index];
    return (
      <g transform={`translate(${x},${y})`}>
        <text x={0} y={14} textAnchor="middle" fontSize={10.3} fill="var(--color-ink-secondary)">
          {truncateLabel(item?.name, 15)}
        </text>
        {/* The owner is the whole point of this second line — bumped up in
            size/weight and given the accent color (rather than a muted grey
            indistinguishable from surrounding chrome) so it reads as real,
            load-bearing information under every single bar, not a faint
            afterthought someone could miss entirely. */}
        {item?.owner && <text x={0} y={28} textAnchor="middle" fontSize={10.5} fontWeight={700} fill="var(--color-accent-600)">
          {truncateLabel(item.owner, 18)}
        </text>}
        {/* Third line: which tier that owner is (Individual / Unit /
            Sub-programme) — the piece that actually disambiguates two KPIs
            that share both a name AND, in a large org, an owner's first
            initial-plus-surname (e.g. two different Individuals each with
            their own "Vacuum Cleaning" duty KPI in two different Units). */}
        {item?.ownerKind && <text x={0} y={40} textAnchor="middle" fontSize={8.8} fill="var(--color-ink-muted)">
          {item.ownerKind}
        </text>}
      </g>
    );
  };
}

// Actual progress % vs the expected pace % for the same period (see
// lib/scope.js's varianceRollup) — one grouped bar pair per KPI (or, on
// Reports, per Programme). The gap between the two bars *is* the variance;
// a KPI whose Actual bar falls short of Expected by more than 10 points is
// colored critical, same threshold the attention alerts below use.
//
// Every KPI passed in gets its own pair of bars — this never drops or
// samples down to "fit" a fixed width. Once there are more KPIs than
// comfortably fit the card, the chart itself scrolls left/right (each KPI
// gets a fixed minimum slot width) rather than squeezing every bar and
// label into unreadable slivers; ResponsiveContainer still expands to fill
// the available width when there's room to spare, exactly as before, so a
// short list still looks exactly like it always did.
const MIN_SLOT_WIDTH = 112;
export default function VarianceChart({ data, height = 280 }) {
  const chartData = data.map((d) => ({ ...d, actual: d.actual ?? 0 }));
  const scrollRef = useRef(null);

  // Whether the chart is ACTUALLY wider than the card right now — measured
  // from the real DOM, not guessed from a KPI count. A fixed "more than N
  // KPIs" threshold is wrong on its own: the same 6 KPIs might fit fine on
  // a wide desktop monitor (no scroll needed, arrows would be a false
  // promise) but overflow on a narrower window, a resized sidebar, or a
  // phone (scroll IS needed, but a count-based check could have missed it
  // and hidden the arrows/hint that would've made that discoverable — this
  // is the likely reason the arrows were reported missing on some KPI
  // counts even though the underlying scroll worked once tried). This
  // re-measures on mount, whenever the number of bars changes, and on
  // every resize of the chart's own box (a ResizeObserver on the scroll
  // container itself, not just the window — catches a sidebar toggle or a
  // parent layout change too, not only a browser resize).
  const [overflowing, setOverflowing] = useState(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    function measure() {
      setOverflowing(el.scrollWidth > el.clientWidth + 1); // +1: ignore sub-pixel rounding
    }
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [chartData.length]);

  // A plain vertical mouse wheel does NOT scroll a horizontally-overflowing
  // div by default in any browser — only an explicit shift+wheel, a
  // trackpad's horizontal swipe, or dragging the (thin, easy-to-miss)
  // scrollbar does. That's what made the chart feel "static" to a
  // mouse-and-wheel user even though it was always technically scrollable.
  // This converts an ordinary wheel scroll into horizontal movement
  // whenever the pointer is over the chart, so it scrolls on its own the
  // way someone actually tries it first — a normal scroll gesture — while
  // still allowing real horizontal trackpad/shift-wheel input through
  // untouched (only vertical-dominant wheel events are redirected).
  //
  // This is wired up with a real, manually-attached DOM listener
  // ({ passive: false }) in the effect below rather than React's onWheel
  // prop — React attaches wheel listeners as passive by default, which
  // silently blocks preventDefault() (Chrome logs "Unable to preventDefault
  // inside passive event listener") and, in some browsers, the page can end
  // up scrolling vertically *underneath* the chart at the same time the
  // chart tries to scroll horizontally, which reads as janky or "not
  // working" depending on layout. A real non-passive listener avoids that
  // outright, so the redirect is clean every time, on every browser.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    function onWheel(e) {
      if (el.scrollWidth <= el.clientWidth) return; // nothing to scroll
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return; // already horizontal input — leave it alone
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    }
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [chartData.length]);

  // Click-and-drag ("grab to scroll") as a second, input-device-independent
  // way to move the chart — useful for anyone on a plain mouse with no
  // horizontal wheel/trackpad gesture at all, or viewing on a touch screen
  // where native touch-scroll already works via overflow-x-auto itself.
  const drag = useRef({ active: false, startX: 0, startScroll: 0 });
  function handleMouseDown(e) {
    const el = scrollRef.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    drag.current = { active: true, startX: e.clientX, startScroll: el.scrollLeft };
    el.classList.add('cursor-grabbing');
  }
  function handleMouseMove(e) {
    if (!drag.current.active || !scrollRef.current) return;
    scrollRef.current.scrollLeft = drag.current.startScroll - (e.clientX - drag.current.startX);
  }
  function endDrag() {
    drag.current.active = false;
    scrollRef.current?.classList.remove('cursor-grabbing');
  }
  function scrollByStep(dir) {
    scrollRef.current?.scrollBy({ left: dir * MIN_SLOT_WIDTH * 3, behavior: 'smooth' });
  }

  if (chartData.length === 0) {
    return (
      <div className="flex items-center justify-center text-[12.5px] text-ink-muted" style={{ height }}>
        No KPIs to chart yet.
      </div>
    );
  }
  const OwnerTick = makeOwnerTick(chartData);
  const minWidth = chartData.length * MIN_SLOT_WIDTH;
  return (
    <div>
      {overflowing && (
        <div className="flex items-center justify-between mb-1">
          <p className="text-[10.5px] text-ink-muted flex items-center gap-1">
            <span aria-hidden="true">↔</span> Scroll, drag, or use the arrows to see all {chartData.length} KPIs
          </p>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => scrollByStep(-1)} aria-label="Scroll chart left"
              className="w-6 h-6 flex items-center justify-center rounded-md border border-line text-ink-secondary hover:bg-sunken">‹</button>
            <button type="button" onClick={() => scrollByStep(1)} aria-label="Scroll chart right"
              className="w-6 h-6 flex items-center justify-center rounded-md border border-line text-ink-secondary hover:bg-sunken">›</button>
          </div>
        </div>
      )}
      {/* overflow-x-auto is what makes this scrollable at all: the inner div
          is forced wider than the card (minWidth, one fixed-width slot per
          KPI) so once there are more KPIs than comfortably fit THIS
          card's actual width, the browser draws its own horizontal
          scrollbar here — reachable by dragging that scrollbar, a trackpad
          swipe, or shift+wheel by default, and now ALSO by a plain mouse
          wheel (the effect above) and by click-and-drag or the ‹ › buttons
          (both above), so it scrolls on its own for whatever input device
          is actually being used, all the way to the last KPI in both
          directions. `overflowing` (measured live off this exact div) is
          what actually decides whether the hint/arrows/grab-cursor show —
          a short list that genuinely fits stays exactly as it always did,
          with no hint, no arrows, and no scrollbar. */}
      <div
        ref={scrollRef}
        className={`overflow-x-auto ${overflowing ? 'cursor-grab' : ''}`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
      >
        <div style={{ minWidth, height }}>
          <ResponsiveContainer width="100%" height={height}>
            <BarChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }} barGap={2} barCategoryGap="28%">
              <CartesianGrid vertical={false} stroke="var(--color-line)" />
              <XAxis dataKey="name" tick={OwnerTick} axisLine={{ stroke: 'var(--color-line)' }} tickLine={false} interval={0} height={54} />
              <YAxis allowDecimals={false} domain={[0, 100]} tick={{ fontSize: 11, fill: 'var(--color-ink-muted)' }} axisLine={false} tickLine={false} width={30} unit="%" />
              <ReferenceLine y={100} stroke="var(--color-line-strong)" strokeDasharray="3 3" />
              <Tooltip
                cursor={{ fill: 'var(--color-sunken)' }}
                contentStyle={{ borderRadius: 8, border: '1px solid var(--color-line)', fontSize: 12.5, background: 'var(--color-surface)', color: 'var(--color-ink)' }}
                labelFormatter={(label, item) => {
                  const owner = item?.[0]?.payload?.owner;
                  const ownerKind = item?.[0]?.payload?.ownerKind;
                  if (!owner) return label;
                  return `${label} — ${owner}${ownerKind ? ` (${ownerKind})` : ''}`;
                }}
                formatter={(v, name, item) => {
                  if (name === 'Actual') {
                    const variance = item.payload.variance;
                    return [`${v}% (variance ${variance == null ? '—' : (variance > 0 ? '+' : '') + variance}pts)`, 'Actual'];
                  }
                  return [`${v}%`, 'Expected pace'];
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11.5, paddingTop: 8 }} iconType="circle" iconSize={8} />
              <Bar dataKey="expected" name="Expected pace" fill="var(--color-ink-muted)" opacity={0.35} radius={[4, 4, 0, 0]} maxBarSize={26} />
              <Bar dataKey="actual" name="Actual" radius={[4, 4, 0, 0]} maxBarSize={26}>
                {chartData.map((d, idx) => <Cell key={`${d.name}-${idx}`} fill={FLAG_COLOR[d.flag] || FLAG_COLOR.none} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
