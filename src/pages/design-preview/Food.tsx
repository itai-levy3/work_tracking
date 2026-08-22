import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { format } from "date-fns";
import { isLocalAuthenticated } from "@/lib/localAuth";
import { addFoodEntry, deleteFoodEntry, enableFoodTracking, FoodEntry, getFoodEntriesForMonth, getSettings, UserSettings } from "@/lib/localData";
import { checkDailyCap, computeFoodMonthSummary, splitByDailyCap } from "@/lib/foodCard";
import { LH } from "./tokens";
import { LHHeader, LHBottomNav, globalStyle } from "./Shared";

const MONTH_HE = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
const money = (n: number) => `₪${Math.round(n).toLocaleString("he-IL")}`;
const dateKey = (d: Date) => format(d, "yyyy-MM-dd");
const todayKey = dateKey(new Date());

const FOOD_ICONS = ["lunch_dining", "local_cafe", "icecream", "bakery_dining", "ramen_dining", "restaurant"];

const foodStyle = `
  @keyframes food-float { 0% { transform: translateY(0) rotate(0deg); opacity: 0; } 12% { opacity: 0.9; } 88% { opacity: 0.9; } 100% { transform: translateY(-140px) rotate(18deg); opacity: 0; } }
  .food-particle { animation: food-float 7s ease-in-out infinite; }
  @keyframes food-ring-spin { to { transform: rotate(360deg); } }
  .food-ring { animation: food-ring-spin 10s linear infinite; }
  @keyframes food-pulse { 0%,100% { opacity: 0.4; transform: scale(0.96); } 50% { opacity: 0.7; transform: scale(1.06); } }
  .food-glow { animation: food-pulse 3.2s ease-in-out infinite; }
  @keyframes food-pop { 0% { opacity: 0; transform: scale(0.4) rotate(-20deg); } 60% { opacity: 1; transform: scale(1.08) rotate(3deg); } 100% { opacity: 1; transform: scale(1) rotate(0deg); } }
  .food-pop { animation: food-pop .6s cubic-bezier(.2,1.4,.4,1) both; }
  @keyframes food-row-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .food-row-in { animation: food-row-in .35s cubic-bezier(.16,1,.3,1) both; }
  .food-btn { transition: transform .2s cubic-bezier(.34,1.56,.64,1), box-shadow .2s; }
  .food-btn:active { transform: scale(0.94); }
  @media (hover: hover) and (pointer: fine) {
    .food-btn:hover { transform: translateY(-2px); }
  }
`;

export default function DesignPreviewFood() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  const [entries, setEntries] = useState<FoodEntry[]>([]);

  const [onboardStep, setOnboardStep] = useState<"ask_card" | "has_card_setup" | "ask_track_anyway" | "no_card_setup" | null>(null);
  const [obMonthlyAmount, setObMonthlyAmount] = useState("");
  const [obDailyCap, setObDailyCap] = useState("");

  const [addOpen, setAddOpen] = useState(false);
  const [amountInput, setAmountInput] = useState("");
  const [noteInput, setNoteInput] = useState("");
  const [dateInput, setDateInput] = useState(todayKey);
  const [capConfirm, setCapConfirm] = useState<{ requested: number; note: string; cardAmount: number; personalTopUp: number } | null>(null);

  const refresh = () => {
    setEntries(getFoodEntriesForMonth(currentMonth.getFullYear(), currentMonth.getMonth()));
  };

  useEffect(() => {
    if (!isLocalAuthenticated()) {
      navigate("/design-preview/login");
      return;
    }
    setSettings(getSettings());
    setLoading(false);
  }, [navigate]);

  useEffect(() => {
    if (!settings) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMonth, settings]);

  const todayEntries = useMemo(() => entries.filter((e) => e.date === todayKey), [entries]);
  const summary = useMemo(() => computeFoodMonthSummary(entries, settings?.food_card_monthly_amount || 0), [entries, settings]);
  const remainingPct = summary.monthlyAllowance > 0 ? Math.max(0, Math.min(100, (summary.remaining / summary.monthlyAllowance) * 100)) : 0;
  const isLow = remainingPct <= 15;

  if (loading || !settings) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: LH.background }}>
        <div className="w-12 h-12 rounded-full border-2 animate-spin" style={{ borderColor: "#F5970033", borderTopColor: "#F59E0B" }} />
      </div>
    );
  }

  const startOnboarding = () => setOnboardStep("ask_card");

  const finishHasCardSetup = () => {
    const amount = parseFloat(obMonthlyAmount) || 0;
    const cap = parseFloat(obDailyCap) || 0;
    if (amount <= 0) return toast.error("צריך להזין סכום חודשי בכרטיס");
    setSettings(enableFoodTracking(true, amount, cap));
    setOnboardStep(null);
    toast.success("כרטיס האוכל מוכן למעקב!");
  };

  const finishNoCardSetup = () => {
    const amount = parseFloat(obMonthlyAmount) || 0;
    if (amount <= 0) return toast.error("צריך להזין סכום חודשי למעקב");
    setSettings(enableFoodTracking(false, amount, 0));
    setOnboardStep(null);
    toast.success("מעקב האוכל מוכן! התוספת נכנסת אוטומטית למשכורת בדוחות.");
  };

  const submitExpense = () => {
    const amount = parseFloat(amountInput) || 0;
    if (amount <= 0) return toast.error("יש להזין סכום תקין");
    const entriesForDate = entries.filter((e) => e.date === dateInput);
    const check = checkDailyCap(entriesForDate, amount, settings.food_card_daily_cap);
    if (check.exceedsCapBy > 0) {
      const { cardAmount, personalTopUp } = splitByDailyCap(amount, check);
      setCapConfirm({ requested: amount, note: noteInput, cardAmount, personalTopUp });
      return;
    }
    addFoodEntry({
      id: crypto.randomUUID(),
      date: dateInput,
      time: dateInput === todayKey ? format(new Date(), "HH:mm") : undefined,
      cardAmount: amount,
      note: noteInput.trim() || undefined,
    });
    setAmountInput("");
    setNoteInput("");
    setDateInput(todayKey);
    setAddOpen(false);
    refresh();
    toast.success("ההוצאה נרשמה");
  };

  const confirmOverCap = () => {
    if (!capConfirm) return;
    addFoodEntry({
      id: crypto.randomUUID(),
      date: dateInput,
      time: dateInput === todayKey ? format(new Date(), "HH:mm") : undefined,
      cardAmount: capConfirm.cardAmount,
      personalTopUp: capConfirm.personalTopUp,
      note: capConfirm.note.trim() || undefined,
    });
    setCapConfirm(null);
    setAmountInput("");
    setNoteInput("");
    setDateInput(todayKey);
    setAddOpen(false);
    refresh();
    toast.success(`נרשם! ${money(capConfirm.personalTopUp)} מזה מהאשראי האישי שלך`);
  };

  const grad = isLow ? ["#DC2626", "#F87171"] : ["#F59E0B", "#FB923C"];
  const glow = isLow ? "rgba(220,38,38,0.5)" : "rgba(245,158,11,0.5)";

  return (
    <div dir="rtl" className="min-h-screen w-full flex flex-col relative" style={{ background: LH.background, color: LH.onSurface, fontFamily: "'Heebo', system-ui, sans-serif" }}>
      <style>{`${globalStyle}${foodStyle}`}</style>
      <LHHeader />
      <main className="flex-1 relative w-full pt-20 pb-32 px-6 overflow-x-hidden">
        <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
          <div className="absolute -top-20 -right-20 w-72 h-72 rounded-full blur-[100px] opacity-30" style={{ background: "#F59E0B" }} />
          <div className="absolute bottom-32 -left-20 w-64 h-64 rounded-full blur-[90px] opacity-20" style={{ background: "#FB923C" }} />
        </div>

        <div className="flex flex-col w-full max-w-[440px] mx-auto relative z-10">
          {!settings.food_card_enabled ? (
            <div className="lh-rise flex flex-col items-center gap-5 pt-10 text-center">
              <div className="w-20 h-20 rounded-3xl flex items-center justify-center" style={{ background: "linear-gradient(155deg,#F59E0B,#FB923C)", boxShadow: "0 20px 45px -12px rgba(245,158,11,0.5)" }}>
                <span className="material-symbols-outlined text-white" style={{ fontSize: 40 }}>lunch_dining</span>
              </div>
              <div>
                <h1 className="text-[22px] font-bold mb-1" style={{ color: "#101A46" }}>מעקב הוצאות אוכל</h1>
                <p className="text-[14px]" style={{ color: LH.onSurfaceVariant }}>עוקבים אחרי כרטיס האוכל שלך, או פשוט אחרי מה שאתה מוציא על אוכל — בכל חודש זה מתאפס מחדש.</p>
              </div>

              {onboardStep === null && (
                <button onClick={startOnboarding} className="food-btn h-12 px-8 rounded-2xl font-bold text-white" style={{ background: "linear-gradient(155deg,#F59E0B,#FB923C)", boxShadow: "0 14px 30px -10px rgba(245,158,11,0.5)" }}>
                  בואו נתחיל
                </button>
              )}

              {onboardStep === "ask_card" && (
                <div className="w-full rounded-[28px] p-6 flex flex-col gap-4" style={{ background: "rgba(255,255,255,0.85)", backdropFilter: "blur(20px)", boxShadow: "0 20px 45px -14px rgba(35,50,100,0.12)" }}>
                  <p className="text-[15px] font-bold" style={{ color: "#101A46" }}>יש לך כרטיס אוכל מהעבודה?</p>
                  <div className="flex gap-2">
                    <button onClick={() => setOnboardStep("has_card_setup")} className="flex-1 h-11 rounded-xl font-bold text-white" style={{ background: "linear-gradient(155deg,#F59E0B,#FB923C)" }}>כן, יש לי</button>
                    <button onClick={() => setOnboardStep("ask_track_anyway")} className="flex-1 h-11 rounded-xl font-bold" style={{ background: "rgba(35,50,100,0.06)", color: LH.onSurfaceVariant }}>אין לי</button>
                  </div>
                </div>
              )}

              {onboardStep === "has_card_setup" && (
                <div className="w-full rounded-[28px] p-6 flex flex-col gap-4 text-right" style={{ background: "rgba(255,255,255,0.85)", backdropFilter: "blur(20px)", boxShadow: "0 20px 45px -14px rgba(35,50,100,0.12)" }}>
                  <div>
                    <label className="text-[12px] font-bold block mb-1" style={{ color: LH.onSurfaceVariant }}>כמה כסף יש בכרטיס בכל חודש?</label>
                    <input type="number" value={obMonthlyAmount} onChange={(e) => setObMonthlyAmount(e.target.value)} placeholder="לדוגמה: 500" className="w-full h-11 rounded-xl px-4 text-[15px] font-bold" style={{ background: "#fff", border: "1px solid #e4e1e6", color: "#101A46" }} />
                  </div>
                  <div>
                    <label className="text-[12px] font-bold block mb-1" style={{ color: LH.onSurfaceVariant }}>יש תקרת הוצאה יומית? (אופציונלי)</label>
                    <input type="number" value={obDailyCap} onChange={(e) => setObDailyCap(e.target.value)} placeholder="לדוגמה: 40" className="w-full h-11 rounded-xl px-4 text-[15px] font-bold" style={{ background: "#fff", border: "1px solid #e4e1e6", color: "#101A46" }} />
                  </div>
                  <button onClick={finishHasCardSetup} className="food-btn h-11 rounded-xl font-bold text-white" style={{ background: "linear-gradient(155deg,#F59E0B,#FB923C)" }}>סיימתי, בואו נתחיל</button>
                </div>
              )}

              {onboardStep === "ask_track_anyway" && (
                <div className="w-full rounded-[28px] p-6 flex flex-col gap-4" style={{ background: "rgba(255,255,255,0.85)", backdropFilter: "blur(20px)", boxShadow: "0 20px 45px -14px rgba(35,50,100,0.12)" }}>
                  <p className="text-[15px] font-bold" style={{ color: "#101A46" }}>רוצה בכל זאת לעקוב אחרי כמה אתה מוציא על אוכל?</p>
                  <div className="flex gap-2">
                    <button onClick={() => setOnboardStep("no_card_setup")} className="flex-1 h-11 rounded-xl font-bold text-white" style={{ background: "linear-gradient(155deg,#F59E0B,#FB923C)" }}>כן, בואו נעקוב</button>
                    <button onClick={() => setOnboardStep(null)} className="flex-1 h-11 rounded-xl font-bold" style={{ background: "rgba(35,50,100,0.06)", color: LH.onSurfaceVariant }}>לא כרגע</button>
                  </div>
                </div>
              )}

              {onboardStep === "no_card_setup" && (
                <div className="w-full rounded-[28px] p-6 flex flex-col gap-4 text-right" style={{ background: "rgba(255,255,255,0.85)", backdropFilter: "blur(20px)", boxShadow: "0 20px 45px -14px rgba(35,50,100,0.12)" }}>
                  <div>
                    <label className="text-[12px] font-bold block mb-1" style={{ color: LH.onSurfaceVariant }}>כמה כסף אתה רוצה להקציב לאוכל בחודש?</label>
                    <input type="number" value={obMonthlyAmount} onChange={(e) => setObMonthlyAmount(e.target.value)} placeholder="לדוגמה: 500" className="w-full h-11 rounded-xl px-4 text-[15px] font-bold" style={{ background: "#fff", border: "1px solid #e4e1e6", color: "#101A46" }} />
                  </div>
                  <button onClick={finishNoCardSetup} className="food-btn h-11 rounded-xl font-bold text-white" style={{ background: "linear-gradient(155deg,#F59E0B,#FB923C)" }}>סיימתי, בואו נתחיל</button>
                </div>
              )}
            </div>
          ) : (
            <>
              {/* Month selector */}
              <div className="pt-2 pb-4 flex justify-center">
                <div className="bg-white/80 backdrop-blur-xl rounded-full px-6 py-3 flex items-center gap-6 border border-white" style={{ boxShadow: "0 8px 24px rgba(35,50,100,0.05)" }}>
                  <button onClick={() => setCurrentMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))} style={{ color: LH.onSurfaceVariant }}>
                    <span className="material-symbols-outlined">chevron_right</span>
                  </button>
                  <span className="text-[16px] font-bold" style={{ color: "#101A46" }}>{MONTH_HE[currentMonth.getMonth()]} {currentMonth.getFullYear()}</span>
                  <button onClick={() => setCurrentMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))} style={{ color: LH.onSurfaceVariant }}>
                    <span className="material-symbols-outlined">chevron_left</span>
                  </button>
                </div>
              </div>

              {/* Balance orb */}
              <div className="flex flex-col items-center gap-4 py-4">
                <div className="relative flex items-center justify-center" style={{ width: 260, height: 260 }}>
                  {FOOD_ICONS.map((icon, i) => (
                    <span
                      key={i}
                      className="food-particle material-symbols-outlined absolute pointer-events-none"
                      style={{ fontSize: 18, color: grad[0], left: `${15 + i * 14}%`, bottom: 10, animationDelay: `${i * 1.1}s` }}
                    >
                      {icon}
                    </span>
                  ))}
                  <div className="food-glow absolute rounded-full pointer-events-none" style={{ width: 230, height: 230, background: `radial-gradient(circle, ${glow}, transparent 70%)`, filter: "blur(22px)" }} />
                  <div className="food-ring absolute rounded-full" style={{ width: 200, height: 200, background: `conic-gradient(from 0deg, ${grad[0]}, ${grad[1]}, ${grad[0]})`, opacity: 0.5 }} />
                  <div
                    className="food-pop relative rounded-full flex flex-col items-center justify-center overflow-hidden"
                    style={{
                      width: 190,
                      height: 190,
                      background: `radial-gradient(circle at 30% 24%, rgba(255,255,255,0.95), ${grad[1]} 34%, ${grad[0]} 78%)`,
                      boxShadow: `0 26px 55px -12px ${glow}, inset 0 3px 6px rgba(255,255,255,0.5), inset 0 -10px 20px rgba(0,0,0,0.12)`,
                    }}
                  >
                    <div className="absolute top-4 w-10 h-10 rounded-full flex items-center justify-center" style={{ background: "rgba(255,255,255,0.28)" }}>
                      <span className="material-symbols-outlined text-white" style={{ fontSize: 20 }}>{settings.food_card_has_card ? "credit_card" : "savings"}</span>
                    </div>
                    <span className="relative z-10 text-white font-extrabold leading-none" style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif", fontSize: 38, letterSpacing: "-0.03em", marginTop: 8 }}>
                      {money(Math.max(0, summary.remaining))}
                    </span>
                    <span className="relative z-10 text-white text-[11px] font-bold uppercase tracking-wider mt-1.5">נותר החודש</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 px-4 py-2 rounded-full" style={{ background: `${grad[0]}14` }}>
                  <span className="text-[12.5px] font-bold" style={{ color: "#101A46" }}>
                    {money(summary.spentFromCard)} מתוך {money(summary.monthlyAllowance)}
                  </span>
                </div>
                {summary.personalTopUpTotal > 0 && (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full" style={{ background: "rgba(220,38,38,0.08)" }}>
                    <span className="material-symbols-outlined text-[14px]" style={{ color: "#DC2626" }}>credit_card</span>
                    <span className="text-[11.5px] font-bold" style={{ color: "#DC2626" }}>שילמת {money(summary.personalTopUpTotal)} מהאשראי האישי מעבר לתקרה</span>
                  </div>
                )}
              </div>

              <button
                onClick={() => setAddOpen(true)}
                className="food-btn w-full h-12 rounded-2xl font-bold text-white flex items-center justify-center gap-2 mb-6"
                style={{ background: "linear-gradient(155deg,#F59E0B,#FB923C)", boxShadow: "0 14px 30px -10px rgba(245,158,11,0.5)" }}
              >
                <span className="material-symbols-outlined text-[20px]">add_circle</span>
                הוספת הוצאת אוכל
              </button>

              {/* Entries list */}
              <div className="flex flex-col gap-3">
                <h2 className="text-[16px] font-bold px-1" style={{ color: "#101A46" }}>הוצאות החודש</h2>
                {entries.length === 0 && (
                  <div className="text-center py-8 text-[13px]" style={{ color: LH.onSurfaceVariant }}>עדיין לא נרשמו הוצאות אוכל החודש.</div>
                )}
                {[...entries].reverse().map((e, i) => {
                  const date = new Date(`${e.date}T00:00:00`);
                  const isToday = e.date === todayKey;
                  return (
                    <div
                      key={e.id}
                      className="food-row-in rounded-2xl p-4 flex items-center justify-between relative overflow-hidden"
                      style={{ animationDelay: `${Math.min(i, 6) * 40}ms`, background: "rgba(255,255,255,0.75)", backdropFilter: "blur(20px)", boxShadow: "0 8px 24px rgba(35,50,100,0.04)", border: "1px solid rgba(255,255,255,0.7)" }}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${grad[0]}14` }}>
                          <span className="material-symbols-outlined text-[18px]" style={{ color: grad[0] }}>restaurant</span>
                        </div>
                        <div>
                          <div className="text-[13px] font-bold" style={{ color: "#101A46" }}>{isToday ? "היום" : `${date.getDate()} ב${MONTH_HE[date.getMonth()]}`} {e.time ? `· ${e.time}` : ""}</div>
                          {e.note && <div className="text-[11.5px]" style={{ color: LH.onSurfaceVariant }}>{e.note}</div>}
                          {!!e.personalTopUp && (
                            <div className="text-[10.5px] font-bold" style={{ color: "#DC2626" }}><span dir="ltr">+{money(e.personalTopUp)}</span> מהאשראי האישי</div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[15px] font-extrabold tabular-nums" style={{ color: "#101A46" }}>{money(e.cardAmount + (e.personalTopUp || 0))}</span>
                        <button onClick={() => { deleteFoodEntry(e.id); refresh(); }} className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: "rgba(220,38,38,0.08)", color: "#DC2626" }}>
                          <span className="material-symbols-outlined text-[15px]">close</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </main>

      <LHBottomNav active="food" foodEnabled={!!settings.food_card_enabled} />

      {/* Add expense sheet */}
      {addOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-6" style={{ background: "rgba(16,26,70,0.5)", backdropFilter: "blur(4px)" }} onClick={() => setAddOpen(false)}>
          <div
            className="lh-rise w-full max-w-[360px] rounded-[32px] p-6 flex flex-col gap-4"
            style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.97), rgba(255,251,245,0.99))", backdropFilter: "blur(30px)", boxShadow: "0 30px 70px -15px rgba(16,26,70,0.35)", border: "1px solid rgba(255,255,255,0.85)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined" style={{ color: "#F59E0B" }}>restaurant</span>
              <h3 className="text-[16px] font-bold" style={{ color: "#101A46" }}>הוצאת אוכל חדשה</h3>
            </div>
            <div>
              <label className="text-[11px] font-bold block mb-1" style={{ color: LH.onSurfaceVariant }}>כמה שילמת?</label>
              <input type="number" autoFocus value={amountInput} onChange={(e) => setAmountInput(e.target.value)} placeholder="₪" className="w-full h-12 rounded-2xl px-4 text-[18px] font-bold" style={{ background: "#fff", border: "1px solid #e4e1e6", color: "#101A46" }} />
            </div>
            <div>
              <label className="text-[11px] font-bold block mb-1" style={{ color: LH.onSurfaceVariant }}>תאריך</label>
              <input
                type="date"
                value={dateInput}
                max={todayKey}
                onChange={(e) => setDateInput(e.target.value || todayKey)}
                className="w-full h-11 rounded-2xl px-4 text-[14px]"
                style={{ background: "#fff", border: "1px solid #e4e1e6", color: "#101A46" }}
              />
            </div>
            <div>
              <label className="text-[11px] font-bold block mb-1" style={{ color: LH.onSurfaceVariant }}>הערה (אופציונלי)</label>
              <input type="text" value={noteInput} onChange={(e) => setNoteInput(e.target.value)} placeholder='למשל: "צהריים"' className="w-full h-11 rounded-2xl px-4 text-[14px]" style={{ background: "#fff", border: "1px solid #e4e1e6", color: "#101A46" }} />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setAddOpen(false);
                  setDateInput(todayKey);
                }}
                className="flex-1 h-11 rounded-2xl font-bold"
                style={{ background: "rgba(35,50,100,0.06)", color: LH.onSurfaceVariant }}
              >
                ביטול
              </button>
              <button onClick={submitExpense} className="flex-1 h-11 rounded-2xl font-bold text-white" style={{ background: "linear-gradient(155deg,#F59E0B,#FB923C)" }}>שמירה</button>
            </div>
          </div>
        </div>
      )}

      {/* Over-cap confirmation */}
      {capConfirm && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center px-6" style={{ background: "rgba(16,26,70,0.55)", backdropFilter: "blur(4px)" }}>
          <div className="lh-rise w-full max-w-[360px] rounded-[32px] p-6 flex flex-col gap-4" style={{ background: "rgba(255,255,255,0.97)", backdropFilter: "blur(30px)", boxShadow: "0 30px 70px -15px rgba(16,26,70,0.35)" }}>
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-full flex items-center justify-center shrink-0" style={{ background: "rgba(220,38,38,0.1)" }}>
                <span className="material-symbols-outlined" style={{ color: "#DC2626" }}>warning</span>
              </div>
              <h3 className="text-[15px] font-bold" style={{ color: "#101A46" }}>חריגה מתקרת ההוצאה היומית</h3>
            </div>
            <p className="text-[13px]" style={{ color: LH.onSurfaceVariant }}>
              ההוצאה ({money(capConfirm.requested)}) חורגת מהתקרה היומית. הכרטיס יכסה <span className="font-bold" style={{ color: "#101A46" }}>{money(capConfirm.cardAmount)}</span>, וההפרש של <span className="font-bold" style={{ color: "#DC2626" }}>{money(capConfirm.personalTopUp)}</span> ישולם מהאשראי האישי שלך. במעקב הכללי תרד רק התקרה.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setCapConfirm(null)} className="flex-1 h-11 rounded-2xl font-bold" style={{ background: "rgba(35,50,100,0.06)", color: LH.onSurfaceVariant }}>ביטול</button>
              <button onClick={confirmOverCap} className="flex-1 h-11 rounded-2xl font-bold text-white" style={{ background: "linear-gradient(155deg,#DC2626,#F87171)" }}>מאשר, שלם מהאשראי שלי</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
