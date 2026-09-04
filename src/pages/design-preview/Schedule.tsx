import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { isFullyAuthenticated, isLocalAuthenticated } from "@/lib/localAuth";
import { DayStatus, getCountedHours, getSettings, getWorkHoursForMonth, UserSettings, WorkHour } from "@/lib/localData";
import { LH, STATUS_META } from "./tokens";
import { LHHeader, LHBottomNav, LHLoadingScreen, globalStyle } from "./Shared";
import { DayDetailModal } from "./DayDetailModal";

const weekdays = ["א'", "ב'", "ג'", "ד'", "ה'", "ו'", "ש'"];
const MONTH_HE = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
const WEEKDAY_HE_LONG = ["יום ראשון", "יום שני", "יום שלישי", "יום רביעי", "יום חמישי", "יום שישי", "שבת"];
const dateKey = (d: Date) => format(d, "yyyy-MM-dd");
const todayKey = dateKey(new Date());

export default function DesignPreviewSchedule() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  const [workHours, setWorkHours] = useState<WorkHour[]>([]);
  const [modalDate, setModalDate] = useState<Date | null>(null);
  const [modalEntry, setModalEntry] = useState<WorkHour | undefined>(undefined);

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

  const refresh = () => {
    setWorkHours(getWorkHoursForMonth(currentMonth.getFullYear(), currentMonth.getMonth()) || []);
  };

  useEffect(() => {
    if (!settings) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMonth, settings]);

  const entriesByDate = useMemo(() => {
    const map = new Map<string, WorkHour>();
    workHours.forEach((w) => map.set(w.date, w));
    return map;
  }, [workHours]);

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leading = new Date(year, month, 1).getDay();

  const upcomingNotes = useMemo(
    () => workHours.filter((w) => w.note && w.date >= todayKey).sort((a, b) => a.date.localeCompare(b.date)),
    [workHours],
  );

  const openDay = (day: number) => {
    const date = new Date(year, month, day);
    setModalEntry(entriesByDate.get(dateKey(date)));
    setModalDate(date);
  };

  if (loading || !settings) {
    return <LHLoadingScreen />;
  }

  return (
    <div dir="rtl" className="min-h-screen w-full flex flex-col" style={{ background: LH.background, color: LH.onSurface, fontFamily: "'Heebo', system-ui, sans-serif" }}>
      <style>{globalStyle}</style>
      <LHHeader />
      <main className="flex-1 relative w-full pt-20 pb-32 px-6 overflow-x-hidden">
        <div className="flex flex-col w-full relative max-w-[440px] mx-auto">
          <div className="absolute -top-40 -left-20 w-96 h-96 rounded-full blur-[100px] pointer-events-none opacity-60" style={{ background: `${LH.primaryFixed}4D` }} />
          <div className="absolute top-20 -right-20 w-80 h-80 rounded-full blur-[80px] pointer-events-none opacity-50" style={{ background: `${LH.secondaryFixed}4D` }} />

          <section className="lh-rise mb-10 relative z-10">
            <h1 className="text-[32px] leading-[40px] tracking-[-0.02em] font-bold mb-2" style={{ color: LH.onSurface }}>לוח זמנים</h1>
            <p className="text-[16px] leading-6" style={{ color: LH.onSurfaceVariant }}>לחצו על כל יום כדי לתכנן משמרת ערב, חופש/מחלה מראש, או להשאיר הערה — גם ליום שטרם הגיע.</p>
          </section>

          <section className="lh-rise mb-10 relative z-10" style={{ animationDelay: "60ms" }}>
            <div className="rounded-[24px] p-6 relative overflow-hidden transition-all duration-500" style={{ background: `${LH.surface}E6`, backdropFilter: "blur(30px)", boxShadow: "0 16px 45px rgba(35,50,100,0.07)" }}>
              <div className="flex justify-between items-center mb-6">
                <button
                  onClick={() => setCurrentMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
                  className="w-10 h-10 rounded-full flex items-center justify-center transition-colors hover:scale-105 active:scale-95 shadow-sm"
                  style={{ background: LH.surfaceContainer, color: LH.onSurfaceVariant }}
                >
                  <span className="material-symbols-outlined text-[20px]">chevron_right</span>
                </button>
                <span className="text-[18px] leading-7 font-bold tracking-wide" style={{ color: LH.onSurface }}>{MONTH_HE[month]} {year}</span>
                <button
                  onClick={() => setCurrentMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
                  className="w-10 h-10 rounded-full flex items-center justify-center transition-colors hover:scale-105 active:scale-95 shadow-sm"
                  style={{ background: LH.surfaceContainer, color: LH.onSurfaceVariant }}
                >
                  <span className="material-symbols-outlined text-[20px]">chevron_left</span>
                </button>
              </div>

              <div className="grid grid-cols-7 gap-y-4 mb-2">
                {weekdays.map((d) => (
                  <div key={d} className="text-center text-[12px] font-bold tracking-[0.08em]" style={{ color: LH.onSurfaceVariant }}>{d}</div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-y-2 relative">
                {Array.from({ length: leading }).map((_, i) => <div key={`b${i}`} className="h-10" />)}
                {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
                  const dKey = dateKey(new Date(year, month, day));
                  const isToday = dKey === todayKey;
                  const entry = entriesByDate.get(dKey);
                  const dayStatus: DayStatus | null =
                    entry?.status && entry.status in STATUS_META
                      ? (entry.status as DayStatus)
                      : entry && getCountedHours(entry) > 0
                        ? "worked"
                        : null;
                  const meta = dayStatus ? STATUS_META[dayStatus] : null;
                  const isEvening = entry?.evening;
                  const hasNote = !!entry?.note;
                  const isWorkScheduled = settings.work_days[new Date(year, month, day).toLocaleDateString("en-US", { weekday: "long" }).toLowerCase()];
                  return (
                    <div key={day} onClick={() => openDay(day)} className="h-10 flex items-center justify-center relative cursor-pointer">
                      {isToday ? (
                        <div
                          className="absolute inset-1 rounded-full"
                          style={{
                            background: `linear-gradient(to bottom right, ${LH.primary}, ${LH.secondary})`,
                            boxShadow: "0 8px 20px rgba(89,2,232,0.3)",
                            border: meta ? `2px solid ${meta.grad[1]}` : undefined,
                          }}
                        />
                      ) : (
                        meta && <div className="absolute inset-1 rounded-full" style={{ background: meta.tint }} />
                      )}
                      <span
                        className="text-[16px] relative z-10 transition-colors font-bold"
                        style={{
                          color: isToday ? LH.onPrimary : meta ? meta.grad[0] : isWorkScheduled ? LH.onSurfaceVariant : `${LH.onSurfaceVariant}66`,
                          fontWeight: isToday || meta ? 700 : 400,
                        }}
                      >
                        {day}
                      </span>
                      <div className="absolute bottom-1 flex gap-0.5">
                        {isEvening && <div className="w-1 h-1 rounded-full" style={{ background: isToday ? "#fff" : LH.secondary }} />}
                        {hasNote && <div className="w-1 h-1 rounded-full" style={{ background: isToday ? "#fff" : LH.tertiaryContainer }} />}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 pt-4 flex flex-wrap justify-center gap-x-4 gap-y-2" style={{ borderTop: `1px solid ${LH.surfaceVariant}` }}>
                {(Object.keys(STATUS_META) as DayStatus[]).map((st) => (
                  <div key={st} className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full" style={{ background: STATUS_META[st].grad[0] }} />
                    <span className="text-[11px] font-bold tracking-[0.05em]" style={{ color: LH.onSurfaceVariant }}>{STATUS_META[st].label}</span>
                  </div>
                ))}
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full" style={{ background: LH.secondary }} />
                  <span className="text-[11px] font-bold tracking-[0.05em]" style={{ color: LH.onSurfaceVariant }}>משמרת ערב</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full" style={{ background: LH.tertiaryContainer }} />
                  <span className="text-[11px] font-bold tracking-[0.05em]" style={{ color: LH.onSurfaceVariant }}>הערה</span>
                </div>
              </div>
            </div>
          </section>

          <section className="lh-rise pb-10 relative z-10" style={{ animationDelay: "120ms" }}>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-1 h-6 rounded-full" style={{ background: LH.primary }} />
              <h2 className="text-[18px] leading-7" style={{ color: LH.onSurface }}>הערות ואירועים קרובים</h2>
            </div>
            <div className="flex flex-col gap-4">
              {upcomingNotes.length === 0 && (
                <div className="text-center py-6 text-[13px]" style={{ color: LH.onSurfaceVariant }}>
                  אין הערות קרובות. לחצו על יום בלוח כדי להשאיר הערה — למשל תזכורת ליציאה מוקדמת.
                </div>
              )}
              {upcomingNotes.map((entry) => {
                const date = new Date(`${entry.date}T00:00:00`);
                return (
                  <div
                    key={entry.date}
                    onClick={() => {
                      setModalEntry(entry);
                      setModalDate(date);
                    }}
                    className="rounded-2xl p-5 relative overflow-hidden cursor-pointer hover:opacity-90 transition-opacity"
                    style={{ background: `${LH.surfaceContainer}99`, backdropFilter: "blur(10px)", boxShadow: "0 8px 20px rgba(35,50,100,0.04)" }}
                  >
                    <div className="absolute left-0 top-0 bottom-0 w-1" style={{ background: LH.tertiaryContainer }} />
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-xl flex items-center justify-center shadow-inner shrink-0" style={{ background: `${LH.tertiaryContainer}1A` }}>
                        <span className="material-symbols-outlined text-[24px]" style={{ color: LH.tertiaryContainer }}>event_note</span>
                      </div>
                      <div>
                        <h3 className="text-[16px] mb-1" style={{ color: LH.onSurface }}>{date.getDate()} ב{MONTH_HE[date.getMonth()]} · {WEEKDAY_HE_LONG[date.getDay()]}</h3>
                        <p className="text-[12px] font-normal" style={{ color: LH.onSurfaceVariant }}>{entry.note}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </main>
      <LHBottomNav active="schedule" foodEnabled={!!settings.food_card_enabled} />

      <DayDetailModal
        date={modalDate}
        entry={modalEntry}
        settings={settings}
        onClose={() => setModalDate(null)}
        onSaved={refresh}
      />
    </div>
  );
}
