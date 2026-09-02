import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  calcHoursBetween,
  computeCumulativeAccrued,
  computeCumulativeLeaveUsage,
  computeMonthlyPayroll,
  computeVacationMinimumStatus,
  DayStatus,
  formatHM,
  getCountedHours,
  getEffectiveDailyTarget,
  getProfileFirstName,
  getSettings,
  getWorkHoursForMonth,
  upsertWorkHour,
  UserSettings,
  WorkHour,
} from "@/lib/localData";
import { isFullyAuthenticated, isLocalAuthenticated } from "@/lib/localAuth";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LHBottomNav } from "./design-preview/Shared";
import { DayDetailModal } from "./design-preview/DayDetailModal";
import { ClockInEditModal } from "./design-preview/ClockInEditModal";
import { STATUS_META } from "./design-preview/tokens";

/** Every KPI ring expands to exactly this outer diameter (bezel included) when hovered/tapped. */
const KPI_ACTIVE_DIAMETER = 168;

const WEEKDAY_HE_LONG = ["יום ראשון", "יום שני", "יום שלישי", "יום רביעי", "יום חמישי", "יום שישי", "שבת"];
const MONTH_HE = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
const dateKey = (d: Date) => format(d, "yyyy-MM-dd");
const nowHM = () => format(new Date(), "HH:mm");
export default function DesignPreview() {
  const navigate = useNavigate();
  const [activeKpi, setActiveKpi] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [firstName, setFirstName] = useState("WorkTrack");
  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  const [workHours, setWorkHours] = useState<WorkHour[]>([]);
  const [tick, setTick] = useState(0); // advances every second while clocked in, to redraw the live countdown
  const [actionPopup, setActionPopup] = useState<{ kind: "in" | "out"; text: string; sub: string } | null>(null);
  const [attendanceExpanded, setAttendanceExpanded] = useState(false);
  const [offDayPrompt, setOffDayPrompt] = useState(false);
  const [offDayHoursInput, setOffDayHoursInput] = useState("8");
  const [eveningConfirmOpen, setEveningConfirmOpen] = useState(false);
  const [overtimeInfoOpen, setOvertimeInfoOpen] = useState(false);

  const [dayModalDate, setDayModalDate] = useState<Date | null>(null);
  const [dayModalEntry, setDayModalEntry] = useState<WorkHour | undefined>(undefined);
  const [clockInEditOpen, setClockInEditOpen] = useState(false);

  const loadMonth = (month: Date, s?: UserSettings) => {
    const hrs = getWorkHoursForMonth(month.getFullYear(), month.getMonth());
    setWorkHours(hrs || []);
  };

  useEffect(() => {
    if (!isLocalAuthenticated()) {
      navigate("/design-preview/login");
      return;
    }
    // A session existing isn't enough — the mandatory PIN/security-questions step may still be
    // unfinished (e.g. abandoned mid-signup). Content only renders once this resolves true, so an
    // unauthorized visitor never sees even a flash of real data before being redirected away.
    isFullyAuthenticated().then((ok) => {
      if (!ok) {
        navigate("/design-preview/login");
        return;
      }
      const s = getSettings();
      setSettings(s);
      setFirstName(getProfileFirstName());
      loadMonth(currentMonth, s);
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!settings) return;
    loadMonth(currentMonth, settings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMonth]);

  const todayStr = dateKey(new Date());
  const todayEntry = useMemo(() => workHours.find((w) => w.date === todayStr), [workHours, todayStr]);
  const isClockedIn = !!todayEntry?.start_time && !todayEntry?.end_time && (todayEntry.status === "worked" || !todayEntry.status);

  useEffect(() => {
    if (!isClockedIn) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [isClockedIn]);

  const refresh = () => {
    if (!settings) return;
    loadMonth(currentMonth, settings);
  };

  // ---- Derived stats ----
  const monthlyGoal = useMemo(() => {
    if (!settings) return 0;
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    let total = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month, d);
      const weekday = date.toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
      if (settings.work_days[weekday]) total += settings.hours_per_day[weekday] || 0;
    }
    return total;
  }, [settings, currentMonth]);

  const totalWorked = useMemo(
    () =>
      workHours.reduce((sum, w) => {
        const isWorked = w.status === "worked" || !w.status;
        const isPaidOff = (w.status === "sick" || w.status === "vacation" || w.status === "holiday" || w.status === "off") && w.paid !== false;
        return isWorked || isPaidOff ? sum + getCountedHours(w) : sum;
      }, 0),
    [workHours],
  );
  const percentage = monthlyGoal > 0 ? Math.min(100, (totalWorked / monthlyGoal) * 100) : 0;


  // ---- This-month work days: worked days + paid vacation/sick/holiday days count, unpaid
  // leave/off days don't. Mirrors yearWorkDaysCount but scoped to the currently-viewed month. ----
  const monthWorkDaysCount = useMemo(
    () =>
      workHours.filter((w) => {
        const isWorked = (w.status === "worked" || !w.status) && getCountedHours(w) > 0;
        const isPaidLeaveDay = (w.status === "vacation" || w.status === "sick" || w.status === "holiday") && w.paid !== false;
        return isWorked || isPaidLeaveDay;
      }).length,
    [workHours],
  );
  const monthScheduledWorkDaysSoFar = useMemo(() => {
    if (!settings) return 0;
    const y = currentMonth.getFullYear();
    const m = currentMonth.getMonth();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const realToday = new Date();
    const isCurrentRealMonth = realToday.getFullYear() === y && realToday.getMonth() === m;
    const lastDay = isCurrentRealMonth ? realToday.getDate() : new Date(y, m, 1) < realToday ? daysInMonth : 0;
    let count = 0;
    for (let d = 1; d <= lastDay; d++) {
      const weekday = new Date(y, m, d).toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
      if (settings.work_days[weekday]) count += 1;
    }
    return count;
  }, [settings, currentMonth]);

  // ---- Monthly pace: hours deficit/overtime tracked per WORKED day only, summed (never netted
  // against each other). Vacation/sick/holiday/off days already move salary through payroll — they
  // are not "missing hours" and must not touch this tracker at all. A day that's still open (clocked
  // in, not yet clocked out) hasn't been judged short yet either — it waits for clock-out (or an
  // explicit day-off entry) before counting against the deficit, so mid-shift never inflates it. ----
  const dailyPace = useMemo(() => {
    if (!settings) return { workedSum: 0, targetSum: 0, deficitHours: 0, overtimeHours: 0 };
    const y = currentMonth.getFullYear();
    const m = currentMonth.getMonth();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const realToday = new Date();
    const isCurrentRealMonth = realToday.getFullYear() === y && realToday.getMonth() === m;
    const lastDay = isCurrentRealMonth ? realToday.getDate() : new Date(y, m, 1) < realToday ? daysInMonth : 0;
    let workedSum = 0;
    let targetSum = 0;
    let deficitHours = 0;
    let overtimeHours = 0;
    for (let d = 1; d <= lastDay; d++) {
      const ds = dateKey(new Date(y, m, d));
      // Days before employment even started were never "missing hours" — they simply weren't
      // work days yet, so they must never inflate the month's deficit target.
      if (settings.employment_start_date && ds < settings.employment_start_date) continue;
      const entryForDay = workHours.find((w) => w.date === ds);
      if (entryForDay?.status && entryForDay.status !== "worked") continue;
      const isToday = isCurrentRealMonth && d === realToday.getDate();
      if (isToday && isClockedIn) continue;
      const target = getEffectiveDailyTarget(ds, entryForDay, settings);
      const worked = entryForDay ? getCountedHours(entryForDay) : 0;
      targetSum += target;
      workedSum += worked;
      const diff = worked - target;
      if (diff > 0) overtimeHours += diff;
      else if (diff < 0) deficitHours += -diff;
    }
    return { workedSum, targetSum, deficitHours, overtimeHours };
  }, [settings, currentMonth, workHours, isClockedIn]);
  const monthOvertime = dailyPace.overtimeHours;
  const monthRemaining = dailyPace.deficitHours;
  const monthPacePercent = dailyPace.targetSum > 0 ? Math.min(100, (dailyPace.workedSum / dailyPace.targetSum) * 100) : dailyPace.workedSum > 0 ? 100 : 0;

  // Visible proof that deferred-overtime hours are actually being tracked while they accrue,
  // for anyone with settings.overtime_payout_month === "next" — the payroll-accurate figure
  // (per-day, tier-aware), not the simpler pace estimate above.
  const accruedOvertimeThisMonth = useMemo(() => {
    if (!settings || settings.overtime_payout_month !== "next") return 0;
    return computeMonthlyPayroll(currentMonth.getFullYear(), currentMonth.getMonth(), settings, workHours).ownOvertimeHours;
  }, [settings, currentMonth, workHours]);
  const accruedOvertimePayThisMonth = useMemo(() => {
    if (!settings || settings.overtime_payout_month !== "next") return 0;
    return computeMonthlyPayroll(currentMonth.getFullYear(), currentMonth.getMonth(), settings, workHours).ownOvertimePay;
  }, [settings, currentMonth, workHours]);
  const nextPayoutMonthLabel = useMemo(() => {
    const d = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
    return d.toLocaleDateString("he-IL", { month: "long" });
  }, [currentMonth]);

  const todayTarget = settings ? getEffectiveDailyTarget(todayStr, todayEntry, settings) : 0;
  // On a day that isn't a scheduled work day, todayTarget is 0 (so every hour worked is overtime —
  // see getDailyTargetHoursForDate). If the user confirmed a one-time shift, oneTimePlannedHours
  // carries the duration they stated purely for the countdown / estimated-exit display below.
  const displayTarget = todayEntry?.oneTimePlannedHours || todayTarget;

  // live countdown while clocked in
  const countdown = useMemo(() => {
    if (!isClockedIn || !todayEntry?.start_time) return null;
    const [sh, sm] = todayEntry.start_time.split(":").map(Number);
    const start = new Date();
    start.setHours(sh, sm, 0, 0);
    const targetMs = displayTarget * 3600 * 1000;
    const elapsedMs = Date.now() - start.getTime();
    const remainMs = targetMs - elapsedMs;
    const overtime = remainMs < 0;
    const abs = Math.abs(remainMs);
    const h = String(Math.floor(abs / 3600000)).padStart(2, "0");
    const m = String(Math.floor((abs % 3600000) / 60000)).padStart(2, "0");
    const s = String(Math.floor((abs % 60000) / 1000)).padStart(2, "0");
    return { text: `${h}:${m}:${s}`, overtime };
    // `tick` is intentionally unused in the body — it's a pure re-render trigger so this
    // recomputes every second against the live clock (Date.now()).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isClockedIn, todayEntry?.start_time, displayTarget, tick]);

  const estimatedExit = useMemo(() => {
    if (!todayEntry?.start_time) return null;
    const [sh, sm] = todayEntry.start_time.split(":").map(Number);
    const exit = new Date();
    exit.setHours(sh, sm, 0, 0);
    exit.setMinutes(exit.getMinutes() + displayTarget * 60);
    return `${String(exit.getHours()).padStart(2, "0")}:${String(exit.getMinutes()).padStart(2, "0")}`;
  }, [todayEntry?.start_time, displayTarget]);

  // ---- Leave/sick running balance (cumulative — does not reset every Jan 1) ----
  const rubricYear = new Date().getFullYear();
  const rubric = useMemo(() => {
    if (!settings) return null;
    const vAccrued = computeCumulativeAccrued(settings.annual_vacation_days || 0, settings.vacation_accrual_method, settings.employment_start_date);
    const vUsed = computeCumulativeLeaveUsage("vacation", settings);
    const sAccrued = computeCumulativeAccrued(settings.annual_sick_days || 0, settings.sick_accrual_method, settings.employment_start_date);
    const sUsed = computeCumulativeLeaveUsage("sick", settings);
    const vMonthlyRate = (settings.annual_vacation_days || 0) / 12;
    const sMonthlyRate = (settings.annual_sick_days || 0) / 12;
    const minStatus = computeVacationMinimumStatus(settings);
    return {
      vAccrued,
      vUsed,
      sAccrued,
      sUsed,
      vMonthlyRate,
      sMonthlyRate,
      minStatus,
      vAnnual: settings.annual_vacation_days || 0,
      sAnnual: settings.annual_sick_days || 0,
    };
    // `workHours` isn't read directly (compute* reads storage itself) — it's here purely so the
    // rubric recomputes after any day is saved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, workHours, rubricYear]);

  // ---- Clock in/out ----
  // Clocking in again on a day that was already clocked out earlier starts a NEW segment instead
  // of overwriting the day — the earlier shift's hours are preserved and added to, not lost.
  const doClockIn = (oneTimePlannedHours?: number, evening?: boolean) => {
    const time = nowHM();
    const alreadyCompletedToday = todayEntry?.status === "worked" && todayEntry.start_time && todayEntry.end_time;
    if (alreadyCompletedToday && todayEntry) {
      const priorSegments: WorkHour["segments"] =
        todayEntry.segments && todayEntry.segments.length > 0
          ? todayEntry.segments
          : [{ start: todayEntry.start_time as string, end: todayEntry.end_time, evening: todayEntry.evening }];
      const priorTotal = priorSegments!.reduce((s, seg) => s + calcHoursBetween(seg.start, seg.end), 0);
      upsertWorkHour({
        ...todayEntry,
        start_time: time,
        end_time: null,
        hours_worked: priorTotal,
        segments: [...priorSegments!, { start: time, end: null, evening }],
        evening: evening ?? todayEntry.evening,
      });
    } else {
      upsertWorkHour({
        date: todayStr,
        start_time: time,
        end_time: null,
        hours_worked: 0,
        status: "worked",
        oneTimePlannedHours,
        evening,
        segments: [{ start: time, end: null, evening }],
      });
    }
    refresh();
    setActionPopup({
      kind: "in",
      text: alreadyCompletedToday ? "חזרת לעבודה! 💪" : "המשמרת התחילה! 💪",
      sub: oneTimePlannedHours
        ? `יום חד-פעמי · ${formatHM(oneTimePlannedHours)} שעות · הכל שעות נוספות`
        : evening
          ? `נרשמה כניסה למשמרת ערב בשעה ${time}`
          : `נרשמה כניסה בשעה ${time}`,
    });
    setTimeout(() => setActionPopup(null), 2200);
  };
  const handleClockIn = (evening?: boolean) => {
    if (!settings) return;
    const weekday = new Date().toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
    const isScheduledWorkDay = !!settings.work_days[weekday];
    if (!isScheduledWorkDay) {
      setOffDayHoursInput(String(settings.hours_per_day[weekday] || 8));
      setOffDayPrompt(true);
      return;
    }
    doClockIn(undefined, evening);
  };
  /** Human summary of the configured overtime rates, e.g. "שעה 1: 125% · שעה 2: 150%". */
  const overtimeTiersSummary = (() => {
    const tiers = settings?.overtime_tiers;
    if (!tiers || tiers.length === 0) return "לפי התעריף הרגיל";
    return tiers.map((t, i) => `שעה ${i + 1}: ${t.rateType === "percent" ? `${t.rateValue}%` : `${t.rateValue}₪`}`).join(" · ");
  })();

  const confirmOffDayClockIn = () => {
    const hours = parseFloat(offDayHoursInput.replace(/[^0-9.]/g, "")) || 0;
    setOffDayPrompt(false);
    if (hours <= 0) return;
    doClockIn(hours);
  };
  const handleClockOut = () => {
    if (!todayEntry?.start_time) {
      toast.error("לא נרשמה כניסה היום");
      return;
    }
    const time = nowHM();
    const segments: WorkHour["segments"] =
      todayEntry.segments && todayEntry.segments.length > 0
        ? todayEntry.segments.map((seg, i, arr) => (i === arr.length - 1 ? { ...seg, end: time } : seg))
        : [{ start: todayEntry.start_time, end: time, evening: todayEntry.evening }];
    const totalHours = segments!.reduce((s, seg) => s + calcHoursBetween(seg.start, seg.end), 0);
    upsertWorkHour({ ...todayEntry, end_time: time, hours_worked: totalHours, segments });
    refresh();
    setActionPopup({
      kind: "out",
      text: "כל הכבוד, סיימת! 🎉",
      sub: segments!.length > 1 ? `${formatHM(totalHours)} שעות היום (${segments!.length} משמרות)` : `${formatHM(totalHours)} שעות היום`,
    });
    setTimeout(() => setActionPopup(null), 2200);
  };

  const openDayModal = (date: Date, entry: WorkHour | undefined) => {
    setDayModalDate(date);
    setDayModalEntry(entry);
  };

  if (loading || !settings) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#F8FAFF" }}>
        <div className="w-12 h-12 rounded-full border-2 animate-spin" style={{ borderColor: "#7639FF33", borderTopColor: "#7639FF" }} />
      </div>
    );
  }

  // Sorted newest-first. `workHours` is already scoped to the viewed month, so switching months
  // naturally shows only that month's records.
  const allMonthDays = [...workHours].sort((a, b) => b.date.localeCompare(a.date));
  const recentDays = attendanceExpanded ? allMonthDays : allMonthDays.slice(0, 5);
  const hour = new Date().getHours();
  const greeting = hour < 5 ? "לילה טוב" : hour < 12 ? "בוקר טוב" : hour < 18 ? "צהריים טובים" : "ערב טוב";

  return (
    <div
      dir="rtl"
      className="min-h-screen w-full flex flex-col"
      style={{ background: "#F8FAFF", color: "#1b1b1f", fontFamily: "'Heebo', system-ui, sans-serif" }}
    >
      <style>{`
        .material-symbols-outlined {
          font-family: 'Material Symbols Outlined';
          font-weight: normal;
          font-style: normal;
          font-size: 24px;
          line-height: 1;
          letter-spacing: normal;
          text-transform: none;
          display: inline-block;
          white-space: nowrap;
          word-wrap: normal;
          direction: ltr;
          -webkit-font-feature-settings: 'liga';
          -webkit-font-smoothing: antialiased;
        }
        .tabular-nums { font-variant-numeric: tabular-nums; }
        .lh-rise { animation: lh-rise .7s cubic-bezier(.16,1,.3,1) both; }
        .kpi-rise { animation: kpi-rise .6s cubic-bezier(.16,1,.3,1) both; }
        @keyframes kpi-rise { from { opacity: 0; transform: translateY(10px) scale(0.9); } to { opacity: 1; transform: translateY(0) scale(1); } }
        .kpi-shimmer { animation: kpi-spin 6s linear infinite; transform-origin: 50% 50%; }
        @keyframes kpi-spin { to { transform: rotate(360deg); } }
        .kpi-dot { animation: kpi-pulse 2.2s ease-in-out infinite; }
        @keyframes kpi-pulse { 0%,100% { transform: translate(-50%,-50%) scale(1); } 50% { transform: translate(-50%,-50%) scale(1.5); } }
        .kpi-orbit { animation: kpi-orbit-spin 22s linear infinite; }
        @keyframes kpi-orbit-spin { to { transform: rotate(360deg); } }
        .kpi-sparkle { animation: kpi-twinkle 2.6s ease-in-out infinite; }
        @keyframes kpi-twinkle { 0%,100% { opacity: 0; transform: scale(0.4) translateY(0); } 50% { opacity: 1; transform: scale(1.2) translateY(-4px); } }
        .rubric-glow { animation: rubric-glow-pulse 3.4s ease-in-out infinite; }
        @keyframes rubric-glow-pulse { 0%,100% { opacity: 0.35; transform: scale(0.96); } 50% { opacity: 0.65; transform: scale(1.06); } }
        .rubric-ring:hover { transform: translateY(-3px) scale(1.03); }
        .rubric-ring { transition: transform .3s cubic-bezier(.34,1.56,.64,1); }
        @media (hover: hover) and (pointer: fine) {
          .kpi-pop:hover { transform: scale(var(--kpi-pop-scale)) !important; }
          .kpi-rise:hover { z-index: 60 !important; }
          .attend-btn:hover { transform: scale(1.035); filter: brightness(1.06); box-shadow: 0 22px 40px -10px var(--attend-glow) !important; }
        }
        .attend-btn { transition: transform .25s cubic-bezier(.34,1.56,.64,1), filter .25s, box-shadow .25s; }
        .attend-btn:active { transform: scale(0.97); }
        @keyframes lh-rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes action-pop { 0% { opacity: 0; transform: translateY(10px) scale(0.9); } 15% { opacity: 1; transform: translateY(0) scale(1.03); } 25% { transform: scale(1); } 85% { opacity: 1; } 100% { opacity: 0; transform: translateY(-6px) scale(0.98); } }
        .action-popup { animation: action-pop 2.2s cubic-bezier(.16,1,.3,1) both; }
      `}</style>

      {/* Header */}
      <header className="fixed top-0 inset-x-0 z-50 bg-[#F8FAFF]/70 backdrop-blur-2xl" style={{ paddingTop: "env(safe-area-inset-top,0px)" }}>
        <div className="h-20 px-6 flex items-center justify-between max-w-[440px] mx-auto">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#000114] flex items-center justify-center shadow-lg" style={{ boxShadow: "0 10px 20px -6px rgba(0,1,20,0.3)" }}>
              <span className="material-symbols-outlined text-white text-[20px]">person</span>
            </div>
            <span className="text-[17px] leading-6 font-bold text-[#1b1b1f]">שלום, {firstName}</span>
          </div>
          <button className="w-11 h-11 flex items-center justify-center rounded-full hover:bg-[#f0edf1] transition-colors duration-300">
            <span className="material-symbols-outlined text-[#46464f] text-[24px]">notifications</span>
          </button>
        </div>
      </header>

      <main className="flex-1 relative w-full pt-20 pb-32 px-6 overflow-hidden">
        {/* Atmospheric background glows */}
        <div className="fixed inset-0 pointer-events-none overflow-hidden" style={{ zIndex: -1 }}>
          <div className="absolute -top-[10%] -right-[10%] w-[50%] h-[50%] rounded-full" style={{ background: "#7639FF", opacity: 0.05, filter: "blur(120px)" }} />
          <div className="absolute top-[20%] -left-[20%] w-[60%] h-[60%] rounded-full" style={{ background: "#00D2FF", opacity: 0.05, filter: "blur(120px)" }} />
          <div className="absolute bottom-[10%] right-[10%] w-[40%] h-[40%] rounded-full" style={{ background: "#19CEA0", opacity: 0.05, filter: "blur(120px)" }} />
          <div className="absolute -bottom-[20%] -left-[10%] w-[50%] h-[50%] rounded-full" style={{ background: "#723AFF", opacity: 0.05, filter: "blur(120px)" }} />
        </div>

        <div className="flex flex-col w-full gap-10 max-w-[440px] mx-auto">
          {/* Header & event banner */}
          <div className="lh-rise flex flex-col gap-4" style={{ animationDelay: "0ms" }}>
            <div className="flex flex-col relative pt-4">
              <h1 className="text-[32px] leading-[40px] tracking-[-0.02em] font-bold text-[#1b1b1f]">{greeting}, {firstName} 👋</h1>
              <p className="text-[18px] leading-[28px] text-[#46464f]">{WEEKDAY_HE_LONG[new Date().getDay()]}, {new Date().getDate()} ב{MONTH_HE[new Date().getMonth()]} {new Date().getFullYear()}</p>
            </div>
          </div>

          {/* Shift timer hero */}
          <div className="lh-rise bg-white/70 backdrop-blur-2xl rounded-[32px] p-6 relative flex flex-col items-center overflow-hidden border border-white/60" style={{ animationDelay: "80ms", boxShadow: "0 24px 48px rgba(35,50,100,0.06)" }}>
            <div className="text-[12px] font-bold leading-4 tracking-[0.08em] text-[#46464f] mb-2 z-10 uppercase" style={{ letterSpacing: "0.15em" }}>
              {isClockedIn ? "זמן נותר עד סיום המשמרת" : "טרם נרשמה כניסה היום"}
            </div>

            <div className="relative w-full max-w-[320px] z-10" style={{ height: 148, overflow: "hidden", perspective: 700 }}>
              <svg
                className="absolute bottom-2 w-full"
                style={{ height: "230%", transform: "rotateX(14deg) scale(1.06)", transformOrigin: "50% 100%", filter: "drop-shadow(0 14px 22px rgba(118,57,255,0.28)) drop-shadow(0 4px 10px rgba(0,210,255,0.25))" }}
                viewBox="0 0 100 100"
              >
                <path d="M 6 52 A 44 44 0 0 1 94 52" fill="none" stroke="#EEF2F9" strokeLinecap="round" strokeWidth="3" />
                <path d="M 6 52 A 44 44 0 0 1 68 10" fill="none" stroke="url(#arcGradientHero)" strokeLinecap="round" strokeWidth="6" />
                <circle cx="68" cy="10" r="4.5" fill="#19CEA0" style={{ filter: "drop-shadow(0 0 10px rgba(25,206,160,0.9)) drop-shadow(0 0 20px rgba(25,206,160,0.5))" }} />
                <path d="M 12 52 A 38 38 0 0 1 88 52" fill="none" opacity="0.5" stroke="#E2E8F0" strokeDasharray="1 6" strokeLinecap="round" strokeWidth="1" />
                <defs>
                  <linearGradient id="arcGradientHero" x1="0%" x2="100%" y1="100%" y2="0%">
                    <stop offset="0%" stopColor="#7639FF" />
                    <stop offset="33%" stopColor="#00D2FF" />
                    <stop offset="66%" stopColor="#00E5FF" />
                    <stop offset="100%" stopColor="#19CEA0" />
                  </linearGradient>
                </defs>
              </svg>
            </div>

            <div className="relative flex flex-col items-center -mt-1 mb-6 z-10">
              <div
                className="absolute rounded-full pointer-events-none"
                style={{ width: 260, height: 130, top: -20, background: "radial-gradient(ellipse at center, rgba(118,57,255,0.16), rgba(0,210,255,0.10) 55%, transparent 75%)", filter: "blur(18px)", zIndex: -1 }}
              />
              <span
                dir="ltr"
                className="tabular-nums leading-none"
                style={{
                  display: "inline-block",
                  fontSize: 62,
                  lineHeight: "64px",
                  letterSpacing: "-0.03em",
                  fontWeight: 800,
                  paddingInline: 6,
                  backgroundImage: countdown?.overtime
                    ? "linear-gradient(160deg,#0F766E 10%,#19CEA0 100%)"
                    : "linear-gradient(160deg,#101A46 10%,#3B4FA0 60%,#00A9D6 110%)",
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                  color: "transparent",
                  filter: "drop-shadow(0 4px 10px rgba(16,26,70,0.2))",
                }}
              >
                {countdown ? `${countdown.overtime ? "+" : ""}${countdown.text}` : "--:--:--"}
              </span>
              <span className="text-[13px] font-bold tracking-[0.08em] mt-3 px-4 py-1.5 rounded-full border" style={{ color: "#7639FF", background: "rgba(118,57,255,0.07)", borderColor: "rgba(118,57,255,0.15)" }}>
                {todayEntry?.oneTimePlannedHours ? `יום חד-פעמי: ${formatHM(displayTarget)} (הכל נוספות)` : `יעד יומי: ${formatHM(displayTarget)}`}
              </span>
            </div>

            <div className="flex justify-between w-full px-2 z-10 gap-4">
              <button
                type="button"
                onClick={() => isClockedIn && setClockInEditOpen(true)}
                disabled={!isClockedIn}
                className="flex-1 flex flex-col items-center bg-white/50 backdrop-blur-md rounded-2xl px-4 py-3 border border-white shadow-sm relative"
              >
                <span className="text-[12px] font-bold tracking-[0.08em] text-[#46464f] mb-1 flex items-center gap-1">
                  כניסה
                  {isClockedIn && <span className="material-symbols-outlined" style={{ fontSize: 13, color: "#7639FF" }}>edit</span>}
                </span>
                <span className="text-[24px] font-bold tabular-nums leading-none" style={{ color: "#101A46" }}>{todayEntry?.start_time || "--:--"}</span>
              </button>
              <div className="flex-1 flex flex-col items-center bg-white/50 backdrop-blur-md rounded-2xl px-4 py-3 border border-white shadow-sm">
                <span className="text-[12px] font-bold tracking-[0.08em] text-[#46464f] mb-1">{todayEntry?.end_time ? "יציאה" : "יציאה משוערת"}</span>
                <span className="text-[24px] font-bold tabular-nums leading-none" style={{ color: "#101A46" }}>{todayEntry?.end_time || estimatedExit || "--:--"}</span>
              </div>
            </div>
          </div>

          {/* Attendance buttons */}
          <div className="lh-rise flex gap-5 relative" style={{ animationDelay: "140ms" }}>
            {actionPopup && (
              <div
                className="action-popup absolute -top-16 inset-x-0 flex justify-center z-30 pointer-events-none"
              >
                <div
                  className="px-5 py-3 rounded-2xl flex items-center gap-3 shadow-2xl"
                  style={{
                    background: actionPopup.kind === "in" ? "linear-gradient(to bottom right,#19CEA0,#00D2FF)" : "linear-gradient(to bottom right,#7639FF,#00D2FF)",
                    boxShadow: actionPopup.kind === "in" ? "0 16px 32px -8px rgba(25,206,160,0.5)" : "0 16px 32px -8px rgba(118,57,255,0.5)",
                  }}
                >
                  <span className="material-symbols-outlined text-white" style={{ fontVariationSettings: "'FILL' 1" }}>{actionPopup.kind === "in" ? "check_circle" : "celebration"}</span>
                  <div className="flex flex-col">
                    <span className="text-white font-bold text-[14px] leading-tight">{actionPopup.text}</span>
                    <span className="text-white/85 text-[11px] leading-tight">{actionPopup.sub}</span>
                  </div>
                </div>
              </div>
            )}
            <button
              onClick={handleClockOut}
              disabled={!isClockedIn}
              className="attend-btn flex-1 rounded-[24px] p-4 flex flex-col items-center justify-center gap-3 active:scale-[0.98] relative overflow-hidden border border-white/40 group disabled:opacity-40 disabled:pointer-events-none"
              style={{ background: "linear-gradient(to bottom right,#19CEA0,#00D2FF)", boxShadow: "0 16px 32px -8px rgba(25,206,160,0.4)", ["--attend-glow" as unknown as string]: "rgba(25,206,160,0.6)" }}
            >
              <div className="absolute -bottom-10 -right-10 w-32 h-32 rounded-full pointer-events-none" style={{ background: "rgba(255,255,255,0.2)", filter: "blur(24px)" }} />
              <div className="w-14 h-14 rounded-full flex items-center justify-center text-white relative z-10 border border-white/30" style={{ background: "rgba(255,255,255,0.2)", boxShadow: "inset 0 2px 4px rgba(255,255,255,0.4)" }}>
                <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>logout</span>
              </div>
              <span className="text-[18px] font-bold text-white relative z-10">יצאתי עכשיו</span>
            </button>
            <button
              onClick={() => handleClockIn()}
              disabled={isClockedIn}
              className="attend-btn flex-1 rounded-[24px] p-4 flex flex-col items-center justify-center gap-3 active:scale-[0.98] relative overflow-hidden border border-white/40 group disabled:opacity-40 disabled:pointer-events-none"
              style={{ background: "linear-gradient(to bottom right,#7639FF,#00D2FF)", boxShadow: "0 16px 32px -8px rgba(118,57,255,0.4)", ["--attend-glow" as unknown as string]: "rgba(118,57,255,0.6)" }}
            >
              <div className="absolute -bottom-10 -right-10 w-32 h-32 rounded-full pointer-events-none" style={{ background: "rgba(255,255,255,0.2)", filter: "blur(24px)" }} />
              <div className="w-14 h-14 rounded-full flex items-center justify-center text-white relative z-10 border border-white/30" style={{ background: "rgba(255,255,255,0.2)", boxShadow: "inset 0 2px 4px rgba(255,255,255,0.4)" }}>
                <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>login</span>
              </div>
              <span className="text-[18px] font-bold text-white relative z-10">נכנסתי עכשיו</span>
            </button>
          </div>
          {!isClockedIn && settings.evening_shift_enabled && (
            <button
              onClick={() => (new Date().getHours() < 12 ? setEveningConfirmOpen(true) : handleClockIn(true))}
              className="lh-rise -mt-4 mx-auto flex items-center gap-2.5 pl-5 pr-2 py-2 rounded-full relative overflow-hidden active:scale-[0.96] transition-transform"
              style={{
                background: "linear-gradient(120deg, #1B1440 0%, #4C3AA8 55%, #7639FF 100%)",
                boxShadow: "0 12px 28px -10px rgba(76,58,168,0.6), inset 0 1px 0 rgba(255,255,255,0.14)",
              }}
            >
              <span className="absolute rounded-full pointer-events-none" style={{ width: 8, height: 8, top: 8, left: 26, background: "#fff", opacity: 0.9, boxShadow: "0 0 6px 1px rgba(255,255,255,0.7)" }} />
              <span className="absolute rounded-full pointer-events-none" style={{ width: 4, height: 4, top: 20, left: 44, background: "#fff", opacity: 0.6 }} />
              <span className="text-[13px] font-bold text-white relative z-10">התחלת משמרת ערב</span>
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 relative z-10"
                style={{ background: "rgba(255,255,255,0.16)", boxShadow: "inset 0 1px 2px rgba(255,255,255,0.3)" }}
              >
                <span className="material-symbols-outlined text-white" style={{ fontSize: 17, fontVariationSettings: "'FILL' 1" }}>bedtime</span>
              </div>
            </button>
          )}

          {/* Month selector + KPI instruments */}
          <div className="lh-rise flex flex-col gap-6" style={{ animationDelay: "200ms" }}>
            <div className="flex justify-center -mb-2 z-10 relative">
              <div className="bg-white/80 backdrop-blur-xl rounded-full px-6 py-3 flex items-center gap-6 border border-white" style={{ boxShadow: "0 8px 24px rgba(35,50,100,0.05)" }}>
                <button onClick={() => { setAttendanceExpanded(false); setCurrentMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1)); }} className="text-[#46464f] hover:text-[#7639FF] transition-colors">
                  <span className="material-symbols-outlined">chevron_right</span>
                </button>
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[20px]" style={{ color: "#7639FF" }}>calendar_today</span>
                  <span className="text-[18px] font-bold" style={{ color: "#101A46" }}>{MONTH_HE[currentMonth.getMonth()]} {currentMonth.getFullYear()}</span>
                </div>
                <button onClick={() => { setAttendanceExpanded(false); setCurrentMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1)); }} className="text-[#46464f] hover:text-[#7639FF] transition-colors">
                  <span className="material-symbols-outlined">chevron_left</span>
                </button>
              </div>
            </div>

            <div
              className="-mx-6 px-4 pt-12 pb-8 flex justify-center items-center relative"
              style={{ background: "rgba(255,255,255,0.35)", backdropFilter: "blur(20px)", borderTop: "1px solid rgba(255,255,255,0.6)", borderBottom: "1px solid rgba(255,255,255,0.6)" }}
            >
              <div className="absolute -top-20 left-1/3 w-64 h-64 rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, rgba(118,57,255,0.1), transparent 70%)" }} />
              <div className="absolute -bottom-20 right-1/4 w-56 h-56 rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, rgba(0,210,255,0.08), transparent 70%)" }} />

              <svg className="absolute pointer-events-none kpi-orbit" style={{ width: 420, height: 420, top: "50%", left: "50%", marginTop: -210, marginLeft: -210, opacity: 0.35 }} viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="47" fill="none" stroke="url(#orbitGrad)" strokeWidth="0.4" strokeDasharray="0.5 4" strokeLinecap="round" />
                <defs>
                  <linearGradient id="orbitGrad" x1="0%" x2="100%" y1="0%" y2="100%">
                    <stop offset="0%" stopColor="#7639FF" />
                    <stop offset="100%" stopColor="#19CEA0" />
                  </linearGradient>
                </defs>
              </svg>
              {[
                { top: "8%", left: "18%", d: "0s", s: 5 },
                { top: "62%", left: "6%", d: ".7s", s: 4 },
                { top: "14%", left: "82%", d: "1.4s", s: 4 },
                { top: "70%", left: "92%", d: "2.1s", s: 5 },
                { top: "40%", left: "50%", d: "1s", s: 3 },
              ].map((sp, si) => (
                <div key={si} className="kpi-sparkle absolute rounded-full pointer-events-none" style={{ top: sp.top, left: sp.left, width: sp.s, height: sp.s, background: "white", boxShadow: "0 0 6px 2px rgba(118,57,255,0.5)", animationDelay: sp.d }} />
              ))}

              {[
                { icon: "speed", label: "קצב השלמה", sub: "מהיעד החודשי", value: `${Math.round(percentage)}%`, grad: ["#7639FF", "#00D2FF"], glow: "rgba(118,57,255,0.55)", trackTint: "rgba(118,57,255,0.12)", percent: percentage, size: 124, lift: 0, zIndex: 10, overlap: 0, badge: 23 },
                { icon: "hourglass_bottom", label: monthRemaining > 0 ? "בחוסר החודש" : monthOvertime > 0 ? "בעודף החודש" : "בחוסר החודש", sub: "לעומת הקצב הצפוי", value: monthRemaining > 0 ? formatHM(monthRemaining) : monthOvertime > 0 ? `+${formatHM(monthOvertime)}` : formatHM(0), grad: ["#0F766E", "#19CEA0"], glow: "rgba(15,118,110,0.55)", trackTint: "rgba(15,118,110,0.14)", percent: monthPacePercent, size: 80, lift: 12, zIndex: 20, overlap: -19, badge: 18 },
                { icon: "event_available", label: "ימי עבודה", sub: "החודש", value: String(monthWorkDaysCount), grad: ["#00D2FF", "#7FEFFF"], glow: "rgba(0,210,255,0.55)", trackTint: "rgba(0,210,255,0.12)", percent: monthScheduledWorkDaysSoFar > 0 ? Math.min(100, (monthWorkDaysCount / monthScheduledWorkDaysSoFar) * 100) : 0, size: 66, lift: 21, zIndex: 30, overlap: -15, badge: 16 },
                { icon: "flag", label: "יעד חודשי", sub: `${formatHM(monthlyGoal)} שעות`, value: String(Math.round(monthlyGoal)), grad: ["#7639FF", "#B39CFF"], glow: "rgba(118,57,255,0.55)", trackTint: "rgba(118,57,255,0.12)", percent: 100, size: 56, lift: 29, zIndex: 40, overlap: -14, badge: 14 },
              ].map((k, i) => {
                const r = 43;
                const c = 2 * Math.PI * r;
                const dashoffset = c * (1 - k.percent / 100);
                const theta = (k.percent / 100) * 2 * Math.PI;
                const dotX = 50 + r * Math.sin(theta);
                const dotY = 50 - r * Math.cos(theta);
                const isActive = activeKpi === i;
                return (
                  <div
                    key={k.label}
                    className="kpi-rise relative flex flex-col items-center gap-2"
                    style={{ animationDelay: `${i * 90}ms`, marginTop: k.lift, marginRight: k.overlap, zIndex: isActive ? 60 : k.zIndex }}
                  >
                    <div
                      className="kpi-pop flex flex-col items-center gap-2 cursor-pointer select-none"
                      style={
                        {
                          "--kpi-pop-scale": (KPI_ACTIVE_DIAMETER / (k.size + 10)).toFixed(3),
                          transform: isActive ? `scale(${(KPI_ACTIVE_DIAMETER / (k.size + 10)).toFixed(3)})` : undefined,
                          transition: "transform .35s cubic-bezier(.34,1.56,.64,1)",
                        } as React.CSSProperties
                      }
                      onClick={() => setActiveKpi((a) => (a === i ? null : i))}
                    >
                      <div
                        className="relative flex items-center justify-center rounded-full"
                        style={{
                          width: k.size + 10,
                          height: k.size + 10,
                          background: "linear-gradient(155deg, rgba(255,255,255,0.9), rgba(210,215,230,0.4))",
                          boxShadow: "0 2px 4px rgba(255,255,255,0.9) inset, 0 -2px 4px rgba(35,50,100,0.06) inset",
                        }}
                      >
                        <div
                          className="absolute z-20 flex items-center justify-center rounded-full"
                          style={{ top: -k.badge * 0.28, width: k.badge, height: k.badge, background: `linear-gradient(155deg, ${k.grad[0]}, ${k.grad[1]})`, boxShadow: `0 4px 10px -2px ${k.glow}, 0 0 0 3px #F8FAFF` }}
                        >
                          <span className="material-symbols-outlined text-white" style={{ fontSize: k.badge * 0.55 }}>{k.icon}</span>
                        </div>

                        <div
                          className="relative flex items-center justify-center rounded-full"
                          style={{ width: k.size, height: k.size, background: "linear-gradient(155deg, rgba(255,255,255,0.9), rgba(255,255,255,0.5))", boxShadow: `0 14px 28px -10px ${k.glow}, inset 0 2px 3px rgba(255,255,255,0.9), inset 0 -3px 6px rgba(35,50,100,0.08)` }}
                        >
                          <svg className="absolute inset-0 w-full h-full kpi-shimmer" viewBox="0 0 100 100">
                            <circle cx="50" cy="50" r={r} fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeDasharray={`${c * 0.1} ${c}`} opacity="0.55" style={{ filter: "blur(1.5px)", mixBlendMode: "screen" }} />
                          </svg>
                          <svg className="absolute inset-0 w-full h-full" style={{ transform: "rotate(-90deg)" }} viewBox="0 0 100 100">
                            <defs>
                              <linearGradient id={`kpiGrad${i}`} x1="0%" x2="100%" y1="0%" y2="100%">
                                <stop offset="0%" stopColor={k.grad[0]} />
                                <stop offset="100%" stopColor={k.grad[1]} />
                              </linearGradient>
                            </defs>
                            <circle cx="50" cy="50" r={r} fill="none" stroke={k.trackTint} strokeWidth="6" />
                            <circle cx="50" cy="50" r={r} fill="none" stroke={`url(#kpiGrad${i})`} strokeDasharray={c} strokeDashoffset={dashoffset} strokeLinecap="round" strokeWidth="6.5" style={{ filter: `drop-shadow(0 2px 5px ${k.glow})` }} />
                            <circle cx="50" cy="50" r={r} fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeDasharray={`${c * 0.16} ${c}`} strokeDashoffset={c * 0.06} opacity="0.75" style={{ filter: "blur(1.2px)" }} />
                          </svg>
                          <div className="kpi-dot absolute rounded-full" style={{ width: 9, height: 9, left: `${dotX}%`, top: `${dotY}%`, background: k.grad[1], boxShadow: `0 0 8px 3px ${k.glow}, 0 0 16px 6px ${k.glow}` }} />
                          <div className="absolute inset-[6px] rounded-full" style={{ background: "rgba(255,255,255,0.55)", backdropFilter: "blur(6px)", boxShadow: "inset 0 3px 6px rgba(35,50,100,0.06), inset 0 -1px 2px rgba(255,255,255,0.8)" }} />
                          <span
                            className="tabular-nums relative z-10 leading-none"
                            style={{
                              fontFamily: "'Bricolage Grotesque', 'Heebo', system-ui, sans-serif",
                              fontSize: k.size >= 118 ? 30 : k.size >= 76 ? 22 : k.size >= 62 ? 17 : 14,
                              fontWeight: 800,
                              letterSpacing: "-0.03em",
                              backgroundImage: `linear-gradient(160deg, ${k.grad[0]}, ${k.grad[1]})`,
                              WebkitBackgroundClip: "text",
                              backgroundClip: "text",
                              color: "transparent",
                              filter: `drop-shadow(0 2px 6px ${k.glow})`,
                            }}
                          >
                            {k.value}
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-col items-center gap-0.5">
                        <span className="text-[11px] font-bold text-[#101A46]">{k.label}</span>
                        <span className="text-[9px] font-medium text-[#8892b0]">{k.sub}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {settings.overtime_payout_month === "next" && (
              <div className="flex justify-center -mt-1 mb-1">
                <button
                  onClick={() => setOvertimeInfoOpen(true)}
                  aria-label="שעות נוספות שנצברו החודש"
                  className="w-9 h-9 rounded-full flex items-center justify-center transition-transform active:scale-90"
                  style={{ background: "linear-gradient(155deg,#00A8CC,#00D2FF)", boxShadow: "0 8px 18px -6px rgba(0,168,204,0.55)" }}
                >
                  <span className="material-symbols-outlined text-white text-[18px]">sync_alt</span>
                </button>
              </div>
            )}
          </div>

          {/* Monthly work hours hero */}
          <div className="lh-rise bg-white/70 backdrop-blur-2xl rounded-[32px] p-6 flex flex-col gap-6 border border-white/80 relative overflow-hidden" style={{ animationDelay: "260ms", boxShadow: "0 24px 48px rgba(35,50,100,0.05)" }}>
            <div className="absolute -right-20 -top-20 w-80 h-80 rounded-full pointer-events-none" style={{ background: "linear-gradient(to bottom right, rgba(118,57,255,0.05), rgba(0,210,255,0.05))", filter: "blur(60px)" }} />
            <div className="flex flex-col items-center text-center z-10 w-full">
              <span className="text-[16px] font-bold mb-1" style={{ color: "#101A46" }}>שעות עבודה החודש</span>
              <div className="relative w-full h-32 flex items-center justify-center my-4">
                <svg className="absolute inset-0 w-full h-full" preserveAspectRatio="xMidYMid meet" viewBox="0 0 200 100">
                  <defs>
                    <linearGradient id="torusGrad" x1="0%" x2="100%" y1="0%" y2="100%">
                      <stop offset="0%" stopColor="#7639FF" />
                      <stop offset="50%" stopColor="#00D2FF" />
                      <stop offset="100%" stopColor="#19CEA0" />
                    </linearGradient>
                    <filter id="glow3d">
                      <feGaussianBlur stdDeviation="4" result="coloredBlur" />
                      <feMerge>
                        <feMergeNode in="coloredBlur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                  </defs>
                  <ellipse cx="100" cy="50" rx="80" ry="30" fill="none" stroke="#F0F4F8" strokeWidth="4" />
                  <ellipse cx="100" cy="50" rx="80" ry="30" fill="none" stroke="url(#torusGrad)" strokeDasharray="350" strokeDashoffset={350 - (percentage / 100) * 238} strokeLinecap="round" strokeWidth="8" opacity="0.9" filter="url(#glow3d)" />
                  <ellipse cx="100" cy="48" rx="78" ry="28" fill="none" stroke="white" strokeDasharray="100 400" strokeDashoffset="20" strokeWidth="1.5" opacity="0.6" />
                </svg>
                <div className="relative flex flex-col items-center justify-center" style={{ zIndex: 20 }}>
                  <span
                    className="tabular-nums tracking-tighter leading-none"
                    style={{ fontSize: 56, fontWeight: 800, backgroundImage: "linear-gradient(to bottom,#101A46,#273777)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", filter: "drop-shadow(0 2px 8px rgba(16,26,70,0.1))" }}
                  >
                    {formatHM(totalWorked)}
                  </span>
                </div>
              </div>
              <span className="text-[13px] font-medium text-[#46464f] px-4 py-1 rounded-full border border-white" style={{ background: "rgba(246,242,247,0.5)" }}>
                מתוך {formatHM(monthlyGoal)} שעות
              </span>
            </div>

            <div className="relative flex flex-col items-center gap-1 z-10 w-full pt-1">
              <div className="rubric-glow absolute rounded-full pointer-events-none" style={{ width: 140, height: 140, top: -20, background: "radial-gradient(circle, rgba(118,57,255,0.25), transparent 70%)", filter: "blur(22px)" }} />
              <span
                className="tabular-nums leading-none relative z-10"
                style={{
                  fontFamily: "'Bricolage Grotesque', 'Heebo', system-ui, sans-serif",
                  fontSize: 64,
                  fontWeight: 800,
                  letterSpacing: "-0.04em",
                  backgroundImage: "linear-gradient(135deg,#7639FF,#00D2FF,#19CEA0)",
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                  color: "transparent",
                  filter: "drop-shadow(0 6px 16px rgba(118,57,255,0.3))",
                }}
              >
                {Math.round(percentage)}%
              </span>
              <span className="text-[11px] font-bold uppercase tracking-wider relative z-10" style={{ color: "#8892b0" }}>התקדמות חודשית</span>
            </div>
          </div>

          {/* Leave & sick running balance — same ring language as the KPI cluster above */}
          {rubric && (
            <div className="lh-rise bg-white/70 backdrop-blur-2xl rounded-[32px] p-6 flex flex-col gap-1 border border-white/80 relative overflow-hidden" style={{ animationDelay: "300ms", boxShadow: "0 24px 48px rgba(35,50,100,0.05)" }}>
              <div className="absolute -left-20 -bottom-20 w-72 h-72 rounded-full pointer-events-none" style={{ background: "linear-gradient(to top right, rgba(15,118,110,0.06), rgba(118,57,255,0.06))", filter: "blur(60px)" }} />
              <div className="absolute -right-16 -top-16 w-56 h-56 rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, rgba(0,210,255,0.06), transparent 70%)", filter: "blur(40px)" }} />
              {[
                { top: "10%", left: "12%", d: "0s", s: 4 },
                { top: "78%", left: "88%", d: ".9s", s: 5 },
                { top: "20%", left: "90%", d: "1.6s", s: 3 },
              ].map((sp, si) => (
                <div key={si} className="kpi-sparkle absolute rounded-full pointer-events-none z-10" style={{ top: sp.top, left: sp.left, width: sp.s, height: sp.s, background: "white", boxShadow: "0 0 6px 2px rgba(118,57,255,0.5)", animationDelay: sp.d }} />
              ))}

              <div className="flex items-center gap-2 relative z-10 mb-4">
                <span className="material-symbols-outlined" style={{ color: "#7639FF" }}>event_available</span>
                <h2 className="text-[18px] font-bold" style={{ color: "#101A46" }}>חופש ומחלה</h2>
                <span className="text-[11px] font-medium mr-auto" style={{ color: "#8892b0" }}>יתרה מצטברת</span>
              </div>

              <div className="flex items-center justify-center gap-10 relative z-10 py-1">
                {[
                  {
                    key: "vacation",
                    icon: "beach_access",
                    label: "ימי חופש",
                    used: rubric.vUsed,
                    accrued: rubric.vAccrued,
                    annual: rubric.vAnnual,
                    monthlyRate: rubric.vMonthlyRate,
                    method: settings?.vacation_accrual_method,
                    grad: ["#2563EB", "#60A5FA"],
                    glow: "rgba(37,99,235,0.55)",
                    track: "rgba(37,99,235,0.12)",
                  },
                  {
                    key: "sick",
                    icon: "thermostat",
                    label: "ימי מחלה",
                    used: rubric.sUsed,
                    accrued: rubric.sAccrued,
                    annual: rubric.sAnnual,
                    monthlyRate: rubric.sMonthlyRate,
                    method: settings?.sick_accrual_method,
                    grad: ["#D97706", "#FBBF24"],
                    glow: "rgba(217,119,6,0.55)",
                    track: "rgba(217,119,6,0.14)",
                  },
                ].map((r2) => {
                  const size = 128;
                  const rad = 43;
                  const circ = 2 * Math.PI * rad;
                  const over = r2.used > r2.accrued;
                  const remaining = Math.max(0, r2.accrued - r2.used);
                  // Only flags red once there's actual usage that has consumed the whole balance —
                  // an untouched 0/0 balance (e.g. the first month, nothing accrued yet) is not "waste".
                  const depleted = r2.used > 0.005 && remaining <= 0.005;
                  const pct = r2.accrued > 0 ? Math.min(100, (r2.used / r2.accrued) * 100) : r2.used > 0 ? 100 : 0;
                  const dashoffset = circ * (1 - pct / 100);
                  const grad = depleted ? ["#DC2626", "#F87171"] : r2.grad;
                  const glow = depleted ? "rgba(220,38,38,0.55)" : r2.glow;
                  return (
                    <div key={r2.key} className="flex flex-col items-center gap-3">
                      <div className="rubric-ring relative flex items-center justify-center">
                        <div
                          className="rubric-glow absolute rounded-full pointer-events-none"
                          style={{ width: size + 34, height: size + 34, background: `radial-gradient(circle, ${glow}, transparent 70%)`, filter: "blur(14px)" }}
                        />
                        <div
                          className="relative flex items-center justify-center rounded-full"
                          style={{
                            width: size + 12,
                            height: size + 12,
                            background: "linear-gradient(155deg, rgba(255,255,255,0.92), rgba(210,215,230,0.4))",
                            boxShadow: "0 2px 4px rgba(255,255,255,0.9) inset, 0 -2px 4px rgba(35,50,100,0.06) inset",
                          }}
                        >
                          <div
                            className="absolute z-20 flex items-center justify-center rounded-full"
                            style={{ top: -8, width: 30, height: 30, background: `linear-gradient(155deg, ${grad[0]}, ${grad[1]})`, boxShadow: `0 4px 12px -2px ${glow}, 0 0 0 4px #F8FAFF` }}
                          >
                            <span className="material-symbols-outlined text-white" style={{ fontSize: 17 }}>{r2.icon}</span>
                          </div>
                          <div
                            className="relative flex items-center justify-center rounded-full"
                            style={{ width: size, height: size, background: "linear-gradient(155deg, rgba(255,255,255,0.9), rgba(255,255,255,0.5))", boxShadow: `0 16px 32px -10px ${glow}, inset 0 2px 3px rgba(255,255,255,0.9), inset 0 -3px 6px rgba(35,50,100,0.08)` }}
                          >
                            <svg className="absolute inset-0 w-full h-full kpi-shimmer" viewBox="0 0 100 100">
                              <circle cx="50" cy="50" r={rad} fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeDasharray={`${circ * 0.1} ${circ}`} opacity="0.5" style={{ filter: "blur(1.5px)", mixBlendMode: "screen" }} />
                            </svg>
                            <svg className="absolute inset-0 w-full h-full" style={{ transform: "rotate(-90deg)" }} viewBox="0 0 100 100">
                              <defs>
                                <linearGradient id={`rubricGrad-${r2.key}`} x1="0%" x2="100%" y1="0%" y2="100%">
                                  <stop offset="0%" stopColor={grad[0]} />
                                  <stop offset="100%" stopColor={grad[1]} />
                                </linearGradient>
                              </defs>
                              <circle cx="50" cy="50" r={rad} fill="none" stroke={r2.track} strokeWidth="6" />
                              <circle cx="50" cy="50" r={rad} fill="none" stroke={`url(#rubricGrad-${r2.key})`} strokeDasharray={circ} strokeDashoffset={dashoffset} strokeLinecap="round" strokeWidth="7" style={{ filter: `drop-shadow(0 2px 6px ${glow})` }} />
                              <circle cx="50" cy="50" r={rad} fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeDasharray={`${circ * 0.14} ${circ}`} strokeDashoffset={circ * 0.05} opacity="0.7" style={{ filter: "blur(1.2px)" }} />
                            </svg>
                            <div className="absolute inset-[7px] rounded-full" style={{ background: "rgba(255,255,255,0.55)", backdropFilter: "blur(6px)", boxShadow: "inset 0 3px 6px rgba(35,50,100,0.06), inset 0 -1px 2px rgba(255,255,255,0.8)" }} />
                            <div className="flex flex-col items-center relative z-10">
                              <span
                                className="tabular-nums leading-none"
                                style={{
                                  fontFamily: "'Bricolage Grotesque', 'Heebo', system-ui, sans-serif",
                                  fontSize: 27,
                                  fontWeight: 800,
                                  letterSpacing: "-0.03em",
                                  backgroundImage: `linear-gradient(160deg, ${grad[0]}, ${grad[1]})`,
                                  WebkitBackgroundClip: "text",
                                  backgroundClip: "text",
                                  color: "transparent",
                                  filter: `drop-shadow(0 2px 6px ${glow})`,
                                }}
                              >
                                {remaining.toFixed(2)}
                              </span>
                              <span className="text-[9px] font-bold uppercase tracking-wider mt-0.5" style={{ color: "#8892b0" }}>ימים זמינים</span>
                              <span className="text-[10px] font-medium tabular-nums mt-1" style={{ color: "#8892b0" }}>נוצלו {r2.used.toFixed(2)} מתוך {r2.annual.toFixed(1)}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-col items-center gap-0.5">
                        <span className="text-[12px] font-bold text-[#101A46]">{r2.label}</span>
                        <span className="text-[10px] font-medium tabular-nums" style={{ color: "#8892b0" }}>
                          {r2.method === "monthly" ? `מצטבר ${r2.monthlyRate.toFixed(2)} ליום בחודש` : "מוענק במלואו בתחילת השנה"}
                        </span>
                        {over && (
                          <span className="text-[9px] font-bold mt-0.5" style={{ color: "#ba1a1a" }}>
                            חוסר {(r2.used - r2.accrued).toFixed(2)} ימים — צפוי קיזוז בשכר
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {rubric.minStatus && (
                <div
                  className="relative z-10 mt-3 rounded-2xl px-4 py-3 flex items-center gap-3"
                  style={{
                    background: rubric.minStatus.met ? "rgba(15,118,110,0.06)" : "rgba(255,159,10,0.08)",
                    border: `1px solid ${rubric.minStatus.met ? "rgba(15,118,110,0.16)" : "rgba(255,159,10,0.22)"}`,
                  }}
                >
                  <span className="material-symbols-outlined" style={{ color: rubric.minStatus.met ? "#0F766E" : "#B45309", fontSize: 20 }}>
                    {rubric.minStatus.met ? "verified" : "warning"}
                  </span>
                  <p className="text-[11.5px] font-medium leading-snug" style={{ color: "#101A46" }}>
                    {rubric.minStatus.met
                      ? `ניצלת ${rubric.minStatus.usedThisYear.toFixed(1)} ימי חופש השנה — עמדת בחובת המינימום (${rubric.minStatus.required.toFixed(1)} ימים).`
                      : `חובה לנצל ${rubric.minStatus.required.toFixed(1)} ימי חופש השנה, ניצלת עד כה ${rubric.minStatus.usedThisYear.toFixed(1)} — נותרו ${rubric.minStatus.remaining.toFixed(1)} ימים לניצול עד סוף השנה.`}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Workday rows — real recent entries */}
          <div className="lh-rise flex flex-col gap-3 mt-4" style={{ animationDelay: "320ms" }}>
            <div className="flex justify-between items-end px-2 mb-1">
              <h2 className="text-[24px] leading-[32px] tracking-[-0.01em] font-bold" style={{ color: "#101A46" }}>כרטיס נוכחות</h2>
            </div>
            <div className="flex flex-col gap-2.5">
              {recentDays.length === 0 && (
                <div className="text-center py-8 text-[14px]" style={{ color: "#8892b0" }}>אין עדיין רישומים בחודש הזה. לחץ על "נכנסתי עכשיו" כדי להתחיל.</div>
              )}
              {recentDays.map((entry) => {
                const date = new Date(`${entry.date}T00:00:00`);
                const isToday = entry.date === todayStr;
                const isOff = entry.status === "sick" || entry.status === "vacation" || entry.status === "holiday" || entry.status === "off";
                const statusMeta = isOff ? STATUS_META[entry.status as DayStatus] : null;
                const target = getEffectiveDailyTarget(entry.date, entry, settings);
                const worked = getCountedHours(entry);
                const diff = worked - target;
                return (
                  <div
                    key={entry.date}
                    onClick={() => openDayModal(date, entry)}
                    className={`${isToday ? "bg-white/60" : "bg-white/40"} backdrop-blur-md rounded-[20px] p-4 flex justify-between items-center shadow-sm border cursor-pointer hover:bg-white/80 transition-colors relative overflow-hidden`}
                    style={{ borderColor: isToday ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.6)" }}
                  >
                    {isToday && <div className="absolute right-0 top-1/4 bottom-1/4 w-1 rounded-r-full" style={{ background: "#7639FF" }} />}
                    <div className="flex flex-col pl-4 pr-3">
                      <span className="text-[16px] font-bold" style={{ color: "#101A46" }}>{date.getDate()} ב{MONTH_HE[date.getMonth()]}</span>
                      <span
                        className="text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5"
                        style={{ color: statusMeta ? statusMeta.grad[0] : isToday ? "#7639FF" : "#46464f" }}
                      >
                        {statusMeta && <span className="material-symbols-outlined" style={{ fontSize: 13 }}>{statusMeta.icon}</span>}
                        {isOff
                          ? `${isToday ? "היום · " : ""}${statusMeta?.label}`
                          : isToday
                            ? "היום"
                            : WEEKDAY_HE_LONG[date.getDay()]}
                      </span>
                    </div>
                    <div className="flex items-center gap-5">
                      <div className="flex flex-col items-end">
                        {!isOff && (
                          <span className="text-[13px] font-medium text-[#46464f] tabular-nums" dir="ltr">
                            {entry.segments && entry.segments.length > 1
                              ? entry.segments.map((seg) => `${seg.start}-${seg.end ?? "?"}`).join(", ")
                              : `${entry.start_time || "--:--"} - ${entry.end_time || "--:--"}`}
                          </span>
                        )}
                        {!isOff && diff > 0.01 && (
                          <span className="text-[11px] font-bold px-2 py-0.5 rounded mt-0.5" style={{ color: "#003DAA", background: "rgba(0,61,170,0.05)" }}>
                            <span dir="ltr">{formatHM(diff)}+</span> עודף
                          </span>
                        )}
                        {!isOff && diff < -0.01 && !entry.deficitCoveredBy && (
                          <span className="text-[11px] font-bold px-2 py-0.5 rounded mt-0.5" style={{ color: "#ba1a1a", background: "rgba(186,26,26,0.05)" }}>
                            <span dir="ltr">{formatHM(-diff)}-</span> חוסר
                          </span>
                        )}
                        {!isOff && entry.deficitCoveredBy && (
                          <span
                            className="text-[11px] font-bold px-2 py-0.5 rounded mt-0.5"
                            style={{ color: STATUS_META[entry.deficitCoveredBy].grad[0], background: STATUS_META[entry.deficitCoveredBy].tint }}
                          >
                            כוסה ב{entry.deficitCoveredBy === "vacation" ? "חופש" : "מחלה"}
                          </span>
                        )}
                      </div>
                      <span className="text-[24px] font-bold tabular-nums" style={{ color: "#101A46", minWidth: 64, textAlign: "left" }}>{formatHM(worked)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            {allMonthDays.length > 5 && (
              <button
                onClick={() => setAttendanceExpanded((v) => !v)}
                className="mx-auto mt-4 px-6 py-2.5 rounded-full bg-white/60 backdrop-blur-md border border-white shadow-sm hover:bg-white/80 transition-colors text-[13px] font-bold flex items-center gap-2 uppercase tracking-wide"
                style={{ color: "#101A46" }}
              >
                {attendanceExpanded ? "כווץ" : `הרחב · כל ${allMonthDays.length} הימים בחודש`}
                <span className="material-symbols-outlined text-[18px] transition-transform duration-300" style={{ transform: attendanceExpanded ? "rotate(180deg)" : "none" }}>
                  expand_more
                </span>
              </button>
            )}
          </div>
        </div>
      </main>

      <LHBottomNav active="home" foodEnabled={!!settings.food_card_enabled} />

      <DayDetailModal
        date={dayModalDate}
        entry={dayModalEntry}
        settings={settings}
        onClose={() => setDayModalDate(null)}
        onSaved={refresh}
      />

      <ClockInEditModal
        open={clockInEditOpen}
        date={new Date()}
        entry={todayEntry}
        onClose={() => setClockInEditOpen(false)}
        onSaved={refresh}
      />

      {offDayPrompt && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-6" style={{ background: "rgba(16,26,70,0.5)", backdropFilter: "blur(4px)" }} onClick={() => setOffDayPrompt(false)}>
          <div
            className="lh-rise w-full max-w-[360px] rounded-[32px] p-6 flex flex-col gap-4 relative overflow-hidden"
            style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.97), rgba(248,250,255,0.99))", backdropFilter: "blur(30px)", boxShadow: "0 30px 70px -15px rgba(16,26,70,0.35)", border: "1px solid rgba(255,255,255,0.85)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute -top-14 -right-14 w-40 h-40 rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, rgba(217,119,6,0.25), transparent 70%)", filter: "blur(20px)" }} />
            <div className="flex items-center gap-3 relative z-10">
              <div className="w-12 h-12 rounded-full flex items-center justify-center shrink-0" style={{ background: "linear-gradient(155deg,#D97706,#FBBF24)", boxShadow: "0 10px 24px -8px rgba(217,119,6,0.5)" }}>
                <span className="material-symbols-outlined text-white" style={{ fontSize: 24 }}>event_busy</span>
              </div>
              <div>
                <h3 className="text-[16px] font-bold" style={{ color: "#101A46" }}>היום מוגדר כיום לא עובד</h3>
                <p className="text-[12px]" style={{ color: "#8892b0" }}>{WEEKDAY_HE_LONG[new Date().getDay()]} אינו יום עבודה בלוח שלך</p>
              </div>
            </div>
            <p className="text-[13px] relative z-10" style={{ color: "#46464f" }}>
              רוצה לעבוד היום בכל זאת, באופן חד-פעמי? כל השעות שתעבוד היום ייחשבו שעות נוספות ({overtimeTiersSummary}), כי היעד היומי הרגיל של יום זה הוא 0.
            </p>
            <div className="relative z-10">
              <label className="text-[11px] font-bold block mb-1" style={{ color: "#46464f" }}>כמה שעות אתה מתכנן לעבוד היום?</label>
              <input
                type="number"
                step="0.5"
                min="0.5"
                value={offDayHoursInput}
                onChange={(e) => setOffDayHoursInput(e.target.value)}
                className="w-full h-11 rounded-2xl px-4 text-[16px] font-bold outline-none"
                style={{ background: "#fff", border: "1px solid #e4e1e6", color: "#101A46" }}
              />
            </div>
            <div className="flex gap-2 relative z-10 mt-1">
              <button onClick={() => setOffDayPrompt(false)} className="flex-1 h-11 rounded-2xl font-bold" style={{ background: "rgba(35,50,100,0.06)", color: "#46464f" }}>
                ביטול
              </button>
              <button
                onClick={confirmOffDayClockIn}
                className="flex-1 h-11 rounded-2xl font-bold text-white"
                style={{ background: "linear-gradient(155deg,#D97706,#FBBF24)", boxShadow: "0 14px 30px -10px rgba(217,119,6,0.5)" }}
              >
                כן, התחל עבודה
              </button>
            </div>
          </div>
        </div>
      )}

      {eveningConfirmOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-6" style={{ background: "rgba(16,26,70,0.5)", backdropFilter: "blur(4px)" }} onClick={() => setEveningConfirmOpen(false)}>
          <div
            className="lh-rise w-full max-w-[360px] rounded-[32px] p-6 flex flex-col gap-4 relative overflow-hidden"
            style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.97), rgba(248,250,255,0.99))", backdropFilter: "blur(30px)", boxShadow: "0 30px 70px -15px rgba(16,26,70,0.35)", border: "1px solid rgba(255,255,255,0.85)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute -top-14 -right-14 w-40 h-40 rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, rgba(76,58,168,0.25), transparent 70%)", filter: "blur(20px)" }} />
            <div className="flex items-center gap-3 relative z-10">
              <div className="w-12 h-12 rounded-full flex items-center justify-center shrink-0" style={{ background: "linear-gradient(135deg,#1B1440,#4C3AA8,#7639FF)", boxShadow: "0 10px 24px -8px rgba(76,58,168,0.5)" }}>
                <span className="material-symbols-outlined text-white" style={{ fontSize: 22, fontVariationSettings: "'FILL' 1" }}>bedtime</span>
              </div>
              <div>
                <h3 className="text-[16px] font-bold" style={{ color: "#101A46" }}>בטוח שזו משמרת ערב?</h3>
                <p className="text-[12px]" style={{ color: "#8892b0" }}>עכשיו לפני הצהריים — משמרת ערב היא בדרך כלל בשעות הערב</p>
              </div>
            </div>
            <p className="text-[13px] relative z-10" style={{ color: "#46464f" }}>
              משמרת ערב מחשבת את היעד היומי לפי מספר השעות שהגדרת בהגדרות למשמרת ערב, במקום היעד הרגיל של היום. אם לחצת בטעות, בטלו ותלחצו על "נכנסתי עכשיו" הרגיל.
            </p>
            <div className="flex gap-2 relative z-10 mt-1">
              <button onClick={() => setEveningConfirmOpen(false)} className="flex-1 h-11 rounded-2xl font-bold" style={{ background: "rgba(35,50,100,0.06)", color: "#46464f" }}>
                ביטול
              </button>
              <button
                onClick={() => {
                  setEveningConfirmOpen(false);
                  handleClockIn(true);
                }}
                className="flex-1 h-11 rounded-2xl font-bold text-white"
                style={{ background: "linear-gradient(135deg,#1B1440,#4C3AA8,#7639FF)", boxShadow: "0 14px 30px -10px rgba(76,58,168,0.5)" }}
              >
                כן, משמרת ערב
              </button>
            </div>
          </div>
        </div>
      )}

      <Dialog open={overtimeInfoOpen} onOpenChange={setOvertimeInfoOpen}>
        <DialogContent className="max-w-md rounded-[28px] p-6" style={{ background: "#F8FAFF" }} dir="rtl">
          <DialogHeader>
            <div className="flex items-center gap-2.5 justify-end">
              <DialogTitle style={{ color: "#101A46" }}>שעות נוספות שנצברו החודש</DialogTitle>
              <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: "linear-gradient(155deg,#00A8CC,#00D2FF)" }}>
                <span className="material-symbols-outlined text-white text-[18px]">sync_alt</span>
              </div>
            </div>
          </DialogHeader>
          <div className="flex items-baseline gap-2 mt-2">
            <span
              className="tabular-nums leading-none"
              dir="ltr"
              style={{ fontFamily: "'Bricolage Grotesque', 'Heebo', system-ui, sans-serif", fontSize: 40, fontWeight: 800, letterSpacing: "-0.02em", color: "#00A8CC" }}
            >
              {formatHM(accruedOvertimeThisMonth)}
            </span>
            <span className="text-[13px] font-bold" style={{ color: "#8892b0" }}>שעות</span>
            <span className="tabular-nums text-[16px] font-bold mr-1" style={{ color: "#00A8CC" }}>{`₪${Math.round(accruedOvertimePayThisMonth).toLocaleString("he-IL")}`}</span>
          </div>
          <p className="text-[12.5px] leading-relaxed mt-2" style={{ color: "#8892b0" }}>
            אצלך שעות נוספות משולמות בתלוש של החודש שאחרי — השעות האלה לא נכללות בתחזית של החודש הנוכחי, ויופיעו ישירות תחת "שעות נוספות" ויתווספו למשכורת בתלוש {nextPayoutMonthLabel}.
          </p>
          <button
            onClick={() => { setOvertimeInfoOpen(false); navigate("/design-preview/reports"); }}
            className="w-full h-11 rounded-2xl font-bold text-white mt-3 flex items-center justify-center gap-1.5"
            style={{ background: "linear-gradient(155deg,#00A8CC,#00D2FF)" }}
          >
            לפירוט המלא בדוחות
            <span className="material-symbols-outlined text-[18px]">chevron_left</span>
          </button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
