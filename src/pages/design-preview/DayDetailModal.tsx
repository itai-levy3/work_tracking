import { useEffect, useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import * as RxDialog from "@radix-ui/react-dialog";
import {
  calcHoursBetween,
  DayFraction,
  DayStatus,
  deleteWorkHourByDate,
  fractionMultiplier,
  formatHM,
  getCountedHours,
  getEffectiveDailyTarget,
  upsertWorkHour,
  UserSettings,
  WorkHour,
} from "@/lib/localData";
import { STATUS_META } from "./tokens";

/** Statuses that behave like a non-worked day: fixed hours from the daily target, no time entry. */
const OFF_LIKE_STATUSES: DayStatus[] = ["vacation", "sick", "holiday", "off"];
const FRACTION_LABEL: Record<DayFraction, string> = { full: "יום מלא", three_quarters: "3/4 יום", half: "חצי יום" };

const WEEKDAY_HE_LONG = ["יום ראשון", "יום שני", "יום שלישי", "יום רביעי", "יום חמישי", "יום שישי", "שבת"];
const MONTH_HE = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
const dateKey = (d: Date) => format(d, "yyyy-MM-dd");
const calcHours = calcHoursBetween;

/** 14 burst particles flying outward from the orb's center on open, evenly spread around the circle. */
const PARTICLES = Array.from({ length: 14 }, (_, i) => {
  const angle = (i / 14) * Math.PI * 2;
  const dist = 118 + (i % 3) * 18;
  return { x: Math.cos(angle) * dist, y: Math.sin(angle) * dist, delay: (i % 4) * 0.04, size: 4 + (i % 3) * 2.5 };
});

/** 3 small satellite dots that continuously orbit the orb, evenly spaced. */
const SATELLITES = [0, 120, 240];

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

interface DayDetailModalProps {
  date: Date | null;
  entry: WorkHour | undefined;
  settings: UserSettings;
  onClose: () => void;
  onSaved: () => void;
  /** Opens straight into the edit card (e.g. "fix my clock-in time") instead of the circular
   * summary — a genuinely different screen, not a variant of the big orb view. */
  initialEditing?: boolean;
}

const modalStyle = `
  @keyframes ddm-overlay-in { from { opacity: 0; } to { opacity: 1; } }
  .ddm-overlay[data-state="open"] { animation: ddm-overlay-in .3s ease both; }

  @keyframes ddm-header-in { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
  .ddm-header-in { animation: ddm-header-in .4s cubic-bezier(.16,1,.3,1) both; }

  @keyframes ddm-orb-in { 0% { opacity: 0; transform: scale(0.15) rotate(-50deg); } 50% { opacity: 1; transform: scale(1.14) rotate(6deg); } 72% { transform: scale(0.94) rotate(-2deg); } 100% { opacity: 1; transform: scale(1) rotate(0deg); } }
  .ddm-orb { animation: ddm-orb-in .8s cubic-bezier(.19,1.6,.35,1) both; }
  @keyframes ddm-orb-breathe { 0%,100% { transform: scale(1); } 50% { transform: scale(1.025); } }
  .ddm-orb-breathe { animation: ddm-orb-breathe 3.6s ease-in-out 0.9s infinite; }
  @keyframes ddm-orb-spin { to { transform: rotate(360deg); } }
  .ddm-orb-ring { animation: ddm-orb-spin 8s linear infinite; }
  @keyframes ddm-orb-glow-pulse { 0%,100% { opacity: 0.4; transform: scale(0.95); } 50% { opacity: 0.75; transform: scale(1.1); } }
  .ddm-orb-glow { animation: ddm-orb-glow-pulse 3s ease-in-out infinite; }
  @keyframes ddm-badge-pop { 0% { transform: scale(0) rotate(-20deg); } 100% { transform: scale(1) rotate(0deg); } }
  .ddm-orb-badge { animation: ddm-badge-pop .5s cubic-bezier(.34,1.7,.64,1) .35s both; }

  .ddm-clock-sweep { animation: ddm-orb-spin 9s linear infinite; }

  @keyframes ddm-satellite-orbit { to { transform: rotate(360deg); } }
  .ddm-satellites { animation: ddm-satellite-orbit 11s linear infinite; }
  @keyframes ddm-satellite-twinkle { 0%,100% { opacity: 0.5; transform: scale(0.85); } 50% { opacity: 1; transform: scale(1.2); } }
  .ddm-satellite-dot { animation: ddm-satellite-twinkle 2.2s ease-in-out infinite; }

  @keyframes ddm-shimmer-sweep {
    0% { transform: translate(-140%, -140%) rotate(25deg); opacity: 0; }
    10% { opacity: 0.6; }
    28% { transform: translate(140%, 140%) rotate(25deg); opacity: 0; }
    100% { transform: translate(140%, 140%) rotate(25deg); opacity: 0; }
  }
  .ddm-orb-shimmer { animation: ddm-shimmer-sweep 4.8s ease-in-out 1.3s infinite; }

  @keyframes ddm-ripple { 0% { transform: scale(0.5); opacity: 0.6; } 100% { transform: scale(2.1); opacity: 0; } }
  .ddm-ripple { animation: ddm-ripple 1.4s cubic-bezier(.16,1,.3,1) both; }
  @keyframes ddm-shockwave { 0% { transform: scale(0.3); opacity: 0.9; } 100% { transform: scale(2.6); opacity: 0; } }
  .ddm-shockwave { animation: ddm-shockwave 1s cubic-bezier(.16,1,.3,1) both; }

  @keyframes ddm-particle { 0% { transform: translate(0,0) scale(1); opacity: 1; } 100% { transform: translate(var(--px), var(--py)) scale(0); opacity: 0; } }
  .ddm-particle { animation: ddm-particle 1s cubic-bezier(.16,1,.3,1) both; }

  @keyframes ddm-pill-in { from { opacity: 0; transform: translateY(10px) scale(0.9); } to { opacity: 1; transform: translateY(0) scale(1); } }
  .ddm-pill-in { animation: ddm-pill-in .45s cubic-bezier(.16,1,.3,1) .5s both; }

  @keyframes ddm-card-in { 0% { opacity: 0; transform: scale(0.7) translateY(20px); } 60% { opacity: 1; transform: scale(1.02) translateY(-2px); } 100% { opacity: 1; transform: scale(1) translateY(0); } }
  .ddm-card-in { animation: ddm-card-in .55s cubic-bezier(.2,1.3,.4,1) both; }

  .ddm-status-btn { transition: transform .25s cubic-bezier(.34,1.56,.64,1), box-shadow .25s; }
  .ddm-status-btn:active { transform: scale(0.92); }
  @media (hover: hover) and (pointer: fine) {
    .ddm-status-btn:hover .ddm-status-badge { transform: scale(1.12) translateY(-2px); }
  }
  .ddm-status-badge { transition: transform .25s cubic-bezier(.34,1.56,.64,1), box-shadow .25s; }
  .ddm-field { transition: border-color .2s, box-shadow .2s, transform .2s; }
  .ddm-field:focus-within { transform: translateY(-1px); }
  .ddm-save { transition: transform .2s cubic-bezier(.34,1.56,.64,1), box-shadow .2s, filter .2s; }
  .ddm-save:active { transform: scale(0.97); }
  @media (hover: hover) and (pointer: fine) {
    .ddm-save:hover { transform: translateY(-2px); filter: brightness(1.05); }
  }
  .ddm-round-btn { transition: transform .2s cubic-bezier(.34,1.56,.64,1), box-shadow .2s; }
  .ddm-round-btn:active { transform: scale(0.88); }
  @media (hover: hover) and (pointer: fine) {
    .ddm-round-btn:hover { transform: translateY(-2px) scale(1.06); }
  }
  .ddm-clear-link { transition: color .15s, transform .15s; }
  .ddm-clear-link:active { transform: scale(0.9); }
  @media (hover: hover) and (pointer: fine) {
    .ddm-clear-link:hover { color: #DC2626 !important; }
  }
`;

/**
 * Shared day-editing modal used by both the Home screen (editing today, often mid-shift) and
 * Schedule (planning a future day in advance, without a running clock). A day that already has
 * data opens as a fully circular floating "orb" summary with a burst-open entrance; editing
 * (or a blank day) opens a compact rounded card, both centered on screen — never a corner-boxed
 * dialog or a bottom sheet.
 */
export function DayDetailModal({ date, entry, settings, onClose, onSaved, initialEditing }: DayDetailModalProps) {
  const [draft, setDraft] = useState<Partial<WorkHour>>({});
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDeleteSegment, setConfirmDeleteSegment] = useState<number | null>(null);
  const [displayedHours, setDisplayedHours] = useState(0);

  useEffect(() => {
    if (!date) return;
    setDraft(
      entry
        ? { ...entry }
        : { date: dateKey(date), hours_worked: 0, start_time: null, end_time: null, status: "worked" },
    );
    // A day that already has recorded data (worked hours, a non-worked status, or a note) opens
    // in the circular summary view; a blank day goes straight into editing. initialEditing skips
    // the summary entirely regardless (used by the "fix my clock-in time" shortcut on Home).
    const hasData = !!entry && (getCountedHours(entry) > 0 || !!entry.start_time || (entry.status && entry.status !== "worked") || !!entry.note);
    setEditing(initialEditing || !hasData);
    setConfirmDelete(false);
    setConfirmDeleteSegment(null);
  }, [date, entry, initialEditing]);

  // Counts the orb's hero number up from 0 to its real value on open, for a livelier reveal.
  useEffect(() => {
    if (editing || !entry) return;
    const target = getCountedHours(entry);
    if (target <= 0) {
      setDisplayedHours(0);
      return;
    }
    const start = performance.now();
    const duration = 900;
    let raf = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      setDisplayedHours(target * easeOutCubic(progress));
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // requestAnimationFrame is throttled (or paused entirely) while the tab is hidden, which
    // would otherwise strand the number at 0:00. This guarantees it always lands on the real value.
    const settle = window.setTimeout(() => setDisplayedHours(target), duration + 120);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(settle);
    };
  }, [editing, entry]);

  if (!date) return null;

  const status = (draft.status || "worked") as DayStatus;
  const meta = STATUS_META[status] || STATUS_META.worked;
  const target = getEffectiveDailyTarget(dateKey(date), draft as WorkHour, settings);
  const hasTimes = !!(draft.start_time && draft.end_time);
  const stillClockedIn = status === "worked" && !!draft.start_time && !draft.end_time;
  // Computed live from the in-progress time fields, not the possibly-stale stored hours_worked —
  // otherwise the deficit banner shows the pre-edit value until save.
  const worked = status === "worked" ? calcHours(draft.start_time, draft.end_time) || Number(draft.hours_worked || 0) : Number(draft.hours_worked || 0);
  const deficit = status === "worked" && hasTimes ? Math.max(0, target - worked) : 0;
  const hasSavedData = !!entry && (getCountedHours(entry) > 0 || !!entry.start_time || (entry.status && entry.status !== "worked") || !!entry.note);

  const save = (overrides: Partial<WorkHour> = {}) => {
    const merged: WorkHour = {
      date: dateKey(date),
      hours_worked: draft.hours_worked || 0,
      start_time: draft.start_time ?? null,
      end_time: draft.end_time ?? null,
      segments: draft.segments,
      status: draft.status || "worked",
      fraction: draft.fraction,
      paid: draft.paid,
      evening: draft.evening,
      deficitCoveredBy: draft.deficitCoveredBy,
      note: draft.note?.trim() || undefined,
      ...overrides,
    };
    if (OFF_LIKE_STATUSES.includes((merged.status || "worked") as DayStatus)) {
      // "holiday" is always paid in full; "off" is always unpaid; vacation/sick keep the user's toggle.
      merged.paid = merged.status === "holiday" ? true : merged.status === "off" ? false : merged.paid !== false;
      merged.hours_worked = merged.paid ? target * fractionMultiplier(merged.fraction) : 0;
      merged.start_time = null;
      merged.end_time = null;
      merged.segments = undefined;
      merged.deficitCoveredBy = undefined;
    } else if (merged.segments && merged.segments.length > 1) {
      // A day with more than one shift: each segment is now edited (and deletable) independently
      // in the form below, so `merged.segments` already reflects the real, current per-shift
      // times — just total them up and mirror the last one into start_time/end_time.
      merged.hours_worked = merged.segments.reduce((s, seg) => s + calcHoursBetween(seg.start, seg.end), 0);
      const last = merged.segments[merged.segments.length - 1];
      merged.start_time = last.start;
      merged.end_time = last.end;
    } else {
      // Always recomputed fresh from the times — never falls back to the old stored value, so
      // clearing either time (e.g. "still working, no exit yet") correctly zeroes this out instead
      // of keeping stale hours from before the edit.
      merged.hours_worked = calcHours(merged.start_time, merged.end_time);
      merged.segments = merged.start_time && merged.end_time ? [{ start: merged.start_time, end: merged.end_time, evening: merged.evening }] : undefined;
    }
    upsertWorkHour(merged);
    onSaved();
    onClose();
    toast.success("היום עודכן");
  };

  // Each shift on a multi-segment day is edited independently — never derived from a single
  // shared start/end pair, so editing (or deleting) one never touches the others.
  const updateSegment = (index: number, field: "start" | "end", value: string) => {
    setDraft((d) => {
      const segs = [...(d.segments || [])];
      segs[index] = { ...segs[index], [field]: field === "end" ? value || null : value };
      return { ...d, segments: segs };
    });
  };

  const deleteSegment = (index: number) => {
    setDraft((d) => {
      const segs = [...(d.segments || [])];
      segs.splice(index, 1);
      if (segs.length > 1) return { ...d, segments: segs };
      // Down to one (or zero) shifts — collapse back to the plain start/end fields instead of a
      // segments array of length 1, matching how a single-shift day is normally represented.
      const only = segs[0];
      return { ...d, segments: undefined, start_time: only?.start ?? null, end_time: only?.end ?? null };
    });
  };

  const handleDeleteDay = () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    deleteWorkHourByDate(dateKey(date));
    onSaved();
    onClose();
    toast.success("היום אופס");
  };

  // Deletes one shift straight from the summary view — no need to open the edit card first —
  // for a day that has more than one. Same tap-then-confirm pattern as deleting the whole day.
  const handleDeleteSegmentFromSummary = (index: number) => {
    if (!entry || !entry.segments) return;
    if (confirmDeleteSegment !== index) {
      setConfirmDeleteSegment(index);
      return;
    }
    const segs = [...entry.segments];
    segs.splice(index, 1);
    const last = segs[segs.length - 1];
    const updated: WorkHour = {
      ...entry,
      segments: segs.length > 1 ? segs : undefined,
      start_time: last ? last.start : null,
      end_time: last ? last.end : null,
      hours_worked: segs.reduce((s, seg) => s + calcHoursBetween(seg.start, seg.end), 0),
    };
    upsertWorkHour(updated);
    onSaved();
    onClose();
    toast.success("המשמרת נמחקה");
  };

  return (
    <RxDialog.Root open={!!date} onOpenChange={(open) => !open && onClose()}>
      <RxDialog.Portal>
        <style>{modalStyle}</style>
        <RxDialog.Overlay className="ddm-overlay fixed inset-0 z-50" style={{ background: "rgba(16,26,70,0.5)", backdropFilter: "blur(4px)" }} />
        <RxDialog.Content
          className="fixed inset-0 z-50 flex flex-col items-center justify-center outline-none px-6 py-8"
          style={{ overflowY: "auto" }}
        >
          <div className="ddm-header-in flex items-center gap-3 mb-5 px-5 py-2 rounded-full" style={{ background: "rgba(255,255,255,0.85)", backdropFilter: "blur(20px)", boxShadow: "0 10px 30px -10px rgba(16,26,70,0.25)" }}>
            <RxDialog.Title className="text-[15px] font-bold" style={{ color: "#101A46" }}>
              {date.getDate()} ב{MONTH_HE[date.getMonth()]} · {WEEKDAY_HE_LONG[date.getDay()]}
            </RxDialog.Title>
            <RxDialog.Close className="w-7 h-7 rounded-full flex items-center justify-center shrink-0" style={{ background: "rgba(35,50,100,0.08)", color: "#8892b0" }}>
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>close</span>
            </RxDialog.Close>
          </div>

          {!editing && hasSavedData ? (
            // ---- Fully circular floating "orb" summary — no card, no corners ----
            <div className="flex flex-col items-center gap-6">
              <div className="relative flex items-center justify-center" style={{ width: 320, height: 320 }}>
                {/* Opening shockwave + staggered ripple rings */}
                <div className="ddm-shockwave absolute rounded-full pointer-events-none" style={{ width: 250, height: 250, border: `3px solid ${meta.grad[1]}` }} />
                {[0, 0.13, 0.26, 0.39].map((d) => (
                  <div
                    key={d}
                    className="ddm-ripple absolute rounded-full pointer-events-none"
                    style={{ width: 250, height: 250, border: `2px solid ${meta.grad[1]}`, animationDelay: `${d}s` }}
                  />
                ))}
                {/* Particle burst */}
                {PARTICLES.map((p, i) => (
                  <div
                    key={i}
                    className="ddm-particle absolute rounded-full pointer-events-none"
                    style={{
                      width: p.size,
                      height: p.size,
                      background: i % 2 === 0 ? meta.grad[0] : meta.grad[1],
                      animationDelay: `${p.delay}s`,
                      boxShadow: `0 0 6px 1px ${meta.glow}`,
                      ["--px" as string]: `${p.x}px`,
                      ["--py" as string]: `${p.y}px`,
                    }}
                  />
                ))}
                {/* Continuously orbiting satellites */}
                <div className="ddm-satellites absolute inset-0 pointer-events-none">
                  {SATELLITES.map((angle) => (
                    <div
                      key={angle}
                      className="ddm-satellite-dot absolute rounded-full"
                      style={{
                        width: 7,
                        height: 7,
                        top: "50%",
                        left: "50%",
                        background: meta.grad[1],
                        boxShadow: `0 0 10px 3px ${meta.glow}`,
                        transform: `rotate(${angle}deg) translateX(152px) rotate(-${angle}deg)`,
                      }}
                    />
                  ))}
                </div>
                <div
                  className="ddm-orb-glow absolute rounded-full pointer-events-none"
                  style={{ width: 292, height: 292, background: `radial-gradient(circle, ${meta.glow}, transparent 70%)`, filter: "blur(26px)" }}
                />
                <div
                  className="ddm-orb-ring absolute rounded-full"
                  style={{ width: 262, height: 262, background: `conic-gradient(from 0deg, ${meta.grad[0]}, ${meta.grad[1]}, ${meta.grad[0]})`, opacity: 0.55 }}
                />
                <div className="ddm-orb-breathe">
                  <div
                    className="ddm-orb relative rounded-full flex flex-col items-center justify-center overflow-hidden"
                    style={{
                      width: 250,
                      height: 250,
                      background: `radial-gradient(circle at 30% 24%, rgba(255,255,255,0.95), ${meta.grad[1]} 34%, ${meta.grad[0]} 78%)`,
                      boxShadow: `0 30px 70px -10px ${meta.glow}, inset 0 3px 8px rgba(255,255,255,0.5), inset 0 -12px 24px rgba(0,0,0,0.14)`,
                    }}
                  >
                    <div className="absolute -left-10 -bottom-12 w-44 h-44 rounded-full pointer-events-none" style={{ background: "rgba(255,255,255,0.1)" }} />

                    {/* Clock-face tick marks — this orb documents hours, so it reads like a watch face */}
                    <svg className="absolute inset-0" viewBox="0 0 250 250" style={{ opacity: 0.55 }}>
                      {Array.from({ length: 12 }).map((_, i) => {
                        const angle = (i / 12) * 2 * Math.PI - Math.PI / 2;
                        const isMajor = i % 3 === 0;
                        const inner = isMajor ? 98 : 106;
                        const outer = 116;
                        const cx = 125;
                        const cy = 125;
                        return (
                          <line
                            key={i}
                            x1={cx + Math.cos(angle) * inner}
                            y1={cy + Math.sin(angle) * inner}
                            x2={cx + Math.cos(angle) * outer}
                            y2={cy + Math.sin(angle) * outer}
                            stroke="rgba(255,255,255,0.85)"
                            strokeWidth={isMajor ? 3 : 1.5}
                            strokeLinecap="round"
                          />
                        );
                      })}
                    </svg>
                    {/* Sweeping clock hand — continuous, slow, purely decorative motion */}
                    <div className="absolute inset-0 ddm-clock-sweep">
                      <div
                        className="absolute rounded-full"
                        style={{ width: 3, height: 84, top: "50%", left: "50%", marginTop: -84, marginLeft: -1.5, transformOrigin: "50% 100%", background: "linear-gradient(to top, rgba(255,255,255,0.95), rgba(255,255,255,0.05))" }}
                      />
                    </div>
                    <div
                      className="absolute rounded-full"
                      style={{ width: 8, height: 8, top: "50%", left: "50%", marginTop: -4, marginLeft: -4, background: "#fff", boxShadow: "0 0 8px rgba(255,255,255,0.9)" }}
                    />

                    {/* Glossy diagonal shimmer sweep */}
                    <div
                      className="ddm-orb-shimmer absolute pointer-events-none"
                      style={{ width: 70, height: 380, top: -70, left: 108, background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.6), transparent)", filter: "blur(4px)" }}
                    />
                    <div
                      className="ddm-orb-badge absolute top-6 flex items-center justify-center rounded-full"
                      style={{ width: 46, height: 46, background: "rgba(255,255,255,0.3)", boxShadow: "0 6px 14px rgba(0,0,0,0.12)" }}
                    >
                      <span className="material-symbols-outlined text-white" style={{ fontSize: 24 }}>{meta.icon}</span>
                    </div>
                    <span
                      className="relative z-10 text-white leading-none"
                      style={{
                        fontFamily: "'Space Grotesk', 'Bricolage Grotesque', system-ui, sans-serif",
                        fontSize: stillClockedIn ? 30 : 62,
                        fontWeight: 700,
                        letterSpacing: "-0.045em",
                        fontVariantNumeric: "tabular-nums",
                        marginTop: 14,
                        textShadow: "0 3px 16px rgba(0,0,0,0.22)",
                      }}
                    >
                      {stillClockedIn ? "עדיין עובד" : formatHM(displayedHours)}
                    </span>
                    <span className="relative z-10 text-white text-[12px] font-bold uppercase tracking-[0.2em] mt-2.5" style={{ textShadow: "0 1px 4px rgba(0,0,0,0.2)" }}>{meta.label}</span>
                  </div>
                </div>
              </div>

              <div className="ddm-pill-in flex flex-col items-center gap-2">
                {status === "worked" &&
                  draft.start_time &&
                  (draft.segments && draft.segments.length > 1
                    ? draft.segments.map((seg, i) => (
                        <div
                          key={i}
                          className="flex items-stretch rounded-2xl overflow-hidden"
                          style={{ background: "#fff", border: `1.5px solid ${meta.grad[1]}55`, boxShadow: `0 10px 26px -12px ${meta.glow}` }}
                        >
                          <div className="flex flex-col items-center px-4 py-2">
                            <span className="text-[8px] font-bold uppercase tracking-[0.14em] mb-0.5" style={{ color: "#8892b0" }}>{`משמרת ${i + 1} · כניסה`}</span>
                            <span className="text-[16px] leading-none" style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif", fontWeight: 700, letterSpacing: "-0.02em", color: "#101A46" }}>
                              {seg.start}
                            </span>
                          </div>
                          <div className="flex items-center justify-center px-1" style={{ background: `${meta.grad[1]}1A` }}>
                            <span className="material-symbols-outlined text-[15px]" style={{ color: meta.grad[0] }}>arrow_forward</span>
                          </div>
                          <div className="flex flex-col items-center px-4 py-2">
                            <span className="text-[8px] font-bold uppercase tracking-[0.14em] mb-0.5" style={{ color: "#8892b0" }}>יציאה</span>
                            <span className="text-[16px] leading-none" style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif", fontWeight: 700, letterSpacing: "-0.02em", color: seg.end ? "#101A46" : meta.grad[0] }}>
                              {seg.end || "פעיל"}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleDeleteSegmentFromSummary(i)}
                            className="flex items-center justify-center px-2.5"
                            style={{ background: confirmDeleteSegment === i ? "#DC2626" : "rgba(220,38,38,0.08)" }}
                            title="מחיקת המשמרת הזו"
                          >
                            <span className="material-symbols-outlined text-[15px]" style={{ color: confirmDeleteSegment === i ? "#fff" : "#DC2626" }}>
                              {confirmDeleteSegment === i ? "check" : "delete"}
                            </span>
                          </button>
                        </div>
                      ))
                    : (
                      <div
                        className="flex items-stretch rounded-2xl overflow-hidden"
                        style={{ background: "#fff", border: `1.5px solid ${meta.grad[1]}55`, boxShadow: `0 10px 26px -12px ${meta.glow}` }}
                      >
                        <div className="flex flex-col items-center px-5 py-2.5">
                          <span className="text-[9px] font-bold uppercase tracking-[0.14em] mb-0.5" style={{ color: "#8892b0" }}>כניסה</span>
                          <span
                            className="text-[19px] leading-none"
                            style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif", fontWeight: 700, letterSpacing: "-0.02em", color: "#101A46" }}
                          >
                            {draft.start_time}
                          </span>
                        </div>
                        {/* This panel renders LTR (portal, outside the RTL tree), so the flow
                            entry → exit runs left-to-right and the arrow must point right. */}
                        <div className="flex items-center justify-center px-1" style={{ background: `${meta.grad[1]}1A` }}>
                          <span className="material-symbols-outlined text-[17px]" style={{ color: meta.grad[0] }}>arrow_forward</span>
                        </div>
                        <div className="flex flex-col items-center px-5 py-2.5">
                          <span className="text-[9px] font-bold uppercase tracking-[0.14em] mb-0.5" style={{ color: "#8892b0" }}>יציאה</span>
                          <span
                            className="text-[19px] leading-none"
                            style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif", fontWeight: 700, letterSpacing: "-0.02em", color: draft.end_time ? "#101A46" : meta.grad[0] }}
                          >
                            {draft.end_time || "פעיל"}
                          </span>
                        </div>
                      </div>
                    ))}
                {status !== "worked" && (
                  <div className="flex items-center gap-2 px-4 py-2 rounded-full" style={{ background: meta.tint }}>
                    <span className="text-[13px] font-bold" style={{ color: "#101A46" }}>{FRACTION_LABEL[draft.fraction || "full"]} · {draft.paid !== false ? "משולם" : "לא משולם"}</span>
                  </div>
                )}
                {draft.evening && (
                  <div className="flex items-center gap-2 px-4 py-1.5 rounded-full" style={{ background: "rgba(118,57,255,0.06)" }}>
                    <span className="material-symbols-outlined text-[14px]" style={{ color: "#7639FF" }}>dark_mode</span>
                    <span className="text-[12px] font-bold" style={{ color: "#101A46" }}>משמרת ערב</span>
                  </div>
                )}
                {draft.deficitCoveredBy && (
                  <div className="text-[12px] font-bold px-4 py-1.5 rounded-full" style={{ background: "rgba(118,57,255,0.06)", color: "#7639FF" }}>
                    החוסר של היום מסומן ככוסה ב{draft.deficitCoveredBy === "vacation" ? "חופש" : "מחלה"}
                  </div>
                )}
                {draft.note && (
                  <div className="flex items-start gap-2 px-4 py-2 rounded-2xl max-w-[280px]" style={{ background: "rgba(0,1,20,0.03)" }}>
                    <span className="material-symbols-outlined text-[15px] mt-0.5 shrink-0" style={{ color: "#8892b0" }}>event_note</span>
                    <span className="text-[12.5px]" style={{ color: "#101A46" }}>{draft.note}</span>
                  </div>
                )}
              </div>

              <div className="ddm-pill-in flex items-start gap-6 mt-1">
                <button onClick={() => setEditing(true)} className="ddm-round-btn flex flex-col items-center gap-1.5">
                  <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: "linear-gradient(155deg,#7639FF,#00D2FF)", boxShadow: "0 10px 24px -8px rgba(118,57,255,0.5)" }}>
                    <span className="material-symbols-outlined text-white" style={{ fontSize: 22 }}>edit</span>
                  </div>
                  <span className="text-[11px] font-bold" style={{ color: "#7639FF" }}>עריכה</span>
                </button>
                <button onClick={handleDeleteDay} className="ddm-round-btn flex flex-col items-center gap-1.5">
                  <div
                    className="w-14 h-14 rounded-full flex items-center justify-center"
                    style={{
                      background: confirmDelete ? "linear-gradient(155deg,#DC2626,#F87171)" : "rgba(220,38,38,0.1)",
                      boxShadow: confirmDelete ? "0 10px 24px -8px rgba(220,38,38,0.5)" : "none",
                    }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 22, color: confirmDelete ? "#fff" : "#DC2626" }}>{confirmDelete ? "check" : "delete_forever"}</span>
                  </div>
                  <span className="text-[11px] font-bold" style={{ color: "#DC2626" }}>{confirmDelete ? "לאשר" : "מחיקה"}</span>
                </button>
              </div>
            </div>
          ) : (
            // ---- Compact rounded card for editing (or a blank new day) — centered, not sliding ----
            <div
              className="ddm-card-in w-full max-w-[380px] flex flex-col gap-4 relative overflow-hidden"
              style={{
                borderRadius: 40,
                padding: "28px 24px",
                background: "linear-gradient(180deg, rgba(255,255,255,0.97), rgba(248,250,255,0.99))",
                backdropFilter: "blur(30px)",
                boxShadow: "0 30px 70px -15px rgba(16,26,70,0.35)",
                border: "1px solid rgba(255,255,255,0.85)",
              }}
            >
              <div className="absolute -top-16 -right-16 w-48 h-48 rounded-full pointer-events-none" style={{ background: `radial-gradient(circle, ${meta.glow}, transparent 70%)`, opacity: 0.35, filter: "blur(20px)" }} />

              <div className="grid grid-cols-5 gap-1.5 relative z-10">
                {(Object.keys(STATUS_META) as DayStatus[]).map((st) => {
                  const m = STATUS_META[st];
                  const isActive = status === st;
                  return (
                    <button
                      key={st}
                      onClick={() => setDraft((d) => ({ ...d, status: st }))}
                      className="ddm-status-btn flex flex-col items-center gap-1.5 py-1"
                    >
                      <div
                        className="ddm-status-badge w-11 h-11 rounded-full flex items-center justify-center"
                        style={{
                          background: isActive ? `linear-gradient(155deg, ${m.grad[0]}, ${m.grad[1]})` : "rgba(35,50,100,0.05)",
                          boxShadow: isActive ? `0 8px 18px -6px ${m.glow}, 0 0 0 3px ${m.tint}` : "none",
                          transform: isActive ? "scale(1.08)" : undefined,
                        }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 20, color: isActive ? "#fff" : "#8892b0" }}>{m.icon}</span>
                      </div>
                      <span className="text-[10px] font-bold" style={{ color: isActive ? m.grad[0] : "#8892b0" }}>{m.label}</span>
                    </button>
                  );
                })}
              </div>

              {status === "worked" ? (
                <div className="relative z-10 flex flex-col gap-4">
                  {draft.segments && draft.segments.length > 1 ? (
                    <div className="flex flex-col gap-3">
                      {draft.segments.map((seg, i) => (
                        <div key={i} className="rounded-2xl p-3 flex flex-col gap-2" style={{ background: "#fff", border: "1px solid #e4e1e6", boxShadow: "0 2px 8px rgba(35,50,100,0.03)" }}>
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold uppercase tracking-[0.08em]" style={{ color: "#8892b0" }}>{`משמרת ${i + 1}`}</span>
                            <button
                              type="button"
                              onClick={() => deleteSegment(i)}
                              className="ddm-clear-link text-[9px] font-bold flex items-center gap-0.5"
                              style={{ color: "#B0B7C9" }}
                              title="מחיקת המשמרת הזו"
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: 13 }}>delete</span>
                              מחיקה
                            </button>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 flex flex-col gap-0.5">
                              <label className="text-[9px] font-bold" style={{ color: "#8892b0" }}>כניסה</label>
                              <input
                                type="time"
                                value={seg.start}
                                onChange={(e) => updateSegment(i, "start", e.target.value)}
                                className="w-full text-[14px] font-bold bg-transparent outline-none"
                                style={{ color: "#101A46" }}
                              />
                            </div>
                            <span className="material-symbols-outlined text-[15px]" style={{ color: "#8892b0" }}>arrow_forward</span>
                            <div className="flex-1 flex flex-col gap-0.5">
                              <label className="text-[9px] font-bold" style={{ color: "#8892b0" }}>יציאה</label>
                              <input
                                type="time"
                                value={seg.end || ""}
                                onChange={(e) => updateSegment(i, "end", e.target.value)}
                                className="w-full text-[14px] font-bold bg-transparent outline-none"
                                style={{ color: "#101A46" }}
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <div className="ddm-field flex-1 rounded-2xl px-3 py-2" style={{ background: "#fff", border: "1px solid #e4e1e6", boxShadow: "0 2px 8px rgba(35,50,100,0.03)" }}>
                        <div className="flex items-center justify-between mb-0.5">
                          <label className="text-[10px] font-bold flex items-center gap-1" style={{ color: "#8892b0" }}>
                            <span className="material-symbols-outlined" style={{ fontSize: 13 }}>login</span>
                            כניסה
                          </label>
                          {draft.start_time && (
                            <button
                              type="button"
                              onClick={() => save({ start_time: null })}
                              className="ddm-clear-link text-[9px] font-bold flex items-center gap-0.5"
                              style={{ color: "#B0B7C9" }}
                              title="נקה שעת כניסה"
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: 12 }}>backspace</span>
                              נקה
                            </button>
                          )}
                        </div>
                        <input type="time" value={draft.start_time || ""} onChange={(e) => setDraft((d) => ({ ...d, start_time: e.target.value }))} className="w-full text-[15px] font-bold bg-transparent outline-none" style={{ color: "#101A46" }} />
                      </div>
                      <div className="ddm-field flex-1 rounded-2xl px-3 py-2" style={{ background: "#fff", border: "1px solid #e4e1e6", boxShadow: "0 2px 8px rgba(35,50,100,0.03)" }}>
                        <div className="flex items-center justify-between mb-0.5">
                          <label className="text-[10px] font-bold flex items-center gap-1" style={{ color: "#8892b0" }}>
                            <span className="material-symbols-outlined" style={{ fontSize: 13 }}>logout</span>
                            יציאה
                          </label>
                          {draft.end_time && (
                            <button
                              type="button"
                              onClick={() => save({ end_time: null })}
                              className="ddm-clear-link text-[9px] font-bold flex items-center gap-0.5"
                              style={{ color: "#B0B7C9" }}
                              title="נקה שעת יציאה — עדיין עובד"
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: 12 }}>backspace</span>
                              נקה
                            </button>
                          )}
                        </div>
                        <input type="time" value={draft.end_time || ""} onChange={(e) => setDraft((d) => ({ ...d, end_time: e.target.value }))} className="w-full text-[15px] font-bold bg-transparent outline-none" style={{ color: "#101A46" }} />
                      </div>
                    </div>
                  )}
                  {!hasTimes && !draft.start_time && (
                    <p className="text-[11px]" style={{ color: "#8892b0" }}>אפשר לתכנן יום עתידי מראש בלי לרשום שעות — רק לסמן משמרת ערב, חופש/מחלה, או להשאיר הערה.</p>
                  )}
                  {stillClockedIn && (
                    <p className="text-[11px] flex items-center gap-1.5 px-1" style={{ color: "#16A34A" }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 14 }}>bolt</span>
                      אין שעת יציאה — היום מסומן כעדיין פעיל.
                    </p>
                  )}
                  {(!draft.segments || draft.segments.length <= 1) && (
                    <label className="flex items-center justify-between gap-2 p-3 rounded-xl" style={{ background: "rgba(118,57,255,0.05)" }}>
                      <span className="text-[13px] font-medium flex items-center gap-1.5" style={{ color: "#101A46" }}>
                        <span className="material-symbols-outlined text-[16px]" style={{ color: "#7639FF" }}>dark_mode</span>
                        משמרת ערב
                      </span>
                      <input type="checkbox" checked={!!draft.evening} onChange={(e) => setDraft((d) => ({ ...d, evening: e.target.checked }))} className="w-5 h-5 accent-[#7639FF]" />
                    </label>
                  )}

                  {hasTimes && deficit > 0.01 && (
                    <div className="rounded-xl p-3 flex flex-col gap-2" style={{ background: "rgba(220,38,38,0.05)", border: "1px solid rgba(220,38,38,0.15)" }}>
                      <span className="text-[12px] font-bold" style={{ color: "#DC2626" }}>
                        חוסר של {formatHM(deficit)} שעות ({(deficit / (target || 1)).toFixed(2)} מיום עבודה)
                      </span>
                      <span className="text-[11px]" style={{ color: "#46464f" }}>אפשר לסמן את החוסר כחופש/מחלה במקום כשעות חסרות — זה יקזז יום חלקי מיתרת הימים שלך.</span>
                      <div className="flex gap-2">
                        <button onClick={() => save({ deficitCoveredBy: "vacation", status: "worked" })} className="flex-1 h-9 rounded-lg text-[12px] font-bold" style={{ background: "rgba(37,99,235,0.1)", color: "#2563EB" }}>סמן כחופש</button>
                        <button onClick={() => save({ deficitCoveredBy: "sick", status: "worked" })} className="flex-1 h-9 rounded-lg text-[12px] font-bold" style={{ background: "rgba(217,119,6,0.1)", color: "#D97706" }}>סמן כמחלה</button>
                      </div>
                    </div>
                  )}
                  {draft.deficitCoveredBy && (
                    <div className="text-[12px] font-bold px-3 py-2 rounded-xl" style={{ background: "rgba(118,57,255,0.06)", color: "#7639FF" }}>
                      החוסר של היום מסומן ככוסה ב{draft.deficitCoveredBy === "vacation" ? "חופש" : "מחלה"}.{" "}
                      <button onClick={() => setDraft((d) => ({ ...d, deficitCoveredBy: undefined }))} className="underline">בטל</button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="relative z-10 flex flex-col gap-4">
                  <div>
                    <label className="text-[11px] font-bold block mb-1" style={{ color: "#46464f" }}>חלקיות</label>
                    <div className="flex gap-2">
                      {(["full", "three_quarters", "half"] as DayFraction[]).map((f) => (
                        <button
                          key={f}
                          onClick={() => setDraft((d) => ({ ...d, fraction: f }))}
                          className="ddm-status-btn flex-1 h-9 rounded-lg text-[12px] font-bold"
                          style={{
                            background: (draft.fraction || "full") === f ? `linear-gradient(155deg, ${meta.grad[0]}, ${meta.grad[1]})` : meta.tint,
                            color: (draft.fraction || "full") === f ? "#fff" : meta.grad[0],
                          }}
                        >
                          {FRACTION_LABEL[f]}
                        </button>
                      ))}
                    </div>
                  </div>
                  {(status === "vacation" || status === "sick") && (
                    <label className="flex items-center justify-between gap-2 p-3 rounded-xl" style={{ background: draft.paid !== false ? "rgba(22,163,74,0.06)" : "rgba(220,38,38,0.06)" }}>
                      <span className="text-[13px] font-medium" style={{ color: "#101A46" }}>{draft.paid !== false ? "משולם" : "לא משולם"}</span>
                      <input type="checkbox" checked={draft.paid !== false} onChange={(e) => setDraft((d) => ({ ...d, paid: e.target.checked }))} className="w-5 h-5 accent-[#16A34A]" />
                    </label>
                  )}
                  {status === "holiday" && (
                    <p className="text-[11px] px-3 py-2.5 rounded-xl" style={{ color: meta.grad[0], background: meta.tint }}>
                      חג משולם במלואו לפי היעד היומי, על חשבון המערכת — לא נגרע מיתרת ימי החופש/המחלה שלך.
                    </p>
                  )}
                  {status === "off" && (
                    <p className="text-[11px] px-3 py-2.5 rounded-xl" style={{ color: meta.grad[0], background: meta.tint }}>
                      יום לא עובד — השכר יורד לפי חלק היום שסומן, ולא נספר כחופש/מחלה.
                    </p>
                  )}
                </div>
              )}

              <div className="relative z-10">
                <label className="text-[11px] font-bold block mb-1" style={{ color: "#46464f" }}>הערה / אירוע ליום הזה</label>
                <textarea
                  value={draft.note || ""}
                  onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
                  placeholder='למשל: "יציאה מוקדמת ב-15:30 בגלל אירוע"'
                  rows={2}
                  className="ddm-field w-full rounded-2xl px-3 py-2 text-[13px] resize-none"
                  style={{ background: "#fff", border: "1px solid #e4e1e6" }}
                />
              </div>

              <button
                onClick={() => save()}
                className="ddm-save relative z-10 w-full h-12 rounded-2xl font-bold text-white mt-1"
                style={{ background: `linear-gradient(155deg, ${meta.grad[0]}, ${meta.grad[1]})`, boxShadow: `0 14px 30px -10px ${meta.glow}` }}
              >
                שמירה
              </button>

              {/* Available for any day that exists in storage at all — including a day that only
                  has a clock-in, or was cleared to blank — so it can always be removed entirely. */}
              {!!entry && (
                <button
                  onClick={handleDeleteDay}
                  className="relative z-10 w-full h-11 rounded-xl font-bold flex items-center justify-center gap-1.5"
                  style={{ background: confirmDelete ? "#DC2626" : "rgba(220,38,38,0.06)", color: confirmDelete ? "#fff" : "#DC2626" }}
                >
                  <span className="material-symbols-outlined text-[17px]">{confirmDelete ? "check" : "delete_forever"}</span>
                  {confirmDelete ? "לחצו שוב לאישור המחיקה" : "מחיקת היום לגמרי"}
                </button>
              )}
            </div>
          )}
        </RxDialog.Content>
      </RxDialog.Portal>
    </RxDialog.Root>
  );
}
