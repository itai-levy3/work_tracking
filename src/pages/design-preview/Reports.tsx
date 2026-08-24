import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { isFullyAuthenticated, isLocalAuthenticated } from "@/lib/localAuth";
import {
  computeEffectiveHourlyRateForMonth,
  computeMonthlyPayroll,
  computeProjectedMonthlyPayroll,
  formatHM,
  getProfileFirstName,
  getSettings,
  UserSettings,
} from "@/lib/localData";
import { exportMonthlyPayslipPdf } from "@/lib/pdfExport";
import { LH } from "./tokens";
import { LHHeader, LHBottomNav, globalStyle } from "./Shared";

const MONTH_HE = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
const money = (n: number) => `₪${n.toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

export default function DesignPreviewReports() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  const [salaryForecastOpen, setSalaryForecastOpen] = useState(false);

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

  const payroll = useMemo(() => {
    if (!settings) return null;
    return computeMonthlyPayroll(currentMonth.getFullYear(), currentMonth.getMonth(), settings);
  }, [settings, currentMonth]);

  // Full end-of-month forecast: same as `payroll` for already-earned figures, but the deduction
  // categories (and net) reflect the FULL month's expected gross — days that haven't happened yet
  // this month are projected from the schedule — so mid-month already shows what's really coming.
  const isCurrentMonth = new Date().getFullYear() === currentMonth.getFullYear() && new Date().getMonth() === currentMonth.getMonth();
  const projectedPayroll = useMemo(() => {
    if (!settings) return null;
    return computeProjectedMonthlyPayroll(currentMonth.getFullYear(), currentMonth.getMonth(), settings);
  }, [settings, currentMonth]);

  // Scheduled base-salary target for the viewed month (hours × rate, no overtime) — what the arc
  // gauge below measures progress against.
  const monthlyGoalHours = useMemo(() => {
    if (!settings) return 0;
    const y = currentMonth.getFullYear();
    const m = currentMonth.getMonth();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    let total = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const weekday = new Date(y, m, d).toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
      if (settings.work_days[weekday]) total += settings.hours_per_day[weekday] || 0;
    }
    return total;
  }, [settings, currentMonth]);

  if (loading || !settings || !payroll || !projectedPayroll) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: LH.background }}>
        <div className="w-12 h-12 rounded-full border-2 animate-spin" style={{ borderColor: `${LH.primary}33`, borderTopColor: LH.primary }} />
      </div>
    );
  }

  const totalHours = payroll.regularHours + payroll.overtimeHours;
  const grossTotal = payroll.regularPay + payroll.overtimePay + payroll.fixedComponentsTotal + payroll.foodAllowanceAddition;
  const forecastGrossTotal =
    projectedPayroll.regularPay + projectedPayroll.overtimePay + projectedPayroll.fixedComponentsTotal + projectedPayroll.foodAllowanceAddition;
  const additionsGrandTotal = projectedPayroll.fixedComponentsTotal + projectedPayroll.foodAllowanceAddition;
  const deductionsGrandTotal = forecastGrossTotal - projectedPayroll.netPay;
  const effectiveHourlyRate = computeEffectiveHourlyRateForMonth(currentMonth.getFullYear(), currentMonth.getMonth(), settings);
  const baseSalaryTarget = monthlyGoalHours * effectiveHourlyRate;
  const earnedPay = payroll.regularPay + payroll.overtimePay;
  const basePctAchieved = baseSalaryTarget > 0 ? (earnedPay / baseSalaryTarget) * 100 : 0;
  const bonusFromOvertimePct = Math.max(0, basePctAchieved - 100);
  const arcFillPct = Math.min(100, basePctAchieved);

  return (
    <div dir="rtl" className="min-h-screen w-full flex flex-col" style={{ background: LH.background, color: LH.onSurface, fontFamily: "'Heebo', system-ui, sans-serif" }}>
      <style>{globalStyle}</style>
      <LHHeader />
      <main className="flex-1 relative w-full pt-20 pb-32 px-6 overflow-x-hidden">
        <div className="flex flex-col w-full relative min-h-full max-w-[440px] mx-auto">
          <div className="absolute top-0 right-0 left-0 h-64 blur-3xl pointer-events-none z-0" style={{ background: `${LH.primary}0D` }} />

          {/* Month selector + PDF export */}
          <div className="pt-6 pb-4 relative z-10 flex items-center justify-center gap-2">
            <div className="bg-white/80 backdrop-blur-xl rounded-full px-6 py-3 flex items-center gap-6 border border-white" style={{ boxShadow: "0 8px 24px rgba(35,50,100,0.05)" }}>
              <button onClick={() => setCurrentMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))} style={{ color: LH.onSurfaceVariant }}>
                <span className="material-symbols-outlined">chevron_right</span>
              </button>
              <span className="text-[18px] font-bold" style={{ color: LH.onSurface }}>{MONTH_HE[currentMonth.getMonth()]} {currentMonth.getFullYear()}</span>
              <button onClick={() => setCurrentMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))} style={{ color: LH.onSurfaceVariant }}>
                <span className="material-symbols-outlined">chevron_left</span>
              </button>
            </div>
            <button
              onClick={async () => {
                try {
                  await exportMonthlyPayslipPdf(currentMonth.getFullYear(), currentMonth.getMonth(), settings, getProfileFirstName());
                  toast.success("התלוש יוצא בהצלחה");
                } catch {
                  toast.error("שגיאה בייצוא");
                }
              }}
              title="ייצוא תלוש PDF לחודש הזה"
              className="w-12 h-12 rounded-full flex items-center justify-center shrink-0 bg-white/80 backdrop-blur-xl border border-white"
              style={{ boxShadow: "0 8px 24px rgba(35,50,100,0.05)", color: LH.primary }}
            >
              <span className="material-symbols-outlined text-[20px]">picture_as_pdf</span>
            </button>
          </div>

          {/* Hero: estimated net pay */}
          <div className="lh-rise py-8 flex flex-col items-center justify-center relative z-10">
            <span className="text-[12px] font-bold tracking-[0.15em] mb-4 uppercase" style={{ color: LH.primary }}>משכורת נטו משוערת</span>
            <h1 className="leading-none tracking-tighter tabular-nums" style={{ fontSize: 60, fontWeight: 800, color: LH.onSurface }}>
              {money(payroll.netPay)}
            </h1>
            <div className="mt-6 flex items-center gap-2 px-4 py-1.5 rounded-full shadow-sm" style={{ background: LH.surfaceContainerHigh }}>
              <span className="material-symbols-outlined text-[16px]" style={{ color: LH.primary }}>schedule</span>
              <span className="text-[12px] font-bold tracking-[0.08em]" style={{ color: LH.onSurfaceVariant }}>{formatHM(totalHours)} שעות · {payroll.daysWorked} ימי עבודה</span>
            </div>
            {effectiveHourlyRate <= 0 && (
              <p className="text-[12px] mt-3" style={{ color: LH.error }}>לא הוגדר שכר שעתי — עדכנו בהגדרות כדי לראות אומדן אמיתי.</p>
            )}
          </div>

          {/* Base-salary progress arc — how much of the month's scheduled base pay has been earned,
              with overtime pushing it past 100%. */}
          <div className="lh-rise pb-8 relative z-10 w-full flex flex-col items-center" style={{ animationDelay: "60ms" }}>
            <div className="relative w-64 h-32 overflow-hidden">
              <svg className="absolute w-full h-full inset-0" viewBox="0 0 100 50">
                <path d="M 10 50 A 40 40 0 0 1 90 50" fill="none" stroke={LH.surfaceVariant} strokeLinecap="round" strokeWidth="6" />
              </svg>
              <svg className="absolute w-full h-full inset-0" style={{ filter: "drop-shadow(0 4px 12px rgba(0,1,20,0.2))" }} viewBox="0 0 100 50">
                <path
                  d="M 10 50 A 40 40 0 0 1 90 50"
                  fill="none" stroke="url(#gradient-arc-reports)" strokeLinecap="round" strokeWidth="6"
                  strokeDasharray={125.6}
                  strokeDashoffset={125.6 - (arcFillPct / 100) * 125.6}
                  style={{ transition: "stroke-dashoffset 1s ease" }}
                />
                <defs>
                  <linearGradient id="gradient-arc-reports" x1="0%" x2="100%" y1="0%" y2="0%">
                    <stop offset="0%" stopColor={bonusFromOvertimePct > 0 ? "#0F766E" : LH.primary} />
                    <stop offset="100%" stopColor={bonusFromOvertimePct > 0 ? "#19CEA0" : LH.secondary} />
                  </linearGradient>
                </defs>
              </svg>
              <div className="absolute bottom-0 w-full text-center">
                <span className="text-[32px] leading-[40px] tracking-[-0.02em] font-bold block" style={{ color: LH.onSurface }}>{Math.round(basePctAchieved)}%</span>
                <span className="text-[12px] font-bold tracking-[0.08em]" style={{ color: LH.onSurfaceVariant }}>מהמשכורת הבסיסית הושג</span>
              </div>
            </div>
            {bonusFromOvertimePct > 0.5 && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full -mt-1" style={{ background: "rgba(15,118,110,0.08)" }}>
                <span className="material-symbols-outlined text-[14px]" style={{ color: "#0F766E" }}>trending_up</span>
                <span className="text-[11.5px] font-bold" style={{ color: "#0F766E" }}>
                  {Math.round(bonusFromOvertimePct)}%+ הרווחת מעבר לבסיס בזכות שעות נוספות
                </span>
              </div>
            )}
          </div>

          {/* Payroll breakdown */}
          <div className="lh-rise pb-8 relative z-10" style={{ animationDelay: "120ms" }}>
            <div className="grid grid-cols-2 gap-5">
              <div className="rounded-[24px] p-5 relative overflow-hidden" style={{ background: `${LH.surface}CC`, backdropFilter: "blur(20px)", boxShadow: "0 8px 30px rgba(35,50,100,0.04)", border: "1px solid rgba(255,255,255,0.5)" }}>
                <span className="text-[12px] font-bold tracking-[0.08em] block mb-1" style={{ color: LH.onSurfaceVariant }}>שעות רגילות</span>
                <span className="text-[20px] leading-[28px] font-bold tracking-tight tabular-nums" style={{ color: LH.onSurface }}>{formatHM(payroll.regularHours)}</span>
                <div className="text-[13px] font-bold mt-1 tabular-nums" style={{ color: LH.primary }}>{money(payroll.regularPay)}</div>
              </div>
              <div className="rounded-[24px] p-5 relative overflow-hidden col-span-1" style={{ background: LH.primary, color: LH.onPrimary, boxShadow: "0 16px 45px rgba(0,1,20,0.15)" }}>
                <span className="text-[12px] font-bold tracking-[0.08em] block mb-1" style={{ color: "rgba(255,255,255,0.7)" }}>שעות נוספות</span>
                <span className="text-[20px] leading-[28px] font-bold tracking-tight tabular-nums">{formatHM(payroll.overtimeHours)}</span>
                <div className="text-[13px] font-bold mt-1 tabular-nums">{money(payroll.overtimePay)}</div>
                {settings.overtime_payout_month === "next" && (payroll.overtimeHours > 0 || payroll.ownOvertimeHours > 0) && (
                  <div className="mt-2.5 pt-2.5 flex flex-col gap-1" style={{ borderTop: "1px solid rgba(255,255,255,0.18)" }}>
                    {payroll.overtimeHours > 0 && (
                      <div className="flex items-center gap-1">
                        <span className="material-symbols-outlined text-[12px]" style={{ color: "rgba(255,255,255,0.75)" }}>history</span>
                        <span className="text-[9.5px] font-semibold leading-tight" style={{ color: "rgba(255,255,255,0.75)" }}>
                          מתלוש {MONTH_HE[(currentMonth.getMonth() + 11) % 12]}
                        </span>
                      </div>
                    )}
                    {payroll.ownOvertimeHours > 0 && (
                      <div className="flex items-center gap-1">
                        <span className="material-symbols-outlined text-[12px]" style={{ color: "#7FEFFF" }}>sync_alt</span>
                        <span className="text-[9.5px] font-semibold leading-tight" style={{ color: "#7FEFFF" }}>
                          {formatHM(payroll.ownOvertimeHours)} נצברו החודש · יופיעו בתלוש {MONTH_HE[(currentMonth.getMonth() + 1) % 12]}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Money flow — a visual journey from gross to net, not a receipt list */}
              <div
                className="rounded-[30px] p-6 relative overflow-hidden col-span-2"
                style={{
                  background: "rgba(255,255,255,0.72)",
                  backdropFilter: "blur(30px)",
                  border: "1px solid rgba(255,255,255,0.9)",
                  boxShadow: "0 24px 48px rgba(35,50,100,0.06)",
                }}
              >
                <div className="absolute -right-16 -top-16 w-56 h-56 rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, rgba(118,57,255,0.1), transparent 70%)", filter: "blur(14px)" }} />
                <div className="absolute -left-16 bottom-0 w-56 h-56 rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, rgba(0,210,255,0.09), transparent 70%)", filter: "blur(14px)" }} />

                <div className="flex items-center gap-2 mb-1 relative z-10">
                  <span className="material-symbols-outlined text-[18px]" style={{ color: LH.primary }}>waterfall_chart</span>
                  <span className="text-[13px] font-extrabold tracking-[0.14em] uppercase" style={{ color: LH.onSurfaceVariant }}>מסע התשלום</span>
                </div>
                {isCurrentMonth && (
                  <div className="mb-5 relative z-10">
                    <span className="text-[10.5px] font-semibold" style={{ color: "#8892b0" }}>תחזית מלאה לסוף החודש — כולל ימים שטרם הגיעו, לפי לוח העבודה שלך</span>
                  </div>
                )}

                {/* No net figure here — that already lives at the top of the page (today's actual
                    net). This card is purely about where the money moves: actual gross earned so
                    far (small, factual, not a projection) beside the two totals that explain the
                    forecasted deductions/additions further down. */}
                <div className="relative z-10 mb-5">
                  <div className="flex items-baseline gap-2 mb-3">
                    <span className="text-[10.5px] font-bold tracking-[0.1em] uppercase" style={{ color: "#8892b0" }}>ברוטו בפועל</span>
                    <span className="text-[13.5px] font-bold" style={{ color: LH.onSurface }}>{money(grossTotal)}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-8 gap-y-3">
                    <div>
                      <span className="text-[10px] font-bold tracking-[0.1em] uppercase block mb-1" style={{ color: "#0F766E" }}>תוספות שכר</span>
                      <span
                        className="block leading-none"
                        dir="ltr"
                        style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif", fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", color: "#0F766E" }}
                      >
                        +{money(additionsGrandTotal)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] font-bold tracking-[0.1em] uppercase block mb-1" style={{ color: "#DC2626" }}>
                        סך הכל ניכויים{isCurrentMonth ? " · תחזית" : ""}
                      </span>
                      <span
                        className="block leading-none"
                        dir="ltr"
                        style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif", fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", color: "#DC2626" }}
                      >
                        −{money(deductionsGrandTotal)}
                      </span>
                    </div>
                  </div>
                  {/* Composition bar: base hours / overtime / additions */}
                  <div className="flex h-2.5 rounded-full overflow-hidden mt-3.5" style={{ background: "rgba(35,50,100,0.07)" }}>
                    {[
                      { v: projectedPayroll.regularPay, c: "linear-gradient(90deg,#7639FF,#9B6DFF)" },
                      { v: projectedPayroll.overtimePay, c: "linear-gradient(90deg,#00A8CC,#00D2FF)" },
                      { v: projectedPayroll.fixedComponentsTotal, c: "linear-gradient(90deg,#0F766E,#19CEA0)" },
                      { v: projectedPayroll.foodAllowanceAddition, c: "linear-gradient(90deg,#F59E0B,#FB923C)" },
                    ].map((seg, i) =>
                      seg.v > 0 ? (
                        <div key={i} style={{ width: `${(seg.v / (forecastGrossTotal || 1)) * 100}%`, background: seg.c, transition: "width .9s cubic-bezier(.16,1,.3,1)" }} />
                      ) : null,
                    )}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2.5">
                    {[
                      { label: "שעות רגילות", v: projectedPayroll.regularPay, c: "#7639FF" },
                      { label: "שעות נוספות", v: projectedPayroll.overtimePay, c: "#00A8CC" },
                      { label: "תוספות", v: projectedPayroll.fixedComponentsTotal, c: "#0F766E" },
                      { label: "תקציב אוכל", v: projectedPayroll.foodAllowanceAddition, c: "#F59E0B" },
                    ].map((seg) =>
                      seg.v > 0 ? (
                        <div key={seg.label} className="flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full" style={{ background: seg.c }} />
                          <span className="text-[10.5px] font-semibold" style={{ color: LH.onSurfaceVariant }}>{seg.label}</span>
                        </div>
                      ) : null,
                    )}
                  </div>
                </div>

                {/* Additions — each item as a tinted chip */}
                {((settings.fixed_components && settings.fixed_components.length > 0) || projectedPayroll.foodAllowanceAddition > 0) && (
                  <div className="relative z-10 mb-4">
                    <span className="text-[10px] font-bold tracking-[0.14em] uppercase block mb-2.5" style={{ color: "#0F766E" }}>תוספות</span>
                    <div className="grid grid-cols-2 gap-2">
                      {(settings.fixed_components || []).map((c, i) => (
                        <div key={`fc-${i}`} className="rounded-2xl px-3 py-2.5 relative overflow-hidden" style={{ background: "rgba(15,118,110,0.07)", border: "1px solid rgba(15,118,110,0.18)" }}>
                          <span className="text-[11px] font-semibold block truncate" style={{ color: LH.onSurfaceVariant }}>{c.label}</span>
                          <span dir="ltr" className="text-[16px] font-bold" style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif", color: "#0F766E" }}>+{money(c.amount)}</span>
                        </div>
                      ))}
                      {projectedPayroll.foodAllowanceAddition > 0 && (
                        <div className="rounded-2xl px-3 py-2.5 relative overflow-hidden" style={{ background: "rgba(245,158,11,0.09)", border: "1px solid rgba(245,158,11,0.24)" }}>
                          <span className="text-[11px] font-semibold block truncate" style={{ color: LH.onSurfaceVariant }}>תקציב אוכל</span>
                          <span dir="ltr" className="text-[16px] font-bold" style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif", color: "#B45309" }}>+{money(projectedPayroll.foodAllowanceAddition)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Deductions — statutory (income tax / NI / health / pension / training fund) + manual, bars sized by share of the
                    full projected gross, so mid-month already shows what each category will actually withhold by month-end. */}
                {(() => {
                  const s = projectedPayroll.statutory;
                  const statutoryItems: { label: string; amount: number }[] = [
                    s.incomeTax > 0 && { label: "מס הכנסה", amount: s.incomeTax },
                    s.nationalInsurance > 0 && { label: "ביטוח לאומי", amount: s.nationalInsurance },
                    s.healthInsurance > 0 && { label: "ביטוח בריאות", amount: s.healthInsurance },
                    s.pensionEmployee > 0 && { label: "פנסיה", amount: s.pensionEmployee },
                    s.trainingFundEmployee > 0 && { label: "קרן השתלמות", amount: s.trainingFundEmployee },
                  ].filter(Boolean) as { label: string; amount: number }[];
                  const foodItems: { label: string; amount: number }[] =
                    projectedPayroll.foodExpenseDeduction > 0 ? [{ label: "הוצאות אוכל שדווחו", amount: projectedPayroll.foodExpenseDeduction }] : [];
                  const allDeductions = [...statutoryItems, ...(settings.deductions || []), ...foodItems];
                  if (allDeductions.length === 0) return null;
                  return (
                  <div className="relative z-10 mb-5">
                    <span className="text-[10px] font-bold tracking-[0.14em] uppercase block mb-2.5" style={{ color: "#DC2626" }}>ניכויים{isCurrentMonth ? " · תחזית לסוף החודש" : ""}</span>
                    <div className="flex flex-col gap-2.5">
                      {allDeductions.map((d, i) => {
                        const share = forecastGrossTotal > 0 ? (d.amount / forecastGrossTotal) * 100 : 0;
                        return (
                          <div key={`ded-${i}`}>
                            <div className="flex items-baseline justify-between mb-1">
                              <span className="text-[11.5px] font-semibold" style={{ color: LH.onSurface }}>{d.label}</span>
                              <div className="flex items-baseline gap-1.5">
                                <span className="text-[9.5px] font-bold" style={{ color: "#A0ABC0" }}>{share.toFixed(1)}%</span>
                                <span dir="ltr" className="text-[13px] font-bold" style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif", color: "#DC2626" }}>−{money(d.amount)}</span>
                              </div>
                            </div>
                            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(35,50,100,0.07)" }}>
                              <div
                                className="h-full rounded-full"
                                style={{ width: `${Math.min(100, share)}%`, background: "linear-gradient(90deg,#DC2626,#F87171)", transition: "width .9s cubic-bezier(.16,1,.3,1)" }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  );
                })()}

              </div>

              {payroll.unpaidLeaveDays > 0 && (
                <div className="rounded-[24px] p-5 col-span-2 flex items-center gap-3" style={{ background: `${LH.error}0D`, border: `1px solid ${LH.error}26` }}>
                  <span className="material-symbols-outlined" style={{ color: LH.error }}>info</span>
                  <span className="text-[13px] font-medium" style={{ color: LH.onSurface }}>
                    {payroll.unpaidLeaveDays.toFixed(1)} ימי חופש/מחלה לא משולמים החודש — לא נכללים בשכר.
                  </span>
                </div>
              )}
              {payroll.unpaidOffDays > 0 && (
                <div className="rounded-[24px] p-5 col-span-2 flex items-center gap-3" style={{ background: `${LH.error}0D`, border: `1px solid ${LH.error}26` }}>
                  <span className="material-symbols-outlined" style={{ color: LH.error }}>event_busy</span>
                  <span className="text-[13px] font-medium" style={{ color: LH.onSurface }}>
                    {payroll.unpaidOffDays.toFixed(1)} ימי "לא עובד" החודש — לא נכללים בשכר.
                  </span>
                </div>
              )}
              {payroll.holidayDays > 0 && (
                <div className="rounded-[24px] p-5 col-span-2 flex items-center gap-3" style={{ background: "rgba(25,206,160,0.08)", border: "1px solid rgba(25,206,160,0.22)" }}>
                  <span className="material-symbols-outlined" style={{ color: "#0F766E" }}>celebration</span>
                  <span className="text-[13px] font-medium" style={{ color: LH.onSurface }}>
                    {payroll.holidayDays.toFixed(1)} ימי חג משולמים במלואם החודש — לא נגרעו מיתרת החופש/מחלה.
                  </span>
                </div>
              )}

              {/* Month-end salary forecast — a plain button, not an always-open card; the full
                  gross/net breakdown lives in the dialog it opens. */}
              <button
                onClick={() => setSalaryForecastOpen(true)}
                className="col-span-2 rounded-[24px] p-5 flex items-center justify-between gap-3 text-right transition-transform active:scale-[0.98]"
                style={{ background: `${LH.surface}CC`, backdropFilter: "blur(20px)", boxShadow: "0 8px 30px rgba(35,50,100,0.04)", border: "1px solid rgba(255,255,255,0.5)" }}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0" style={{ background: `${LH.primary}0F` }}>
                    <span className="material-symbols-outlined text-[22px]" style={{ color: LH.primary }}>payments</span>
                  </div>
                  <div className="min-w-0">
                    <span className="text-[14px] font-bold block truncate" style={{ color: LH.onSurface }}>משכורת צפויה בסוף החודש</span>
                    <span className="text-[11px] font-medium" style={{ color: LH.onSurfaceVariant }}>ברוטו ונטו · לחיצה לפרטים</span>
                  </div>
                </div>
                <span className="material-symbols-outlined text-[22px] shrink-0" style={{ color: LH.onSurfaceVariant }}>chevron_left</span>
              </button>
            </div>
          </div>
        </div>
      </main>
      <LHBottomNav active="reports" foodEnabled={!!settings.food_card_enabled} />

      {/* Salary forecast — opened from the button above, not shown inline */}
      <Dialog open={salaryForecastOpen} onOpenChange={setSalaryForecastOpen}>
        <DialogContent className="max-w-md rounded-[28px] p-6" style={{ background: LH.background }} dir="rtl">
          <DialogHeader>
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: `${LH.primary}0F` }}>
                <span className="material-symbols-outlined text-[18px]" style={{ color: LH.primary }}>payments</span>
              </div>
              <DialogTitle style={{ color: LH.onSurface }}>משכורת צפויה בסוף החודש</DialogTitle>
            </div>
          </DialogHeader>

          <div className="flex flex-col gap-3 mt-2">
            {/* Net — the headline figure */}
            <div className="rounded-[22px] p-5" style={{ background: LH.primary }}>
              <span className="text-[11px] font-bold tracking-[0.1em] uppercase block mb-1" style={{ color: "rgba(255,255,255,0.65)" }}>נטו</span>
              <span dir="ltr" className="block tabular-nums leading-none" style={{ fontFamily: "'Bricolage Grotesque', 'Heebo', system-ui, sans-serif", fontSize: 34, fontWeight: 800, letterSpacing: "-0.02em", color: "#fff" }}>
                {money(projectedPayroll.netPay)}
              </span>
            </div>

            {/* Gross — secondary, plain row */}
            <div className="flex items-center justify-between rounded-[18px] px-5 py-4" style={{ background: LH.surfaceContainerLow }}>
              <span className="text-[13px] font-bold" style={{ color: LH.onSurfaceVariant }}>ברוטו</span>
              <span dir="ltr" className="tabular-nums" style={{ fontFamily: "'Bricolage Grotesque', 'Heebo', system-ui, sans-serif", fontSize: 20, fontWeight: 800, letterSpacing: "-0.01em", color: LH.onSurface }}>
                {money(forecastGrossTotal)}
              </span>
            </div>
          </div>

          {settings.overtime_payout_month === "next" && payroll.ownOvertimeHours > 0 && (
            <div className="flex items-center gap-2 rounded-2xl px-4 py-3 mt-3">
              <span className="material-symbols-outlined text-[16px] shrink-0" style={{ color: "#00A8CC" }}>sync_alt</span>
              <span className="text-[11.5px] font-semibold" style={{ color: "#00A8CC" }}>
                {formatHM(payroll.ownOvertimeHours)} שעות נוספות שנצברו החודש לא כלולות כאן — יופיעו בתלוש {MONTH_HE[(currentMonth.getMonth() + 1) % 12]}
              </span>
            </div>
          )}

          {isCurrentMonth && (
            <div className="flex items-center gap-1.5 px-1 mt-3">
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "#19CEA0" }} />
              <span className="text-[11px] font-medium" style={{ color: LH.onSurfaceVariant }}>
                תחזית מלאה — כולל ימים שטרם הגיעו, לפי לוח העבודה שלך
              </span>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
