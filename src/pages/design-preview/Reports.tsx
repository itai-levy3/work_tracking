import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { isFullyAuthenticated, isLocalAuthenticated } from "@/lib/localAuth";
import {
  applyPayrollExtras,
  applyPayrollFieldOverrides,
  computeCurrentMonthToDatePayroll,
  computeMonthlyPayroll,
  computeProjectedMonthlyPayroll,
  computeUnpaidLeaveDeductions,
  deletePayrollActual,
  formatHM,
  getPayrollActual,
  getProfileFirstName,
  getSettings,
  getWorkHoursForMonth,
  MonthlyPayroll,
  savePayrollActual,
  UserSettings,
} from "@/lib/localData";
import { buildDayMessage, isFinishedDay } from "@/lib/dayMessages";
import { exportMonthlyPayslipPdf } from "@/lib/pdfExport";
import { LH, STATUS_META } from "./tokens";
import { LHHeader, LHBottomNav, LHLoadingScreen, globalStyle } from "./Shared";

const MONTH_HE = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
const WEEKDAY_HE = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const money = (n: number) => `₪${Math.round(n).toLocaleString("he-IL")}`;
const dateKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** The estimate can never land exactly on a real payslip — this is the honest margin shown beside every net figure. */
const NET_MARGIN = 200;

/** Gross for a payroll snapshot: base hours + overtime (this month's or the previous month's, per the
 * user's setting) + fixed additions + food allowance. Nothing withheld yet. */
const grossOf = (p: MonthlyPayroll) => p.regularPay + p.overtimePay + p.fixedComponentsTotal + p.foodAllowanceAddition;

/** Half-circle gauge made of ticks — filled ticks glow from violet to cyan up to `pct`. */
function TickGauge({ pct }: { pct: number }) {
  const N = 36;
  const cx = 110;
  const cy = 110;
  return (
    <svg viewBox="0 0 220 124" className="w-full" style={{ maxWidth: 260 }}>
      <defs>
        <linearGradient id="rp-tick" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="#7639FF" />
          <stop offset="100%" stopColor="#00D2FF" />
        </linearGradient>
      </defs>
      {Array.from({ length: N }).map((_, i) => {
        const t = i / (N - 1);
        const a = Math.PI - t * Math.PI;
        const filled = t * 100 <= pct + 0.001;
        const major = i % 5 === 0;
        const r1 = major ? 78 : 84;
        const r2 = 98;
        return (
          <line
            key={i}
            x1={cx + Math.cos(a) * r1}
            y1={cy - Math.sin(a) * r1}
            x2={cx + Math.cos(a) * r2}
            y2={cy - Math.sin(a) * r2}
            stroke={filled ? "url(#rp-tick)" : "rgba(255,255,255,0.16)"}
            strokeWidth={major ? 4.2 : 3}
            strokeLinecap="round"
            style={filled ? { filter: "drop-shadow(0 0 3px rgba(0,210,255,0.55))" } : undefined}
          />
        );
      })}
    </svg>
  );
}

export default function DesignPreviewReports() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  const [actualInput, setActualInput] = useState("");
  // Bumped after every save so the saved record is re-read — getPayrollActual isn't reactive state.
  const [actualsVersion, setActualsVersion] = useState(0);

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
  const todayKey = dateKey(now);
  const isCurrentMonth = now.getFullYear() === year && now.getMonth() === month;
  const isPastMonth = year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth());

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const savedActual = useMemo(() => getPayrollActual(year, month), [year, month, actualsVersion]);
  useEffect(() => {
    setActualInput(savedActual ? String(Math.round(savedActual.actualNet)) : "");
  }, [savedActual]);

  // Net is always an estimate: if no manual tax amounts were ever entered, income tax / National
  // Insurance / health insurance are computed automatically from the official brackets (pension and
  // training fund still follow their own switches). Gross figures don't depend on this at all.
  // Corrections the user already saved for this month (tax fields, one-off additions) are kept.
  const estSettings = useMemo(() => {
    if (!settings) return null;
    const base = applyPayrollFieldOverrides(settings, savedActual?.fieldOverrides);
    const noManualTax = !(base.manual_income_tax || 0) && !(base.manual_national_insurance || 0) && !(base.manual_health_insurance || 0);
    return base.statutory_deduction_mode === "automatic" || !noManualTax ? base : { ...base, statutory_deduction_mode: "automatic" as const };
  }, [settings, savedActual]);
  const withExtras = (p: MonthlyPayroll) => applyPayrollExtras(p, savedActual?.extraAdditions, savedActual?.extraDeductions);
  const payroll = useMemo(() => (estSettings ? withExtras(computeMonthlyPayroll(year, month, estSettings)) : null), [estSettings, year, month]); // eslint-disable-line react-hooks/exhaustive-deps
  const projected = useMemo(() => (estSettings ? withExtras(computeProjectedMonthlyPayroll(year, month, estSettings)) : null), [estSettings, year, month]); // eslint-disable-line react-hooks/exhaustive-deps
  const toDate = useMemo(() => (estSettings ? withExtras(computeCurrentMonthToDatePayroll(year, month, estSettings)) : null), [estSettings, year, month]); // eslint-disable-line react-hooks/exhaustive-deps
  const deductions = useMemo(() => (settings ? computeUnpaidLeaveDeductions(year, month, settings) : []), [settings, year, month]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const monthEntries = useMemo(() => getWorkHoursForMonth(year, month), [year, month, settings]);
  // The month's net becomes "final" once its last day has been clocked out of (or the month is over).
  const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
  const todayEntry = monthEntries.find((w) => w.date === todayKey);
  const todayClosed = !todayEntry || isFinishedDay(todayEntry, todayKey);
  const isFinal = isPastMonth || (isCurrentMonth && now.getDate() === lastDayOfMonth && todayClosed);

  // One friendly message for today (only while viewing the current month): today's, once it's
  // finished — otherwise the most recent finished day, labelled with when it was.
  const spotlight = useMemo(() => {
    if (!settings || !isCurrentMonth) return null;
    const finished = monthEntries.filter((w) => isFinishedDay(w, todayKey)).sort((a, b) => b.date.localeCompare(a.date));
    const w = finished[0];
    if (!w) return null;
    const msg = buildDayMessage(w, settings);
    if (msg.lines.length === 0) return null;
    return { w, msg, isToday: w.date === todayKey };
  }, [settings, isCurrentMonth, monthEntries, todayKey]);

  if (loading || !settings || !payroll || !projected || !toDate) return <LHLoadingScreen />;

  const forecastGross = grossOf(projected);
  const accruedGross = isCurrentMonth ? grossOf(toDate) : grossOf(payroll);
  const progress = isCurrentMonth ? (forecastGross > 0 ? Math.min(100, (accruedGross / forecastGross) * 100) : 0) : 100;
  const netToDate = isCurrentMonth ? toDate.netPay : payroll.netPay;
  const netForecast = isCurrentMonth ? projected.netPay : payroll.netPay;
  const hasActual = !!savedActual;
  const actualValue = parseFloat(actualInput);
  const canSaveActual = actualInput.trim() !== "" && !Number.isNaN(actualValue) && actualValue >= 0;
  const payoutNext = settings.overtime_payout_month === "next";
  const breakdownSource = isCurrentMonth ? projected : payroll;
  const breakdown = [
    { label: "שעות רגילות", amount: breakdownSource.regularPay, color: "#7639FF" },
    { label: payoutNext ? "שעות נוספות מחודש קודם" : "שעות נוספות", amount: breakdownSource.overtimePay, color: "#00A8CC" },
    { label: "תוספות קבועות", amount: breakdownSource.fixedComponentsTotal, color: "#0F766E" },
    { label: "תקציב אוכל", amount: breakdownSource.foodAllowanceAddition, color: "#F59E0B" },
  ].filter((r, i) => i < 2 || r.amount > 0.5);
  const breakdownTotal = breakdown.reduce((s, r) => s + r.amount, 0) || 1;
  const vacationDeductions = deductions.filter((d) => d.type === "vacation");
  const sickDeductions = deductions.filter((d) => d.type === "sick");
  const vacationTotal = vacationDeductions.reduce((s, d) => s + d.amount, 0);
  const sickTotal = sickDeductions.reduce((s, d) => s + d.amount, 0);
  const totalDeducted = vacationTotal + sickTotal;
  const totalHours = payroll.regularHours + payroll.overtimeHours;

  const saveActual = () => {
    if (!canSaveActual) return;
    savePayrollActual({ year, month, actualNet: actualValue, estimatedNet: netForecast });
    setActualsVersion((v) => v + 1);
    toast.success("השכר בפועל נשמר — הוא יופיע גם בדוח ה-PDF");
  };
  const clearActual = () => {
    deletePayrollActual(year, month);
    setActualsVersion((v) => v + 1);
    toast.success("חזרנו להערכה של המערכת");
  };

  const NetCard = ({ title, sub, value, accent }: { title: string; sub: string; value: number; accent: string }) => (
    <div className="rounded-[26px] p-5 relative overflow-hidden" style={{ background: "#fff", boxShadow: "0 12px 34px -14px rgba(35,50,100,0.22)", border: `1px solid ${accent}22` }}>
      <div className="absolute -left-8 -top-8 w-28 h-28 rounded-full pointer-events-none" style={{ background: `radial-gradient(circle, ${accent}22, transparent 70%)` }} />
      <div className="relative z-10">
        <span className="text-[10.5px] font-extrabold tracking-[0.12em] uppercase block" style={{ color: accent }}>{title}</span>
        <span className="text-[10.5px] font-medium block mt-0.5 mb-3" style={{ color: "#8892b0" }}>{sub}</span>
        <div className="flex items-end justify-between gap-2">
          <span dir="ltr" className="tabular-nums leading-none" style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif", fontSize: 30, fontWeight: 800, color: LH.onSurface, letterSpacing: "-0.03em" }}>
            {money(value)}
          </span>
          <span className="text-[10.5px] font-bold px-2 py-1 rounded-full shrink-0" style={{ background: `${accent}14`, color: accent }}>
            ±{money(NET_MARGIN)} סטייה
          </span>
        </div>
      </div>
    </div>
  );

  return (
    <div dir="rtl" className="min-h-screen w-full flex flex-col" style={{ background: LH.background, color: LH.onSurface, fontFamily: "'Heebo', system-ui, sans-serif" }}>
      <style>{globalStyle}</style>
      <LHHeader />
      <main className="flex-1 relative w-full pt-20 pb-32 px-5 overflow-x-hidden">
        <div className="flex flex-col w-full relative min-h-full max-w-[440px] mx-auto gap-4">
          <div className="absolute top-0 right-0 left-0 h-64 blur-3xl pointer-events-none z-0" style={{ background: `${LH.primary}0D` }} />

          {/* Month selector + PDF export */}
          <div className="pt-6 relative z-10 flex items-center justify-center gap-2">
            <div className="bg-white/80 backdrop-blur-xl rounded-full px-6 py-3 flex items-center gap-6 border border-white" style={{ boxShadow: "0 8px 24px rgba(35,50,100,0.05)" }}>
              <button onClick={() => setCurrentMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))} style={{ color: LH.onSurfaceVariant }}>
                <span className="material-symbols-outlined">chevron_right</span>
              </button>
              <span className="text-[18px] font-bold" style={{ color: LH.onSurface }}>{MONTH_HE[month]} {year}</span>
              <button onClick={() => setCurrentMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))} style={{ color: LH.onSurfaceVariant }}>
                <span className="material-symbols-outlined">chevron_left</span>
              </button>
            </div>
            <button
              onClick={async () => {
                try {
                  await exportMonthlyPayslipPdf(year, month, settings, getProfileFirstName());
                  toast.success("הדוח יוצא בהצלחה");
                } catch {
                  toast.error("שגיאה בייצוא");
                }
              }}
              title="ייצוא דוח PDF לחודש הזה"
              className="w-12 h-12 rounded-full flex items-center justify-center shrink-0 bg-white/80 backdrop-blur-xl border border-white"
              style={{ boxShadow: "0 8px 24px rgba(35,50,100,0.05)", color: LH.primary }}
            >
              <span className="material-symbols-outlined text-[20px]">picture_as_pdf</span>
            </button>
          </div>

          {/* Today's message — a single friendly line about the latest finished day (older days show
              theirs when opened from the attendance card) */}
          {spotlight && (
            <div
              className="lh-rise z-10 rounded-[24px] px-5 py-4 flex items-center gap-3"
              style={{ background: "#fff", boxShadow: "0 12px 30px -14px rgba(35,50,100,0.25)", borderInlineStart: `4px solid ${spotlight.msg.isMixed ? "#7639FF" : STATUS_META[spotlight.msg.category].grad[0]}` }}
            >
              <div className="flex-1 min-w-0 flex flex-col gap-1">
                <span className="text-[10.5px] font-extrabold tracking-[0.1em] uppercase" style={{ color: LH.onSurfaceVariant }}>
                  {spotlight.isToday ? "היום" : new Date(`${spotlight.w.date}T00:00:00`).toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" })}
                </span>
                {spotlight.msg.lines.map((l) => (
                  <span key={l} className="text-[13.5px] font-semibold leading-snug" style={{ color: LH.onSurface }}>{l}</span>
                ))}
              </div>
              <span dir="ltr" className="tabular-nums text-[16px] font-bold shrink-0" style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif", color: spotlight.msg.pay > 0.5 ? "#0F766E" : LH.onSurfaceVariant }}>
                +{money(spotlight.msg.pay)}
              </span>
            </div>
          )}

          {/* Hero — gross accrued so far, on a tick gauge toward the month-end estimate */}
          <div
            className="lh-rise rounded-[34px] px-6 pt-7 pb-6 relative overflow-hidden z-10"
            style={{ background: "linear-gradient(160deg, #0E1743 0%, #2A1B6E 60%, #15316B 100%)", boxShadow: "0 28px 60px -18px rgba(42,27,110,0.55)" }}
          >
            <div className="absolute -right-12 -top-12 w-52 h-52 rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, rgba(118,57,255,0.5), transparent 70%)" }} />
            <div className="absolute -left-16 bottom-0 w-56 h-56 rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, rgba(0,210,255,0.28), transparent 70%)" }} />
            <div className="relative z-10 flex flex-col items-center">
              {isFinal ? (
                <span className="flex items-center gap-1.5 px-3.5 py-1 rounded-full text-[11px] font-extrabold tracking-[0.14em] uppercase" style={{ background: "rgba(25,206,160,0.18)", color: "#7FF0D0", border: "1px solid rgba(25,206,160,0.45)" }}>
                  <span className="material-symbols-outlined text-[15px]">verified</span>
                  ברוטו סופי
                </span>
              ) : (
                <span className="text-[11px] font-bold tracking-[0.16em] uppercase" style={{ color: "rgba(255,255,255,0.65)" }}>
                  {isCurrentMonth ? "צבור עד היום · ברוטו" : "סה״כ ברוטו לחודש"}
                </span>
              )}
              <div className="relative w-full flex flex-col items-center mt-1">
                <TickGauge pct={progress} />
                <div className="absolute bottom-0 flex flex-col items-center">
                  <span dir="ltr" className="tabular-nums leading-none" style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif", fontSize: 40, fontWeight: 800, color: "#fff", letterSpacing: "-0.04em" }}>
                    {money(accruedGross)}
                  </span>
                  <span className="text-[12px] font-bold mt-1" style={{ color: "#7FEFFF" }}>
                    {Math.round(progress)}%{isCurrentMonth ? " מהסכום המשוער" : ""}
                  </span>
                </div>
              </div>
              {isCurrentMonth && (
                <div className="w-full mt-5 flex items-center justify-between rounded-2xl px-4 py-3" style={{ background: "rgba(255,255,255,0.09)", border: "1px solid rgba(255,255,255,0.12)" }}>
                  <div>
                    <span className="text-[10.5px] font-bold tracking-[0.1em] uppercase block" style={{ color: "rgba(255,255,255,0.6)" }}>משוער לסוף החודש · ברוטו</span>
                    <span className="text-[10.5px]" style={{ color: "rgba(255,255,255,0.45)" }}>אם תעבוד לפי הלוח שלך</span>
                  </div>
                  <span dir="ltr" className="tabular-nums" style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif", fontSize: 22, fontWeight: 800, color: "#fff" }}>{money(forecastGross)}</span>
                </div>
              )}
              <div className="mt-4 flex items-center gap-2 px-4 py-1.5 rounded-full" style={{ background: "rgba(255,255,255,0.1)" }}>
                <span className="material-symbols-outlined text-[15px]" style={{ color: "#7FEFFF" }}>schedule</span>
                <span className="text-[11.5px] font-bold" style={{ color: "rgba(255,255,255,0.85)" }}>{formatHM(totalHours)} שעות · {payroll.daysWorked} ימי עבודה</span>
              </div>
            </div>
          </div>

          {/* FINAL net — only once the month is over, or on its last day after the final clock-out. One
              highlighted figure that already includes everything withheld (unpaid vacation/sick days,
              income tax, National Insurance, pension, training fund); editable to the real salary. */}
          {isFinal && (
            <div
              className="lh-rise z-10 rounded-[30px] p-6 relative overflow-hidden"
              style={{ background: "linear-gradient(160deg,#064E3B,#0F766E 55%,#19CEA0)", boxShadow: "0 26px 56px -18px rgba(15,118,110,0.6)" }}
            >
              <div className="absolute -left-10 -top-10 w-44 h-44 rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, rgba(255,255,255,0.28), transparent 70%)" }} />
              <div className="relative z-10">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-extrabold tracking-[0.14em] uppercase" style={{ color: "rgba(255,255,255,0.85)" }}>
                    {hasActual ? "נטו בפועל · מאושר" : `משכורת נטו משוערת · ${MONTH_HE[month]}`}
                  </span>
                  <span className="material-symbols-outlined text-[20px]" style={{ color: "rgba(255,255,255,0.9)" }}>{hasActual ? "verified" : "account_balance_wallet"}</span>
                </div>
                <span dir="ltr" className="tabular-nums leading-none block mt-3" style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif", fontSize: 46, fontWeight: 800, color: "#fff", letterSpacing: "-0.04em" }}>
                  {money(hasActual ? savedActual!.actualNet : netForecast)}
                </span>
                <div className="flex flex-wrap items-center gap-2 mt-3">
                  {!hasActual && (
                    <span className="text-[11px] font-bold px-2.5 py-1 rounded-full" style={{ background: "rgba(255,255,255,0.18)", color: "#fff" }}>±{money(NET_MARGIN)} סטייה</span>
                  )}
                  {hasActual && (
                    <span className="text-[11px] font-bold px-2.5 py-1 rounded-full" style={{ background: "rgba(255,255,255,0.18)", color: "#fff" }}>
                      ההערכה כיום: {money(netForecast)} · פער {money(Math.abs(savedActual!.actualNet - netForecast))}
                    </span>
                  )}
                </div>
                <p className="text-[11.5px] font-medium leading-snug mt-3" style={{ color: "rgba(255,255,255,0.8)" }}>
                  כולל את הקיזוזים: ימים ללא תשלום, מס הכנסה, ביטוח לאומי, פנסיה והשתלמות. שעות נוספות כלולות לפי ההגדרה שלך.
                </p>
                <div className="mt-4 pt-4" style={{ borderTop: "1px solid rgba(255,255,255,0.25)" }}>
                  <span className="text-[11px] font-bold block mb-2" style={{ color: "rgba(255,255,255,0.85)" }}>קיבלת סכום אחר? עדכן כאן — זה יתעדכן גם בדוח ה-PDF</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={actualInput}
                      onChange={(e) => setActualInput(e.target.value)}
                      placeholder={String(Math.round(netForecast))}
                      className="flex-1 h-12 rounded-2xl px-4 text-[18px] font-bold min-w-0"
                      style={{ background: "rgba(255,255,255,0.95)", border: "none", color: LH.onSurface }}
                    />
                    <button onClick={saveActual} disabled={!canSaveActual} className="h-12 px-5 rounded-2xl font-bold disabled:opacity-40" style={{ background: "#fff", color: "#0F766E" }}>
                      שמירה
                    </button>
                  </div>
                  {hasActual && (
                    <button onClick={clearActual} className="mt-2.5 text-[12px] font-bold underline" style={{ color: "rgba(255,255,255,0.85)" }}>
                      חזרה להערכת המערכת
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Net estimates while the month is still running — updated every day */}
          {!isFinal && (
          <div className="lh-rise z-10 flex flex-col gap-3" style={{ animationDelay: "60ms" }}>
            <div className="flex items-center gap-2 px-1">
              <span className="material-symbols-outlined text-[18px]" style={{ color: "#0F766E" }}>account_balance_wallet</span>
              <h2 className="text-[16px] font-bold" style={{ color: LH.onSurface }}>
                {isFinal ? "משכורת נטו משוערת — סופית לחודש" : "משכורת נטו משוערת"}
              </h2>
            </div>
            {hasActual && (
              <div className="rounded-[26px] p-5 relative overflow-hidden" style={{ background: "linear-gradient(160deg,#0F766E,#19CEA0)", boxShadow: "0 18px 40px -14px rgba(15,118,110,0.5)" }}>
                <span className="text-[10.5px] font-extrabold tracking-[0.12em] uppercase block" style={{ color: "rgba(255,255,255,0.8)" }}>נטו בפועל · מאושר</span>
                <span dir="ltr" className="tabular-nums leading-none block mt-2" style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif", fontSize: 34, fontWeight: 800, color: "#fff" }}>{money(savedActual!.actualNet)}</span>
                <span className="text-[11px] font-semibold block mt-2" style={{ color: "rgba(255,255,255,0.85)" }}>
                  ההערכה הייתה {money(savedActual!.estimatedNet)} · פער של {money(Math.abs(savedActual!.actualNet - savedActual!.estimatedNet))}
                </span>
              </div>
            )}
            {isCurrentMonth && !isFinal && (
              <NetCard title="נטו מתעדכן · נכון להיום" sub="מתעדכן בכל יום, לפי מה שנצבר עד עכשיו" value={netToDate} accent="#0F766E" />
            )}
            <NetCard
              title={isFinal ? "נטו משוער סופי" : "נטו משוער לסוף החודש"}
              sub={isFinal ? "כולל שעות נוספות לפי ההגדרה שלך — חושב אחרי היציאה האחרונה" : "אם תעבוד לפי הלוח · כולל שעות נוספות לפי ההגדרה שלך"}
              value={netForecast}
              accent="#7639FF"
            />
          </div>
          )}

          {/* The real salary received — replaces the estimate and goes into the PDF report */}
          {!isFinal && (
          <div className="lh-rise z-10 rounded-[26px] p-5" style={{ animationDelay: "90ms", background: `${LH.surface}CC`, backdropFilter: "blur(20px)", border: "1px solid rgba(255,255,255,0.5)", boxShadow: "0 8px 30px rgba(35,50,100,0.04)" }}>
            <div className="flex items-center gap-2 mb-3">
              <span className="material-symbols-outlined text-[18px]" style={{ color: LH.primary }}>fact_check</span>
              <span className="text-[13px] font-extrabold tracking-[0.08em] uppercase" style={{ color: LH.onSurfaceVariant }}>המשכורת שקיבלתי בפועל</span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={actualInput}
                onChange={(e) => setActualInput(e.target.value)}
                placeholder="0"
                className="flex-1 h-12 rounded-2xl px-4 text-[18px] font-bold min-w-0"
                style={{ background: "#fff", border: "1px solid #e4e1e6", color: LH.onSurface }}
              />
              <span className="text-[13px] font-bold" style={{ color: LH.onSurfaceVariant }}>₪ נטו</span>
              <button
                onClick={saveActual}
                disabled={!canSaveActual}
                className="h-12 px-5 rounded-2xl font-bold text-white disabled:opacity-40"
                style={{ background: "linear-gradient(155deg,#7639FF,#00D2FF)" }}
              >
                שמירה
              </button>
            </div>
            {hasActual && (
              <button onClick={clearActual} className="mt-3 text-[12px] font-bold underline" style={{ color: LH.onSurfaceVariant }}>
                חזרה להערכת המערכת
              </button>
            )}
          </div>
          )}

          {/* What the gross is made of */}
          <div className="lh-rise z-10 rounded-[28px] p-6" style={{ animationDelay: "120ms", background: `${LH.surface}CC`, backdropFilter: "blur(20px)", boxShadow: "0 8px 30px rgba(35,50,100,0.04)", border: "1px solid rgba(255,255,255,0.5)" }}>
            <div className="flex items-center gap-2 mb-4">
              <span className="material-symbols-outlined text-[18px]" style={{ color: LH.primary }}>waterfall_chart</span>
              <span className="text-[13px] font-extrabold tracking-[0.1em] uppercase" style={{ color: LH.onSurfaceVariant }}>
                ממה מורכב הברוטו{isCurrentMonth ? " · תחזית לסוף החודש" : ""}
              </span>
            </div>
            {breakdown.every((r) => r.amount <= 0.5) ? (
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
            {payoutNext && (
              <div className="mt-4 flex items-center justify-between rounded-2xl px-4 py-3" style={{ background: "rgba(0,168,204,0.07)", border: "1px dashed rgba(0,168,204,0.35)" }}>
                <div className="flex flex-col">
                  <span className="text-[12.5px] font-bold" style={{ color: LH.onSurface }}>שעות נוספות שנצברו החודש</span>
                  <span className="text-[10.5px]" style={{ color: LH.onSurfaceVariant }}>{formatHM(payroll.ownOvertimeHours)} שעות · יתווספו לברוטו של החודש הבא</span>
                </div>
                <span dir="ltr" className="tabular-nums text-[15px] font-bold shrink-0" style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif", color: "#00A8CC" }}>{money(payroll.ownOvertimePay)}</span>
              </div>
            )}
          </div>

          {/* Vacation/sick days the balance couldn't cover — the one thing that reduces the gross itself */}
          {deductions.length > 0 && (
            <div
              className="lh-rise rounded-[28px] p-6 relative overflow-hidden z-10"
              style={{ animationDelay: "150ms", background: "linear-gradient(165deg, rgba(24,20,34,0.97), rgba(48,20,28,0.96))", boxShadow: "0 20px 50px -12px rgba(220,38,38,0.28)" }}
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
        </div>
      </main>
      <LHBottomNav active="reports" foodEnabled={!!settings.food_card_enabled} />
    </div>
  );
}
