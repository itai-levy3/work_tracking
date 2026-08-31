import { useEffect, useState } from "react";
import { toast } from "sonner";
import * as RxDialog from "@radix-ui/react-dialog";
import { calcHoursBetween, upsertWorkHour, WorkHour } from "@/lib/localData";

const WEEKDAY_HE_LONG = ["יום ראשון", "יום שני", "יום שלישי", "יום רביעי", "יום חמישי", "יום שישי", "שבת"];
const MONTH_HE = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];

const modalStyle = `
  @keyframes cie-overlay-in { from { opacity: 0; } to { opacity: 1; } }
  .cie-overlay[data-state="open"] { animation: cie-overlay-in .3s ease both; }
  @keyframes cie-card-in { 0% { opacity: 0; transform: scale(0.85) translateY(24px); } 60% { opacity: 1; transform: scale(1.02) translateY(-2px); } 100% { opacity: 1; transform: scale(1) translateY(0); } }
  .cie-card { animation: cie-card-in .5s cubic-bezier(.2,1.3,.4,1) both; }
  @keyframes cie-glow-pulse { 0%,100% { opacity: 0.5; transform: scale(0.96); } 50% { opacity: 0.85; transform: scale(1.05); } }
  .cie-glow { animation: cie-glow-pulse 3.2s ease-in-out infinite; }
  .cie-save { transition: transform .2s cubic-bezier(.34,1.56,.64,1), box-shadow .2s, filter .2s; }
  .cie-save:active { transform: scale(0.96); }
  @media (hover: hover) and (pointer: fine) {
    .cie-save:hover { transform: translateY(-2px); filter: brightness(1.06); }
  }
  .cie-time-tap { transition: transform .2s cubic-bezier(.34,1.56,.64,1); }
  .cie-time-tap:active { transform: scale(0.97); }
`;

interface ClockInEditModalProps {
  open: boolean;
  date: Date | null;
  entry: WorkHour | undefined;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * A screen with exactly one job — fixing a wrong clock-in time — instead of routing through the
 * general day-editing card (status picker, evening toggle, deficit banner, all irrelevant here).
 * The time is the whole point, so it's the whole design: one huge tappable number, the invisible
 * native <input type="time"> layered on top so the OS/browser picker still opens on tap while the
 * visible digits stay fully custom-styled.
 */
export function ClockInEditModal({ open, date, entry, onClose, onSaved }: ClockInEditModalProps) {
  const [draftTime, setDraftTime] = useState("");

  useEffect(() => {
    if (open) setDraftTime(entry?.start_time || "");
  }, [open, entry]);

  if (!date) return null;

  const save = () => {
    if (!entry || !draftTime) return;
    const segs: NonNullable<WorkHour["segments"]> =
      entry.segments && entry.segments.length > 0
        ? [...entry.segments]
        : [{ start: entry.start_time as string, end: entry.end_time, evening: entry.evening }];
    segs[segs.length - 1] = { ...segs[segs.length - 1], start: draftTime };
    const hours_worked = segs.reduce((s, seg) => s + calcHoursBetween(seg.start, seg.end), 0);
    upsertWorkHour({ ...entry, start_time: draftTime, segments: segs, hours_worked });
    onSaved();
    onClose();
    toast.success("שעת הכניסה עודכנה");
  };

  return (
    <RxDialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <RxDialog.Portal>
        <style>{modalStyle}</style>
        <RxDialog.Overlay className="cie-overlay fixed inset-0 z-50" style={{ background: "rgba(16,26,70,0.55)", backdropFilter: "blur(4px)" }} />
        <RxDialog.Content className="fixed inset-0 z-50 flex items-center justify-center outline-none px-6">
          <div
            className="cie-card w-full max-w-[360px] rounded-[40px] p-8 flex flex-col items-center gap-1 relative overflow-hidden"
            style={{
              background: "linear-gradient(180deg, rgba(255,255,255,0.97), rgba(248,250,255,0.99))",
              backdropFilter: "blur(30px)",
              boxShadow: "0 30px 70px -15px rgba(16,26,70,0.35)",
              border: "1px solid rgba(255,255,255,0.85)",
            }}
          >
            <div className="cie-glow absolute -top-20 -right-16 w-56 h-56 rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, rgba(118,57,255,0.28), transparent 70%)", filter: "blur(24px)" }} />
            <div className="cie-glow absolute -bottom-20 -left-16 w-56 h-56 rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, rgba(0,210,255,0.22), transparent 70%)", filter: "blur(24px)", animationDelay: "1.6s" }} />

            <RxDialog.Close className="absolute top-5 left-5 w-8 h-8 rounded-full flex items-center justify-center z-10" style={{ background: "rgba(35,50,100,0.08)", color: "#8892b0" }}>
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>close</span>
            </RxDialog.Close>

            <div className="w-14 h-14 rounded-full flex items-center justify-center relative z-10 mb-2" style={{ background: "linear-gradient(155deg,#7639FF,#00D2FF)", boxShadow: "0 14px 28px -8px rgba(118,57,255,0.5)" }}>
              <span className="material-symbols-outlined text-white" style={{ fontSize: 26, fontVariationSettings: "'FILL' 1" }}>login</span>
            </div>

            <RxDialog.Title className="text-[16px] font-bold relative z-10" style={{ color: "#101A46" }}>
              עריכת שעת כניסה
            </RxDialog.Title>
            <p className="text-[12.5px] font-medium relative z-10" style={{ color: "#8892b0" }}>
              {WEEKDAY_HE_LONG[date.getDay()]} · {date.getDate()} ב{MONTH_HE[date.getMonth()]}
            </p>

            <div className="cie-time-tap relative z-10 mt-6 mb-2 w-full flex justify-center">
              <span
                dir="ltr"
                className="tabular-nums leading-none"
                style={{
                  fontFamily: "'Bricolage Grotesque', 'Heebo', system-ui, sans-serif",
                  fontSize: 72,
                  fontWeight: 800,
                  letterSpacing: "-0.03em",
                  backgroundImage: "linear-gradient(160deg, #7639FF, #00D2FF)",
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                  color: "transparent",
                }}
              >
                {draftTime || "--:--"}
              </span>
              <input
                type="time"
                value={draftTime}
                onChange={(e) => setDraftTime(e.target.value)}
                aria-label="שעת כניסה"
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
            </div>
            <span className="text-[11px] font-bold uppercase tracking-[0.14em] relative z-10 mb-6" style={{ color: "#B0B7C9" }}>הקש כדי לשנות</span>

            <button
              onClick={save}
              className="cie-save relative z-10 w-full h-13 py-3.5 rounded-2xl font-bold text-white"
              style={{ background: "linear-gradient(155deg,#7639FF,#00D2FF)", boxShadow: "0 16px 32px -10px rgba(118,57,255,0.5)" }}
            >
              שמירה
            </button>
          </div>
        </RxDialog.Content>
      </RxDialog.Portal>
    </RxDialog.Root>
  );
}
