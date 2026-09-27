import { useEffect, useState } from "react";
import { toast } from "sonner";
import * as RxDialog from "@radix-ui/react-dialog";
import {
  computeCumulativeAccrued,
  computeCumulativeLeaveUsage,
  DayPart,
  getCholHamoedWorkFraction,
  getEffectiveDailyTarget,
  saveSettings,
  UserSettings,
  upsertWorkHour,
  WorkHour,
} from "@/lib/localData";

const modalStyle = `
  @keyframes chm-overlay-in { from { opacity: 0; } to { opacity: 1; } }
  .chm-overlay[data-state="open"] { animation: chm-overlay-in .3s ease both; }
  @keyframes chm-card-in { 0% { opacity: 0; transform: scale(0.9) translateY(16px); } 100% { opacity: 1; transform: scale(1) translateY(0); } }
  .chm-card { animation: chm-card-in .35s cubic-bezier(.2,1.1,.4,1) both; }
`;

type Step = "choice" | "fullyPaid" | "balanceOverflow" | "setLimit" | "limitExceeded";

interface CholHamoedModalProps {
  open: boolean;
  date: Date | null;
  existingEntry: WorkHour | undefined;
  settings: UserSettings | null;
  onClose: () => void;
  onSaved: () => void;
  onSettingsUpdated: (s: UserSettings) => void;
  /** Starts today's live clock, exactly like a normal clock-in, but capped at the reduced chol
   * hamoed work target instead of the full daily target — overtime kicks in past that point. */
  onStartWork: (targetHours: number) => void;
}

const dateKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * "חול המועד" — the intermediate days of a Jewish festival, when only part of a normal workday is
 * actually worked (or taken as vacation) and the rest is always a company-paid חג, per
 * UserSettings.chol_hamoed_mode. Meant to be tapped at the START of the day, before clocking in.
 */
export function CholHamoedModal({ open, date, existingEntry, settings, onClose, onSaved, onSettingsUpdated, onStartWork }: CholHamoedModalProps) {
  const [step, setStep] = useState<Step>("choice");
  const [limitDraft, setLimitDraft] = useState("3");

  useEffect(() => {
    if (open && settings) {
      setStep(getCholHamoedWorkFraction(settings) <= 0 ? "fullyPaid" : "choice");
      setLimitDraft("3");
    }
  }, [open, settings]);

  if (!date || !settings) return null;

  const target = getEffectiveDailyTarget(dateKey(date), existingEntry, settings);
  const workFraction = getCholHamoedWorkFraction(settings);
  const workHours = target * workFraction;
  const holidayHours = target - workHours;

  const remainingVacationBalance = (): number => {
    const accrued = computeCumulativeAccrued(settings.annual_vacation_days || 0, settings.vacation_accrual_method, settings.employment_start_date);
    const used = computeCumulativeLeaveUsage("vacation", settings);
    return accrued - used;
  };

  const saveMixedDay = (vacationPaid: boolean) => {
    const parts: DayPart[] = [
      { id: "chm-vacation", category: "vacation", hours: workHours, paid: vacationPaid },
      { id: "chm-holiday", category: "holiday", hours: holidayHours },
    ];
    upsertWorkHour({
      ...existingEntry,
      date: dateKey(date),
      hours_worked: parts.reduce((s, p) => s + p.hours, 0),
      start_time: null,
      end_time: null,
      segments: undefined,
      status: undefined,
      fraction: undefined,
      paid: undefined,
      dayParts: parts,
      overtimeTargetHours: undefined,
    });
    toast.success(`חול המועד סומן — חופש${vacationPaid ? "" : " (לא משולם)"} + חג`);
    onSaved();
    onClose();
  };

  const saveFullyPaidHoliday = () => {
    const parts: DayPart[] = [{ id: "chm-holiday", category: "holiday", hours: target }];
    upsertWorkHour({
      ...existingEntry,
      date: dateKey(date),
      hours_worked: target,
      start_time: null,
      end_time: null,
      segments: undefined,
      status: undefined,
      fraction: undefined,
      paid: undefined,
      dayParts: parts,
      overtimeTargetHours: undefined,
    });
    toast.success("חול המועד סומן — חג מלא");
    onSaved();
    onClose();
  };

  const chooseVacation = () => {
    const remaining = remainingVacationBalance();
    const projected = remaining - workFraction;
    if (projected >= 0) {
      saveMixedDay(true);
      return;
    }
    const limit = settings.vacation_negative_limit;
    if (limit === undefined) {
      setStep("balanceOverflow");
      return;
    }
    if (projected >= -limit) {
      saveMixedDay(true);
      return;
    }
    setStep("limitExceeded");
  };

  const saveLimitAndRetry = () => {
    const n = Math.max(0, Math.round(Number(limitDraft) || 0));
    const updated: UserSettings = { ...settings, vacation_negative_limit: n };
    saveSettings(updated);
    onSettingsUpdated(updated);
    const remaining = remainingVacationBalance();
    const projected = remaining - workFraction;
    if (projected >= -n) {
      saveMixedDay(true);
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
  const grad: [string, string] = ["#7639FF", "#B39CFF"];
  const glow = "rgba(118,57,255,0.5)";
  const tint = "rgba(118,57,255,0.08)";

  return (
    <RxDialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <RxDialog.Portal>
        <style>{modalStyle}</style>
        <RxDialog.Overlay className="chm-overlay fixed inset-0 z-50" style={{ background: "rgba(16,26,70,0.55)", backdropFilter: "blur(4px)" }} />
        <RxDialog.Content className="fixed inset-0 z-50 flex items-center justify-center outline-none px-6">
          <div className="chm-card w-full max-w-[380px] rounded-[32px] p-7 flex flex-col gap-5 relative overflow-hidden" style={cardBase}>
            <RxDialog.Title className="sr-only">חול המועד</RxDialog.Title>
            <RxDialog.Close className="absolute top-5 right-5 w-8 h-8 rounded-full flex items-center justify-center z-10" style={{ background: "rgba(35,50,100,0.08)", color: "#8892b0" }}>
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>close</span>
            </RxDialog.Close>

            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0" style={{ background: `linear-gradient(155deg, ${grad[0]}, ${grad[1]})`, boxShadow: `0 12px 26px -8px ${glow}` }}>
                <span className="material-symbols-outlined text-white" style={{ fontSize: 22 }}>festival</span>
              </div>
              <div>
                <div className="text-[16px] font-bold" style={{ color: "#101A46" }}>חול המועד</div>
                <div className="text-[12px] font-medium" style={{ color: "#8892b0" }}>{date.toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" })}</div>
              </div>
            </div>

            {step === "choice" && (
              <>
                <div className="text-[13px] font-semibold leading-relaxed" style={{ color: "#46464f" }}>
                  היום מוגדר אצלך כ-{workFraction === 0.5 ? "חצי" : "3/4"} יום עבודה + {workFraction === 0.5 ? "חצי" : "1/4"} יום חג משולם על חשבון החברה. איך תרצה לחתום את היום?
                </div>
                <button
                  onClick={() => {
                    onStartWork(workHours);
                    onClose();
                  }}
                  className="w-full h-auto py-3.5 px-4 rounded-2xl font-bold text-white text-right flex items-center justify-between gap-2"
                  style={{ background: `linear-gradient(155deg, ${grad[0]}, ${grad[1]})`, boxShadow: `0 16px 32px -10px ${glow}` }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 20 }}>work</span>
                  <span className="flex-1">
                    <span className="block text-[13.5px]">יום עבודה</span>
                    <span className="block text-[11px] font-medium opacity-80">
                      השעון סופר אחורה ל-{workHours.toFixed(1)} שעות; אחר כך שאר היום נכנס אוטומטית כחג. כל דקה מעבר לכך היא שעות נוספות.
                    </span>
                  </span>
                </button>
                <button
                  onClick={chooseVacation}
                  className="w-full h-auto py-3.5 px-4 rounded-2xl font-bold text-right flex items-center justify-between gap-2"
                  style={{ background: tint, color: grad[0] }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 20 }}>beach_access</span>
                  <span className="flex-1">
                    <span className="block text-[13.5px]">חופש</span>
                    <span className="block text-[11px] font-medium opacity-80">
                      {workHours.toFixed(1)} שעות יורדות מיתרת החופש, {holidayHours.toFixed(1)} שעות חג משולמות.
                    </span>
                  </span>
                </button>
              </>
            )}

            {step === "fullyPaid" && (
              <>
                <div className="text-[13px] font-semibold leading-relaxed" style={{ color: "#46464f" }}>
                  לפי ההגדרות שלך, חול המועד הוא חג מלא — יום שלם על חשבון החברה, בלי עבודה ובלי ניכוי מהיתרה שלך.
                </div>
                <button
                  onClick={saveFullyPaidHoliday}
                  className="w-full h-12 rounded-2xl font-bold text-white"
                  style={{ background: `linear-gradient(155deg, ${grad[0]}, ${grad[1]})`, boxShadow: `0 16px 32px -10px ${glow}` }}
                >
                  סימון היום כחג מלא
                </button>
              </>
            )}

            {step === "balanceOverflow" && (
              <>
                <div className="text-[13px] font-semibold leading-relaxed" style={{ color: "#46464f" }}>
                  אין לך מספיק ימי חופש ליתרה הזו. איך תרצה להמשיך?
                </div>
                <button
                  onClick={() => setStep("setLimit")}
                  className="w-full h-12 rounded-2xl font-bold text-white"
                  style={{ background: `linear-gradient(155deg, ${grad[0]}, ${grad[1]})`, boxShadow: `0 16px 32px -10px ${glow}` }}
                >
                  להיכנס למינוס
                </button>
                <button onClick={() => saveMixedDay(false)} className="w-full h-12 rounded-2xl font-bold" style={{ background: tint, color: grad[0] }}>
                  יום לא משולם
                </button>
              </>
            )}

            {step === "setLimit" && (
              <>
                <div className="text-[13px] font-semibold leading-relaxed" style={{ color: "#46464f" }}>עד כמה ימים אפשר להיכנס למינוס בימי חופש במקום העבודה שלך?</div>
                <input
                  type="number"
                  min={0}
                  value={limitDraft}
                  onChange={(e) => setLimitDraft(e.target.value)}
                  className="w-full h-12 rounded-2xl px-4 text-[16px] font-bold text-center"
                  style={{ background: tint, color: "#101A46", border: "none", outline: "none" }}
                  dir="ltr"
                />
                <button
                  onClick={saveLimitAndRetry}
                  className="w-full h-12 rounded-2xl font-bold text-white"
                  style={{ background: `linear-gradient(155deg, ${grad[0]}, ${grad[1]})`, boxShadow: `0 16px 32px -10px ${glow}` }}
                >
                  שמירה והמשך
                </button>
              </>
            )}

            {step === "limitExceeded" && (
              <>
                <div className="flex items-center gap-2 rounded-xl px-3 py-2.5" style={{ background: "rgba(220,38,38,0.08)" }}>
                  <span className="material-symbols-outlined" style={{ color: "#DC2626", fontSize: 18 }}>warning</span>
                  <span className="text-[12.5px] font-semibold" style={{ color: "#DC2626" }}>שים לב — אינך יכול לחתום עוד ימי חופש, אתה במקסימום היתרה שהוגדרה.</span>
                </div>
                <button
                  onClick={() => setStep("setLimit")}
                  className="w-full h-12 rounded-2xl font-bold text-white"
                  style={{ background: `linear-gradient(155deg, ${grad[0]}, ${grad[1]})`, boxShadow: `0 16px 32px -10px ${glow}` }}
                >
                  עדכון המגבלה
                </button>
                <button onClick={() => saveMixedDay(false)} className="w-full h-12 rounded-2xl font-bold" style={{ background: tint, color: grad[0] }}>
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
