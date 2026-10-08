import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { isFullyAuthenticated, isLocalAuthenticated } from "@/lib/localAuth";
import {
  calcHoursBetween,
  computeCurrentMonthToDatePayroll,
  computeDayPay,
  computeMonthlyPayroll,
  computeProjectedMonthlyPayroll,
  computeUnpaidLeaveDeductions,
  DayStatus,
  effectiveDayFraction,
  formatHM,
  fractionMultiplier,
  getCountedHours,
  getEffectiveDailyTarget,
  getSettings,
  getWorkHoursForMonth,
  MonthlyPayroll,
  UserSettings,
  WorkHour,
} from "@/lib/localData";
import { LH, STATUS_META } from "./tokens";
import { LHHeader, LHBottomNav, LHLoadingScreen, globalStyle } from "./Shared";

const MONTH_HE = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
const WEEKDAY_HE = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const money = (n: number) => `₪${Math.round(n).toLocaleString("he-IL")}`;
const dateKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Gross for a payroll snapshot: base hours + overtime + fixed additions + food allowance. No taxes,
 * no deductions of any kind — this page only ever tracks what's earned before anything is withheld. */
const grossOf = (p: MonthlyPayroll) => p.regularPay + p.overtimePay + p.fixedComponentsTotal + p.foodAllowanceAddition;

interface FeedPart {
  category: DayStatus;
  hours: number;
  paid: boolean;
}

/** Any day, whatever shape it was saved in, as a flat list of "this much of the day was X, paid or not". */
const feedParts = (w: WorkHour, target: number): FeedPart[] => {
  if (w.dayParts && w.dayParts.length > 0) {
    return w.dayParts
      .filter((p) => (p.hours || 0) > 0.001)
      .map((p) => ({
        category: p.category,
        hours: p.hours,
        paid: p.category === "off" ? false : p.category === "worked" || p.category === "holiday" ? true : p.paid !== false,
      }));
  }
  const st = (w.status || "worked") as DayStatus;
  if (st === "worked") return getCountedHours(w) > 0.001 ? [{ category: "worked", hours: getCountedHours(w), paid: true }] : [];
  const parts: FeedPart[] = [];
  const workedPortion = w.start_time && w.end_time ? calcHoursBetween(w.start_time, w.end_time) : 0;
  if (workedPortion > 0.001) parts.push({ category: "worked", hours: workedPortion, paid: true });
  if (st === "off") {
    parts.push({ category: "off", hours: target * fractionMultiplier(w.fraction), paid: false });
  } else if (st === "holiday") {
    const f = effectiveDayFraction(w, target);
    parts.push({ category: "holiday", hours: f * target, paid: true });
    if (f < 0.999) parts.push({ category: "vacation", hours: (1 - f) * target, paid: w.remainderPaid !== false });
  } else {
    parts.push({ category: st, hours: w.leaveHours !== undefined ? w.leaveHours : fractionMultiplier(w.fraction) * target, paid: w.paid !== false });
  }
  return parts.filter((p) => p.hours > 0.001);
};

const LEAVE_MESSAGE: Record<string, string> = {
  "sick:true": "תרגיש טוב! פיצינו אותך על יום המחלה על חשבון ימי המחלה שלך.",
  "sick:false": "מקווה שתרגיש טוב, אבל המערכת לא יכולה לתת לך כסף על ימי מחלה שמעבר ליתרה.",
  "vacation:true": "מגיעה לך חופשה! היום שולם על חשבון ימי החופשה שלך.",
  "vacation:false": "חופשה ללא תשלום — לא נצבר שכר על החלק הזה.",
  "holiday:true": "חג — היום שולם במלואו.",
  "off:false": "יום לא עובד — לא נצבר שכר.",
};

export default function DesignPreviewReports() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [currentMonth, setCurrentMonth] = useState(() => new Date());

  useEffect(() => {
    if (!isLocalAuthenticated()) {
      navigate("/design-preview/login");
      return;
    }
    isFullyAuthenticated().then((ok) => {
      if (!ok) {
        navigate("/design-preview/login");
        return;
      }
      setSettings(getSettings());
      setLoading(false);
    });
  }, [navigate]);

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const now = new Date();
  const isCurrentMonth = now.getFullYear() === year && now.getMonth() === month;

  const payroll = useMemo(() => (settings ? computeMonthlyPayroll(year, month, settings) : null), [settings, year, month]);
  const projected = useMemo(() => (settings ? computeProjectedMonthlyPayroll(year, month, settings) : null), [settings, year, month]);
  const toDate = useMemo(() => (settings ? computeCurrentMonthToDatePayroll(year, month, settings) : null), [settings, year, month]);
  const deductions = useMemo(() => (settings ? computeUnpaidLeaveDeductions(year, month, settings) : []), [settings, year, month]);

  // The daily feed: one message per day that has ended (today only once its shift is closed).
  const feed = useMemo(() => {
    if (!settings) return [];
    const todayKey = dateKey(new Date());
    const lostByDate = new Map<string, number>();
    for (const d of deductions) lostByDate.set(d.date, (lostByDate.get(d.date) || 0) + d.amount);
    return getWorkHoursForMonth(year, month)
      .filter((w) => {
        if (w.date > todayKey) return false;
        const open = (w.status === "worked" || !w.status) && !!w.start_time && !w.end_time && !w.dayParts?.length;
        if (open) return false;
        return w.date < todayKey || !!w.dayParts?.length || !!w.end_time || (!!w.status && w.status !== "worked");
      })
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((w) => {
        const target = getEffectiveDailyTarget(w.date, w, settings);
        const parts = feedParts(w, target);
        const { pay, overtimePay } = computeDayPay(w, settings);
        const lines: string[] = [];
        const workedHours = parts.filter((p) => p.category === "worked").reduce((s, p) => s + p.hours, 0);
        const onlyWorked = parts.length > 0 && parts.every((p) => p.category === "worked");
        if (workedHours > 0.001) {
          if (onlyWorked && workedHours >= target - 0.01) {
            lines.push(overtimePay > 0.5 ? "קיבלת שכר מלא על היום, ועוד שעות נוספות." : "קיבלת שכר מלא על היום.");
          } else if (onlyWorked) {
            lines.push(`שולם על ${formatHM(workedHours)} שעות עבודה.`);
          } else {
            lines.push(`עבדת ${formatHM(workedHours)} שעות — שולמו במלואן.`);
          }
        }
        const seen = new Set<string>();
        for (const p of parts) {
          if (p.category === "worked") continue;
          const key = `${p.category}:${p.paid}`;
          if (seen.has(key) || !LEAVE_MESSAGE[key]) continue;
          seen.add(key);
          lines.push(LEAVE_MESSAGE[key]);
        }
        const dominant = parts.length ? parts.reduce((a, b) => (b.hours > a.hours ? b : a)) : null;
        const isMixed = new Set(parts.map((p) => p.category)).size > 1;
        return { w, lines, pay, lost: lostByDate.get(w.date) || 0, category: dominant?.category ?? "worked", isMixed };
      });
  }, [settings, deductions, year, month]);

  if (loading || !settings || !payroll || !projected || !toDate) return <LHLoadingScreen />;

  const forecastGross = grossOf(projected);
  const accruedGross = isCurrentMonth ? grossOf(toDate) : grossOf(payroll);
  const heroValue = accruedGross;
  const progress = isCurrentMonth && forecastGross > 0 ? Math.min(100, (accruedGross / forecastGross) * 100) : 100;
  const payoutNext = settings.overtime_payout_month === "next";
  const breakdownSource = isCurrentMonth ? projected : payroll;
  const breakdown = [
    { label: "שעות רגילות", amount: breakdownSource.regularPay, color: "#7639FF" },
    { label: payoutNext ? "שעות נוספות מחודש קודם" : "שעות נוספות", amount: breakdownSource.overtimePay, color: "#00A8CC" },
    { label: "תוספות קבועות", amount: breakdownSource.fixedComponentsTotal, color: "#0F766E" },
    { label: "תקציב אוכל", amount: breakdownSource.foodAllowanceAddition, color: "#F59E0B" },
  ].filter((r) => r.amount > 0.5);
  const breakdownTotal = breakdown.reduce((s, r) => s + r.amount, 0) || 1;
  const vacationDeductions = deductions.filter((d) => d.type === "vacation");
  const sickDeductions = deductions.filter((d) => d.type === "sick");
  const vacationTotal = vacationDeductions.reduce((s, d) => s + d.amount, 0);
  const sickTotal = sickDeductions.reduce((s, d) => s + d.amount, 0);
  const totalDeducted = vacationTotal + sickTotal;
  const totalHours = payroll.regularHours + payroll.overtimeHours;

  return (
    <div dir="rtl" className="min-h-screen w-full flex flex-col" style={{ background: LH.background, color: LH.onSurface, fontFamily: "'Heebo', system-ui, sans-serif" }}>
      <style>{globalStyle}</style>
      <LHHeader />
      <main className="flex-1 relative w-full pt-20 pb-32 px-6 overflow-x-hidden">
        <div className="flex flex-col w-full relative min-h-full max-w-[440px] mx-auto">
          <div className="absolute top-0 right-0 left-0 h-64 blur-3xl pointer-events-none z-0" style={{ background: `${LH.primary}0D` }} />

          {/* Month selector */}
          <div className="pt-6 pb-2 relative z-10 flex items-center justify-center">
            <div className="bg-white/80 backdrop-blur-xl rounded-full px-6 py-3 flex items-center gap-6 border border-white" style={{ boxShadow: "0 8px 24px rgba(35,50,100,0.05)" }}>
              <button onClick={() => setCurrentMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))} style={{ color: LH.onSurfaceVariant }}>
                <span className="material-symbols-outlined">chevron_right</span>
              </button>
              <span className="text-[18px] font-bold" style={{ color: LH.onSurface }}>{MONTH_HE[month]} {year}</span>
              <button onClick={() => setCurrentMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))} style={{ color: LH.onSurfaceVariant }}>
                <span className="material-symbols-outlined">chevron_left</span>
              </button>
            </div>
          </div>

          {/* Hero — what has been earned (gross) so far this month */}
          <div className="lh-rise py-8 flex flex-col items-center relative z-10">
            <span className="text-[12px] font-bold tracking-[0.15em] mb-3 uppercase" style={{ color: LH.primary }}>
              {isCurrentMonth ? "צבור עד היום · ברוטו" : "סה״כ ברוטו לחודש"}
            </span>
            <h1 className="leading-none tracking-tighter tabular-nums" style={{ fontSize: 60, fontWeight: 800, color: LH.onSurface }}>
              {money(heroValue)}
            </h1>
            <div className="mt-5 flex items-center gap-2 px-4 py-1.5 rounded-full shadow-sm" style={{ background: LH.surfaceContainerHigh }}>
              <span className="material-symbols-outlined text-[16px]" style={{ color: LH.primary }}>schedule</span>
              <span className="text-[12px] font-bold tracking-[0.08em]" style={{ color: LH.onSurfaceVariant }}>{formatHM(totalHours)} שעות · {payroll.daysWorked} ימי עבודה</span>
            </div>

            {isCurrentMonth && (
              <div className="w-full mt-7">
                <div className="flex items-end justify-between mb-2">
                  <div>
                    <span className="text-[10.5px] font-bold tracking-[0.1em] uppercase block" style={{ color: LH.onSurfaceVariant }}>סכום משוער לסוף החודש</span>
                    <span className="text-[11px] font-medium" style={{ color: "#8892b0" }}>ברוטו, בהנחה שתעבוד לפי הלוח שלך</span>
                  </div>
                  <span className="tabular-nums leading-none" dir="ltr" style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif", fontSize: 26, fontWeight: 800, color: LH.primary }}>
                    {money(forecastGross)}
                  </span>
                </div>
                <div className="h-3 rounded-full overflow-hidden" style={{ background: "rgba(35,50,100,0.08)" }}>
                  <div className="h-full rounded-full" style={{ width: `${progress}%`, background: "linear-gradient(90deg,#7639FF,#00D2FF)", transition: "width .9s cubic-bezier(.16,1,.3,1)" }} />
                </div>
                <span className="text-[11px] font-bold mt-1.5 block" style={{ color: LH.onSurfaceVariant }}>{Math.round(progress)}% מהסכום המשוער כבר נצבר</span>
              </div>
            )}
            {isCurrentMonth && forecastGross - accruedGross > 0.5 && totalDeducted > 0.5 && (
              <p className="text-[11px] mt-2 self-start" style={{ color: "#DC2626" }}>הסכום המשוער כבר כולל קיזוז של {money(totalDeducted)} על ימי חופש/מחלה שאינם משולמים.</p>
            )}
          </div>

          {/* What the amount is made of — gross components only */}
          <div className="lh-rise relative z-10 mb-4" style={{ animationDelay: "80ms" }}>
            <div className="rounded-[28px] p-6" style={{ background: `${LH.surface}CC`, backdropFilter: "blur(20px)", boxShadow: "0 8px 30px rgba(35,50,100,0.04)", border: "1px solid rgba(255,255,255,0.5)" }}>
              <div className="flex items-center gap-2 mb-4">
                <span className="material-symbols-outlined text-[18px]" style={{ color: LH.primary }}>waterfall_chart</span>
                <span className="text-[13px] font-extrabold tracking-[0.1em] uppercase" style={{ color: LH.onSurfaceVariant }}>
                  ממה מורכב הסכום{isCurrentMonth ? " · תחזית לסוף החודש" : ""}
                </span>
              </div>
              {breakdown.length === 0 ? (
                <span className="text-[12.5px]" style={{ color: LH.onSurfaceVariant }}>עדיין לא נצבר שכר החודש.</span>
              ) : (
                <>
                  <div className="flex h-2.5 rounded-full overflow-hidden mb-4" style={{ background: "rgba(35,50,100,0.07)" }}>
                    {breakdown.map((r) => (
                      <div key={r.label} style={{ width: `${(r.amount / breakdownTotal) * 100}%`, background: r.color }} />
                    ))}
                  </div>
                  <div className="flex flex-col gap-3">
                    {breakdown.map((r) => (
                      <div key={r.label} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full" style={{ background: r.color }} />
                          <span className="text-[13px] font-semibold" style={{ color: LH.onSurface }}>{r.label}</span>
                        </div>
                        <span dir="ltr" className="tabular-nums text-[15px] font-bold" style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif", color: LH.onSurface }}>+{money(r.amount)}</span>
                      </div>
                    ))}
                    <div className="flex items-center justify-between pt-3" style={{ borderTop: `1px solid ${LH.surfaceVariant}` }}>
                      <span className="text-[13px] font-extrabold" style={{ color: LH.onSurface }}>סה״כ ברוטו</span>
                      <span dir="ltr" className="tabular-nums text-[18px] font-extrabold" style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif", color: LH.primary }}>{money(breakdownTotal)}</span>
                    </div>
                  </div>
                </>
              )}
              {payoutNext && payroll.ownOvertimeHours > 0.01 && (
                <p className="text-[11px] mt-4 leading-snug" style={{ color: LH.onSurfaceVariant }}>
                  החודש נצברו {formatHM(payroll.ownOvertimeHours)} שעות נוספות ({money(payroll.ownOvertimePay)}) — הן יתווספו לברוטו של החודש הבא.
                </p>
              )}
            </div>
          </div>

          {/* The only thing that ever reduces the amount: vacation/sick days that weren't covered */}
          {deductions.length > 0 && (
            <div
              className="lh-rise rounded-[28px] p-6 relative overflow-hidden mb-4 z-10"
              style={{ animationDelay: "120ms", background: "linear-gradient(165deg, rgba(24,20,34,0.97), rgba(48,20,28,0.96))", boxShadow: "0 20px 50px -12px rgba(220,38,38,0.28)" }}
            >
              <div className="absolute -left-10 -top-10 w-44 h-44 rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, rgba(220,38,38,0.35), transparent 70%)" }} />
              <div className="absolute -right-14 bottom-0 w-52 h-52 rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, rgba(251,146,60,0.16), transparent 70%)" }} />

              <div className="flex items-center justify-between relative z-10 mb-5">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "rgba(255,255,255,0.1)" }}>
                    <span className="material-symbols-outlined text-[18px]" style={{ color: "#F87171" }}>receipt_long</span>
                  </div>
                  <span className="text-[13px] font-extrabold tracking-[0.1em] uppercase" style={{ color: "rgba(255,255,255,0.75)" }}>קיזוזים בשכר</span>
                </div>
                <span dir="ltr" className="block leading-none" style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif", fontSize: 26, fontWeight: 800, color: "#fff" }}>
                  −{money(totalDeducted)}
                </span>
              </div>

              <div className={`grid gap-2.5 relative z-10 mb-5 ${vacationDeductions.length > 0 && sickDeductions.length > 0 ? "grid-cols-2" : "grid-cols-1"}`}>
                {vacationDeductions.length > 0 && (
                  <div className="rounded-2xl p-3.5" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <span className="material-symbols-outlined text-[15px]" style={{ color: "#60A5FA" }}>beach_access</span>
                      <span className="text-[10.5px] font-bold" style={{ color: "rgba(255,255,255,0.6)" }}>חריגת חופש · {vacationDeductions.length} ימים</span>
                    </div>
                    <span dir="ltr" className="block" style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif", fontSize: 18, fontWeight: 700, color: "#93C5FD" }}>−{money(vacationTotal)}</span>
                  </div>
                )}
                {sickDeductions.length > 0 && (
                  <div className="rounded-2xl p-3.5" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <span className="material-symbols-outlined text-[15px]" style={{ color: "#FBBF24" }}>thermostat</span>
                      <span className="text-[10.5px] font-bold" style={{ color: "rgba(255,255,255,0.6)" }}>חריגת מחלה · {sickDeductions.length} ימים</span>
                    </div>
                    <span dir="ltr" className="block" style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif", fontSize: 18, fontWeight: 700, color: "#FCD34D" }}>−{money(sickTotal)}</span>
                  </div>
                )}
              </div>

              <div className="flex flex-col relative z-10">
                {deductions.map((d, i) => {
                  const color = d.type === "vacation" ? "#60A5FA" : "#FBBF24";
                  const isLast = i === deductions.length - 1;
                  return (
                    <div key={`${d.date}-${d.type}`} className="flex gap-3">
                      <div className="flex flex-col items-center pt-1.5 shrink-0">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color, boxShadow: `0 0 8px 1px ${color}66` }} />
                        {!isLast && <span className="w-px flex-1" style={{ background: "rgba(255,255,255,0.14)" }} />}
                      </div>
                      <div className={`flex items-center justify-between gap-2 flex-1 ${isLast ? "pb-0" : "pb-4"}`}>
                        <div className="flex flex-col">
                          <span className="text-[12.5px] font-bold" style={{ color: "#fff" }}>
                            {new Date(`${d.date}T00:00:00`).toLocaleDateString("he-IL", { day: "numeric", month: "long" })}
                          </span>
                          <span className="text-[11px]" style={{ color: "rgba(255,255,255,0.5)" }}>
                            {formatHM(d.unpaidHours)} לא משולמות · {d.unpaidDays.toFixed(2)} מיום
                          </span>
                        </div>
                        <span dir="ltr" className="tabular-nums text-[14px] font-bold shrink-0" style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif", color }}>−{money(d.amount)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Daily feed — one plain-language line per finished day */}
          <div className="lh-rise relative z-10" style={{ animationDelay: "160ms" }}>
            <div className="flex items-center gap-2 mb-3 px-1">
              <span className="material-symbols-outlined text-[18px]" style={{ color: LH.primary }}>event_note</span>
              <h2 className="text-[16px] font-bold" style={{ color: LH.onSurface }}>יומן שכר יומי</h2>
            </div>
            {feed.length === 0 ? (
              <div className="rounded-[24px] p-5 text-[12.5px]" style={{ background: `${LH.onSurfaceVariant}0A`, color: LH.onSurfaceVariant }}>
                עדיין אין ימים שהסתיימו החודש. כל יום שיסתיים יופיע כאן עם מה שנצבר בו.
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {feed.map(({ w, lines, pay, lost, category, isMixed }) => {
                  const d = new Date(`${w.date}T00:00:00`);
                  const m = STATUS_META[category];
                  return (
                    <div
                      key={w.date}
                      className="rounded-[22px] p-4 flex items-center gap-3"
                      style={{ background: "#fff", boxShadow: "0 6px 20px -10px rgba(35,50,100,0.15)", borderInlineStart: `4px solid ${isMixed ? "#7639FF" : m.grad[0]}` }}
                    >
                      <div className="flex flex-col items-center shrink-0" style={{ width: 44 }}>
                        <span className="text-[20px] font-extrabold leading-none tabular-nums" style={{ color: LH.onSurface }}>{d.getDate()}</span>
                        <span className="text-[10.5px] font-bold mt-1" style={{ color: LH.onSurfaceVariant }}>{WEEKDAY_HE[d.getDay()]}</span>
                      </div>
                      <div className="flex-1 min-w-0 flex flex-col gap-1">
                        {lines.length === 0 ? (
                          <span className="text-[12.5px] font-medium" style={{ color: LH.onSurfaceVariant }}>אין שכר על היום הזה.</span>
                        ) : (
                          lines.map((l) => (
                            <span key={l} className="text-[12.5px] font-semibold leading-snug" style={{ color: LH.onSurface }}>{l}</span>
                          ))
                        )}
                      </div>
                      <div className="flex flex-col items-end shrink-0">
                        <span dir="ltr" className="tabular-nums text-[15px] font-bold" style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif", color: pay > 0.5 ? "#0F766E" : LH.onSurfaceVariant }}>
                          +{money(pay)}
                        </span>
                        {lost > 0.5 && (
                          <span dir="ltr" className="tabular-nums text-[11px] font-bold" style={{ color: "#DC2626" }}>−{money(lost)}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </main>
      <LHBottomNav active="reports" foodEnabled={!!settings.food_card_enabled} />
    </div>
  );
}
