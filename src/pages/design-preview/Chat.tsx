import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { isFullyAuthenticated, isLocalAuthenticated } from "@/lib/localAuth";
import { askAiAssistant } from "@/lib/aiAssistant";
import {
  computeCumulativeAccrued,
  computeCumulativeLeaveUsage,
  computeMonthlyPayroll,
  computeVacationMinimumStatus,
  formatHM,
  getCountedHours,
  getEffectiveDailyTarget,
  getProfileFirstName,
  getSettings,
  getWorkHoursForMonth,
  UserSettings,
} from "@/lib/localData";
import { LH } from "./tokens";
import { LHHeader, LHBottomNav, globalStyle } from "./Shared";

interface Msg {
  id: number;
  from: "user" | "bot";
  text: string;
}

const quickQuestions: { text: string; icon: string }[] = [
  { text: "כמה ימי חופש נשארו לי?", icon: "beach_access" },
  { text: "כמה ימי מחלה השתמשתי השנה?", icon: "sick" },
  { text: "כמה שעות נוספות עשיתי החודש?", icon: "bolt" },
  { text: "מה המשכורת המשוערת שלי החודש?", icon: "payments" },
  { text: "כמה שעות עבדתי החודש?", icon: "schedule" },
];

const money = (n: number) => `₪${Math.round(n).toLocaleString("he-IL")}`;

/**
 * Local, rule-based fast path — answers direct questions about the user's real data instantly
 * and without any network call. Returns null when the question doesn't match a known pattern, so
 * the caller can fall back to the real AI assistant (see askAiAssistant) for freeform questions.
 */
function answerQueryLocal(query: string, settings: UserSettings): string | null {
  const q = query.trim();
  const now = new Date();
  const monthWorkHours = getWorkHoursForMonth(now.getFullYear(), now.getMonth());

  const hasVacation = q.includes("חופש") || q.includes("חופשה");
  const hasSick = q.includes("מחלה");
  const hasOvertime = q.includes("נוספות") || q.includes("נוסף");
  const hasSalary = q.includes("משכורת") || q.includes("שכר") || q.includes("נטו");
  const hasHoursGeneral = q.includes("שעות") && !hasOvertime;
  const asksRemaining = q.includes("נשאר") || q.includes("כמה") || q.includes("יתרה");

  if (hasVacation && asksRemaining && !hasSalary) {
    const accrued = computeCumulativeAccrued(settings.annual_vacation_days || 0, settings.vacation_accrual_method, settings.employment_start_date);
    const used = computeCumulativeLeaveUsage("vacation", settings);
    const remaining = accrued - used;
    const minStatus = computeVacationMinimumStatus(settings);
    const minNote = minStatus && !minStatus.met
      ? ` שימי לב — יש חובה לנצל לפחות ${minStatus.required.toFixed(1)} ימים השנה, וניצלת עד כה רק ${minStatus.usedThisYear.toFixed(1)}.`
      : "";
    return `היתרה המצטברת שלך (לא מתאפסת בסוף שנה) היא ${accrued.toFixed(2)} ימי חופש שנצברו בסך הכל, ניצלת עד כה ${used.toFixed(2)} ומהם נותרו לך ${remaining.toFixed(2)} ימים.${
      remaining < 0 ? " שימי לב — ניצלת יותר ממה שהצטבר, וזה עלול להוריד מהמשכורת." : minNote
    }`;
  }

  if (hasSick && !hasSalary) {
    const accrued = computeCumulativeAccrued(settings.annual_sick_days || 0, settings.sick_accrual_method, settings.employment_start_date);
    const used = computeCumulativeLeaveUsage("sick", settings);
    return `השתמשת בסך הכל ב-${used.toFixed(2)} ימי מחלה, מתוך ${accrued.toFixed(2)} שהצטברו לך עד היום (יתרה מצטברת, לא מתאפסת בסוף שנה).`;
  }

  if (hasOvertime) {
    const payroll = computeMonthlyPayroll(now.getFullYear(), now.getMonth(), settings);
    return `החודש עשית ${formatHM(payroll.overtimeHours)} שעות נוספות, ששוות בערך ${money(payroll.overtimePay)}.`;
  }

  if (hasSalary) {
    const payroll = computeMonthlyPayroll(now.getFullYear(), now.getMonth(), settings);
    return `המשכורת המשוערת שלך החודש היא ${money(payroll.netPay)} נטו (${formatHM(payroll.regularHours + payroll.overtimeHours)} שעות, כולל ${money(payroll.overtimePay)} שעות נוספות).`;
  }

  if (hasHoursGeneral) {
    const totalWorked = monthWorkHours.reduce((s, w) => {
      const isWorked = w.status === "worked" || !w.status;
      const isPaidOff = (w.status === "sick" || w.status === "vacation" || w.status === "holiday" || w.status === "off") && w.paid !== false;
      return isWorked || isPaidOff ? s + getCountedHours(w) : s;
    }, 0);
    if (q.includes("היום")) {
      // Local calendar date, not toISOString() — that converts to UTC first and can report the
      // wrong day for hours after local midnight in a timezone ahead of UTC.
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const todayEntry = monthWorkHours.find((w) => w.date === todayStr);
      const target = getEffectiveDailyTarget(todayStr, todayEntry, settings);
      const worked = todayEntry && (todayEntry.status === "worked" || !todayEntry.status) ? getCountedHours(todayEntry) : 0;
      const diff = worked - target;
      return diff >= 0
        ? `היום כבר עשית ${formatHM(worked)} שעות, זה ${diff > 0 ? `+${formatHM(diff)} שעות נוספות` : "בדיוק את היעד"}.`
        : `היום עשית עד כה ${formatHM(worked)} שעות, נשארו לך עוד ${formatHM(-diff)} להשלמת היעד היומי.`;
    }
    return `עבדת החודש ${formatHM(totalWorked)} שעות.`;
  }

  return null;
}

export default function DesignPreviewChat() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [firstName, setFirstName] = useState("");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

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
      setFirstName(getProfileFirstName());
      setLoading(false);
    });
  }, [navigate]);

  useEffect(() => {
    if (settings && messages.length === 0) {
      setMessages([
        {
          id: 0,
          from: "bot",
          text: `היי ${firstName}! אני יודע לענות על שאלות ישירות על החופש, המחלה, השעות הנוספות והשכר שלך — ולכל שאלה אחרת יש לי גם חיבור למודל AI אמיתי.`,
        },
      ]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, firstName]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = async (text: string) => {
    if (!text.trim() || !settings) return;
    const userMsg: Msg = { id: Date.now(), from: "user", text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");

    const localAnswer = answerQueryLocal(text, settings);
    if (localAnswer) {
      setMessages((prev) => [...prev, { id: Date.now() + 1, from: "bot", text: localAnswer }]);
      return;
    }

    const thinkingId = Date.now() + 1;
    setMessages((prev) => [...prev, { id: thinkingId, from: "bot", text: "חושב/ת..." }]);
    try {
      const aiAnswer = await askAiAssistant(text);
      setMessages((prev) => prev.map((m) => (m.id === thinkingId ? { ...m, text: aiAnswer } : m)));
    } catch (error) {
      const message = error instanceof Error ? error.message : "שגיאה בשירות ה-AI";
      setMessages((prev) => prev.map((m) => (m.id === thinkingId ? { ...m, text: message } : m)));
    }
  };

  if (loading || !settings) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: LH.background }}>
        <div className="w-12 h-12 rounded-full border-2 animate-spin" style={{ borderColor: `${LH.primary}33`, borderTopColor: LH.primary }} />
      </div>
    );
  }

  return (
    <div dir="rtl" className="min-h-screen w-full flex flex-col relative" style={{ background: LH.background, color: LH.onSurface, fontFamily: "'Heebo', system-ui, sans-serif" }}>
      <style>{`
        ${globalStyle}
        @keyframes lh-orb-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes lh-pulse-ring { 0% { transform: scale(0.9); opacity: 0.6; } 70% { transform: scale(1.35); opacity: 0; } 100% { opacity: 0; } }
        @keyframes lh-bubble-in { from { opacity: 0; transform: translateY(10px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
        .lh-orb::before {
          content: "";
          position: absolute;
          inset: -3px;
          border-radius: inherit;
          background: conic-gradient(from 0deg, #7639FF, #00D2FF, #19CEA0, #7639FF);
          animation: lh-orb-spin 6s linear infinite;
          z-index: -1;
        }
        .lh-pulse::after {
          content: "";
          position: absolute;
          inset: 0;
          border-radius: inherit;
          border: 2px solid #00D2FF;
          animation: lh-pulse-ring 2.4s cubic-bezier(.4,0,.6,1) infinite;
        }
        .lh-bubble-in { animation: lh-bubble-in .45s cubic-bezier(.16,1,.3,1) both; }
        .lh-chip { transition: transform .2s, box-shadow .2s, border-color .2s; }
        .lh-chip:active { transform: scale(0.96); }
        @media (hover:hover) and (pointer:fine) {
          .lh-chip:hover { transform: translateY(-2px); box-shadow: 0 12px 24px -10px rgba(118,57,255,0.35); border-color: #7639FF66 !important; }
        }
        .lh-composer:focus-within {
          box-shadow: 0 0 0 3px rgba(118,57,255,0.18), 0 16px 40px -12px rgba(118,57,255,0.35) !important;
          border-color: rgba(118,57,255,0.5) !important;
        }
        .lh-send:active { transform: scale(0.92); }
      `}</style>

      {/* Ambient background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute -top-24 -right-24 w-80 h-80 rounded-full blur-[100px] opacity-40" style={{ background: "#7639FF" }} />
        <div className="absolute top-1/3 -left-28 w-72 h-72 rounded-full blur-[100px] opacity-30" style={{ background: "#00D2FF" }} />
        <div className="absolute bottom-40 right-10 w-64 h-64 rounded-full blur-[90px] opacity-25" style={{ background: "#19CEA0" }} />
      </div>

      <LHHeader />
      <main className="flex-1 relative w-full pt-20 pb-52 px-6 flex flex-col overflow-x-hidden z-10">
        <div className="flex flex-col w-full max-w-[440px] mx-auto flex-1">
          <div className="lh-rise flex items-center gap-3 mb-6 mt-2">
            <div className="relative w-14 h-14 shrink-0">
              <div
                className="lh-orb lh-pulse relative w-14 h-14 rounded-2xl flex items-center justify-center"
                style={{ background: "linear-gradient(155deg,#7639FF,#00D2FF,#19CEA0)", boxShadow: "0 14px 30px -8px rgba(118,57,255,0.55)" }}
              >
                <span className="material-symbols-outlined text-white text-[26px]">smart_toy</span>
              </div>
            </div>
            <div>
              <h1
                className="text-[22px] font-extrabold leading-tight"
                style={{ background: "linear-gradient(90deg,#7639FF,#00D2FF)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}
              >
                העוזר שלי
              </h1>
              <div className="flex items-center gap-1.5 mt-1">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#19CEA0" }} />
                <span className="text-[11px] font-bold tracking-[0.06em]" style={{ color: LH.onSurfaceVariant }}>נתונים מקומיים · מחובר ל-AI</span>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 flex-1">
            {messages.map((m, i) => (
              <div key={m.id} className={`flex items-end gap-2 lh-bubble-in ${m.from === "user" ? "justify-end" : "justify-start"}`} style={{ animationDelay: `${Math.min(i, 4) * 40}ms` }}>
                {m.from === "bot" && (
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 mb-0.5"
                    style={{ background: "linear-gradient(155deg,#7639FF,#00D2FF)" }}
                  >
                    <span className="material-symbols-outlined text-white text-[14px]">smart_toy</span>
                  </div>
                )}
                <div
                  className="max-w-[80%] px-4 py-3 rounded-2xl text-[14px] leading-relaxed"
                  style={
                    m.from === "user"
                      ? { background: "linear-gradient(155deg,#7639FF,#00D2FF)", color: "#fff", borderBottomLeftRadius: 6, boxShadow: "0 10px 24px -10px rgba(118,57,255,0.5)" }
                      : { background: "rgba(255,255,255,0.85)", backdropFilter: "blur(14px)", color: LH.onSurface, border: "1px solid rgba(118,57,255,0.12)", borderBottomRightRadius: 6, boxShadow: "0 8px 20px -8px rgba(35,50,100,0.1)" }
                  }
                >
                  {m.text}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {messages.length <= 1 && (
            <div className="flex flex-col gap-2 mt-5">
              <span className="text-[11px] font-bold tracking-[0.08em] px-1" style={{ color: LH.onSurfaceVariant }}>שאלות מהירות</span>
              <div className="flex flex-wrap gap-2">
                {quickQuestions.map((q) => (
                  <button
                    key={q.text}
                    onClick={() => send(q.text)}
                    className="lh-chip flex items-center gap-1.5 px-3.5 py-2.5 rounded-2xl text-[12.5px] font-bold"
                    style={{ background: "rgba(255,255,255,0.85)", backdropFilter: "blur(10px)", color: LH.onSurface, border: "1px solid rgba(118,57,255,0.18)", boxShadow: "0 6px 16px -8px rgba(35,50,100,0.12)" }}
                  >
                    <span className="material-symbols-outlined text-[16px]" style={{ color: "#7639FF" }}>{q.icon}</span>
                    {q.text}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Composer */}
      <div className="fixed inset-x-0 z-40 px-6" style={{ bottom: 132 }}>
        <div
          className="lh-composer max-w-[440px] mx-auto flex items-center gap-2 rounded-full p-2 transition-shadow duration-300"
          style={{ background: "rgba(255,255,255,0.9)", backdropFilter: "blur(24px)", border: "1.5px solid rgba(255,255,255,0.9)", boxShadow: "0 16px 40px -14px rgba(35,50,100,0.3)" }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send(input)}
            placeholder="שאל אותי על החופש, השעות או השכר שלך..."
            className="flex-1 bg-transparent outline-none text-[14px] px-3"
            style={{ color: LH.onSurface }}
          />
          <button
            onClick={() => send(input)}
            disabled={!input.trim()}
            className="lh-send w-11 h-11 rounded-full flex items-center justify-center shrink-0 disabled:opacity-40 transition-transform duration-150"
            style={{ background: "linear-gradient(155deg,#7639FF,#00D2FF,#19CEA0)", boxShadow: input.trim() ? "0 10px 22px -8px rgba(118,57,255,0.6)" : "none" }}
          >
            <span className="material-symbols-outlined text-white text-[20px]" style={{ transform: "scaleX(-1)" }}>send</span>
          </button>
        </div>
      </div>

      <LHBottomNav active="chat" foodEnabled={!!settings.food_card_enabled} />
    </div>
  );
}
