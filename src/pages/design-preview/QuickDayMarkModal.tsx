import { useEffect, useState } from "react";
import { toast } from "sonner";
import * as RxDialog from "@radix-ui/react-dialog";
import {
  computeCumulativeAccrued,
  computeCumulativeLeaveUsage,
  DayFraction,
  fractionMultiplier,
  getEffectiveDailyTarget,
  saveSettings,
  UserSettings,
  upsertWorkHour,
  WorkHour,
} from "@/lib/localData";
import { STATUS_META } from "./tokens";

const modalStyle = `
  @keyframes qdm-overlay-in { from { opacity: 0; } to { opacity: 1; } }
  .qdm-overlay[data-state="open"] { animation: qdm-overlay-in .3s ease both; }
  @keyframes qdm-card-in { 0% { opacity: 0; transform: scale(0.9) translateY(16px); } 100% { opacity: 1; transform: scale(1) translateY(0); } }
  .qdm-card { animation: qdm-card-in .35s cubic-bezier(.2,1.1,.4,1) both; }
`;

type QuickMarkKind = "vacation" | "sick" | "holiday" | "off";
type Step = "fraction" | "balanceOverflow" | "setLimit" | "limitExceeded" | "saving";

interface QuickDayMarkModalProps {
  open: boolean;
  kind: QuickMarkKind | null;
  date: Date | null;
  existingEntry: WorkHour | undefined;
  settings: UserSettings | null;
  onClose: () => void;
  onSaved: () => void;
  onSettingsUpdated: (s: UserSettings) => void;
}

const FRACTIONS: { key: DayFraction; label: string }[] = [
  { key: "full", label: "יום מלא" },
  { key: "three_quarters", label: "3/4 יום" },
  { key: "half", label: "חצי יום" },
  { key: "quarter", label: "1/4 יום" },
];

const dateKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const KIND_TITLE: Record<QuickMarkKind, string> = { vacation: "יום חופש", sick: "יום מחלה", holiday: "חג", off: "יום ללא עבודה" };

/**
 * Quick same-day marking for the 4 round Home buttons (vacation/sick/holiday/off) — an alternative
 * to opening the full day editor. Vacation/sick (and a partial holiday's automatic vacation
 * remainder — see WorkHour.remainderPaid) run through a balance-aware flow: enough balance saves
 * immediately, an empty balance offers "go negative" vs. "unpaid", and once a negative-limit is
 * configured, exceeding it always forces a choice between raising the limit or marking unpaid.
 */
export function QuickDayMarkModal({ open, kind, date, existingEntry, settings, onClose, onSaved, onSettingsUpdated }: QuickDayMarkModalProps) {
  const [step, setStep] = useState<Step>("fraction");
  const [fraction, setFraction] = useState<DayFraction>("full");
  const [limitDraft, setLimitDraft] = useState("3");
  const [balanceLeaveType, setBalanceLeaveType] = useState<"vacation" | "sick">("vacation");
  const [pendingSave, setPendingSave] = useState<{ requestedFraction: number; leaveType: "vacation" | "sick" } | null>(null);

  useEffect(() => {
    if (open) {
      setStep("fraction");
      setFraction("full");
      setPendingSave(null);
    }
  }, [open, kind]);

  if (!date || !kind || !settings) return null;

  const meta = STATUS_META[kind === "off" ? "off" : kind];

  const remainingBalance = (leaveType: "vacation" | "sick"): number => {
    const annual = leaveType === "vacation" ? settings.annual_vacation_days || 0 : settings.annual_sick_days || 0;
    const method = leaveType === "vacation" ? settings.vacation_accrual_method : settings.sick_accrual_method;
    const accrued = computeCumulativeAccrued(annual, method, settings.employment_start_date);
    const used = computeCumulativeLeaveUsage(leaveType, settings);
    return accrued - used;
  };

  /**
   * `paid` describes the outcome of the balance-sensitive portion: for vacation/sick/off it's the
   * whole day; for holiday (which is always paid in full for its own fraction) it's specifically
   * whether the automatic remainder — the rest of the day when fraction !== "full" — is paid
   * vacation or unpaid.
   */
  const finalizeSave = (paid: boolean) => {
    const ds = dateKey(date);
    const target = getEffectiveDailyTarget(ds, existingEntry, settings);
    if (kind === "holiday") {
      const holidayPortion = fractionMultiplier(fraction);
      const paidPortion = fraction === "full" || paid ? 1 : holidayPortion;
      upsertWorkHour({
        ...existingEntry,
        date: ds,
        status: "holiday",
        fraction,
        paid: true,
        remainderPaid: fraction === "full" ? undefined : paid,
        hours_worked: target * paidPortion,
        start_time: existingEntry?.start_time ?? null,
        end_time: existingEntry?.end_time ?? null,
      });
    } else {
      upsertWorkHour({
        ...existingEntry,
        date: ds,
        status: kind,
        fraction,
        paid,
        hours_worked: paid ? target * fractionMultiplier(fraction) : 0,
        start_time: existingEntry?.start_time ?? null,
        end_time: existingEntry?.end_time ?? null,
      });
    }
    toast.success(`${KIND_TITLE[kind]} סומן להיום${paid === false ? " (לא משולם)" : ""}`);
    onSaved();
    onClose();
  };

  const runBalanceFlow = (leaveType: "vacation" | "sick", requestedFraction: number) => {
    const remaining = remainingBalance(leaveType);
    const projected = remaining - requestedFraction;
    if (projected >= 0) {
      finalizeSave(true);
      return;
    }
    const limit = leaveType === "vacation" ? settings.vacation_negative_limit : settings.sick_negative_limit;
    setBalanceLeaveType(leaveType);
    setPendingSave({ requestedFraction, leaveType });
    if (limit === undefined) {
      setStep("balanceOverflow");
      return;
    }
    if (projected >= -limit) {
      finalizeSave(true);
      return;
    }
    setStep("limitExceeded");
  };

  const handleFractionConfirm = () => {
    const requestedFraction = fractionMultiplier(fraction);
    if (kind === "off") {
      finalizeSave(false);
      return;
    }
    if (kind === "vacation" || kind === "sick") {
      runBalanceFlow(kind, requestedFraction);
      return;
    }
    // holiday
    if (fraction === "full") {
      finalizeSave(true);
      return;
    }
    runBalanceFlow("vacation", 1 - requestedFraction);
  };

  const saveLimitAndRetry = () => {
    const n = Math.max(0, Math.round(Number(limitDraft) || 0));
    const updated: UserSettings = {
      ...settings,
      ...(balanceLeaveType === "vacation" ? { vacation_negative_limit: n } : { sick_negative_limit: n }),
    };
    saveSettings(updated);
    onSettingsUpdated(updated);
    if (!pendingSave) {
      setStep("fraction");
      return;
    }
    const remaining = remainingBalance(balanceLeaveType);
    const projected = remaining - pendingSave.requestedFraction;
    if (projected >= -n) {
      finalizeSave(true);
    } else {
      setStep("limitExceeded");
    }
  };

  const cardBase = {
    background: "linear-gradient(180deg, rgba(255,255,255,0.97), rgba(248,250,255,0.99))",
    backdropFilter: "blur(30px)",
    boxShadow: "0 30px 70px -15px rgba(16,26,70,0.35)",
    border: "1px solid rgba(255,255,255,0.85)",
  } as const;

  return (
    <RxDialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <RxDialog.Portal>
        <style>{modalStyle}</style>
        <RxDialog.Overlay className="qdm-overlay fixed inset-0 z-50" style={{ background: "rgba(16,26,70,0.55)", backdropFilter: "blur(4px)" }} />
        <RxDialog.Content className="fixed inset-0 z-50 flex items-center justify-center outline-none px-6">
          <div className="qdm-card w-full max-w-[380px] rounded-[32px] p-7 flex flex-col gap-5 relative overflow-hidden" style={cardBase}>
            <RxDialog.Title className="sr-only">{KIND_TITLE[kind]}</RxDialog.Title>
            <RxDialog.Close className="absolute top-5 left-5 w-8 h-8 rounded-full flex items-center justify-center z-10" style={{ background: "rgba(35,50,100,0.08)", color: "#8892b0" }}>
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>close</span>
            </RxDialog.Close>

            <div className="flex items-center gap-3">
              <div
                className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0"
                style={{ background: `linear-gradient(155deg, ${meta.grad[0]}, ${meta.grad[1]})`, boxShadow: `0 12px 26px -8px ${meta.glow}` }}
              >
                <span className="material-symbols-outlined text-white" style={{ fontSize: 22 }}>{meta.icon}</span>
              </div>
              <div>
                <div className="text-[16px] font-bold" style={{ color: "#101A46" }}>{KIND_TITLE[kind]}</div>
                <div className="text-[12px] font-medium" style={{ color: "#8892b0" }}>{date.toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" })}</div>
              </div>
            </div>

            {step === "fraction" && (
              <>
                <div className="text-[13px] font-semibold" style={{ color: "#46464f" }}>כמה מהיום לחתום?</div>
                <div className="grid grid-cols-2 gap-2">
                  {FRACTIONS.map((f) => (
                    <button
                      key={f.key}
                      onClick={() => setFraction(f.key)}
                      className="h-11 rounded-xl text-[13px] font-bold transition-transform active:scale-95"
                      style={{
                        background: fraction === f.key ? `linear-gradient(155deg, ${meta.grad[0]}, ${meta.grad[1]})` : meta.tint,
                        color: fraction === f.key ? "#fff" : meta.grad[0],
                      }}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
                <button
                  onClick={handleFractionConfirm}
                  className="w-full h-12 rounded-2xl font-bold text-white"
                  style={{ background: `linear-gradient(155deg, ${meta.grad[0]}, ${meta.grad[1]})`, boxShadow: `0 16px 32px -10px ${meta.glow}` }}
                >
                  אישור
                </button>
              </>
            )}

            {step === "balanceOverflow" && (
              <>
                <div className="text-[13px] font-semibold leading-relaxed" style={{ color: "#46464f" }}>
                  אין לך מספיק ימי {balanceLeaveType === "vacation" ? "חופש" : "מחלה"} ליתרה הזו. איך תרצה להמשיך?
                </div>
                <button
                  onClick={() => setStep("setLimit")}
                  className="w-full h-12 rounded-2xl font-bold text-white"
                  style={{ background: `linear-gradient(155deg, ${meta.grad[0]}, ${meta.grad[1]})`, boxShadow: `0 16px 32px -10px ${meta.glow}` }}
                >
                  להיכנס למינוס
                </button>
                <button
                  onClick={() => pendingSave && finalizeSave(false)}
                  className="w-full h-12 rounded-2xl font-bold"
                  style={{ background: meta.tint, color: meta.grad[0] }}
                >
                  יום לא משולם
                </button>
              </>
            )}

            {step === "setLimit" && (
              <>
                <div className="text-[13px] font-semibold leading-relaxed" style={{ color: "#46464f" }}>
                  עד כמה ימים אפשר להיכנס למינוס ב{balanceLeaveType === "vacation" ? "ימי חופש" : "ימי מחלה"} במקום העבודה שלך?
                </div>
                <input
                  type="number"
                  min={0}
                  value={limitDraft}
                  onChange={(e) => setLimitDraft(e.target.value)}
                  className="w-full h-12 rounded-2xl px-4 text-[16px] font-bold text-center"
                  style={{ background: meta.tint, color: "#101A46", border: "none", outline: "none" }}
                  dir="ltr"
                />
                <button
                  onClick={saveLimitAndRetry}
                  className="w-full h-12 rounded-2xl font-bold text-white"
                  style={{ background: `linear-gradient(155deg, ${meta.grad[0]}, ${meta.grad[1]})`, boxShadow: `0 16px 32px -10px ${meta.glow}` }}
                >
                  שמירה והמשך
                </button>
              </>
            )}

            {step === "limitExceeded" && (
              <>
                <div className="flex items-center gap-2 rounded-xl px-3 py-2.5" style={{ background: "rgba(220,38,38,0.08)" }}>
                  <span className="material-symbols-outlined" style={{ color: "#DC2626", fontSize: 18 }}>warning</span>
                  <span className="text-[12.5px] font-semibold" style={{ color: "#DC2626" }}>
                    שים לב — אינך יכול לחתום עוד ימי {balanceLeaveType === "vacation" ? "חופש" : "מחלה"}, אתה במקסימום היתרה שהוגדרה.
                  </span>
                </div>
                <button
                  onClick={() => setStep("setLimit")}
                  className="w-full h-12 rounded-2xl font-bold text-white"
                  style={{ background: `linear-gradient(155deg, ${meta.grad[0]}, ${meta.grad[1]})`, boxShadow: `0 16px 32px -10px ${meta.glow}` }}
                >
                  עדכון המגבלה
                </button>
                <button
                  onClick={() => pendingSave && finalizeSave(false)}
                  className="w-full h-12 rounded-2xl font-bold"
                  style={{ background: meta.tint, color: meta.grad[0] }}
                >
                  אישור (יום לא משולם)
                </button>
              </>
            )}
          </div>
        </RxDialog.Content>
      </RxDialog.Portal>
    </RxDialog.Root>
  );
}
