import {
  calcHoursBetween,
  computeDayPay,
  DayStatus,
  effectiveDayFraction,
  fractionMultiplier,
  getCountedHours,
  getEffectiveDailyTarget,
  UserSettings,
  WorkHour,
} from "@/lib/localData";

export interface FeedPart {
  category: DayStatus;
  hours: number;
  paid: boolean;
}

/** Any day, whatever shape it was saved in, as a flat list of "this much of the day was X, paid or not". */
export const feedParts = (w: WorkHour, target: number): FeedPart[] => {
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

/** A day is "finished" once it's in the past, or today with its shift closed / a leave or mixed day marked. */
export const isFinishedDay = (w: WorkHour, todayKey: string): boolean => {
  if (w.date > todayKey) return false;
  const open = (w.status === "worked" || !w.status) && !!w.start_time && !w.end_time && !w.dayParts?.length;
  if (open) return false;
  return w.date < todayKey || !!w.dayParts?.length || !!w.end_time || (!!w.status && w.status !== "worked");
};

export interface DayMessage {
  lines: string[];
  pay: number;
  category: DayStatus;
  isMixed: boolean;
}

/**
 * The plain-language line(s) for one finished day: full pay, a sick day covered from the balance,
 * a sick day the balance couldn't cover, unpaid vacation, holiday, a day off — and for a mixed day
 * (worked + something else) a combined line that depends on what the rest of the day was.
 */
export const buildDayMessage = (w: WorkHour, settings: UserSettings): DayMessage => {
  const target = getEffectiveDailyTarget(w.date, w, settings);
  const parts = feedParts(w, target);
  const { pay, overtimePay } = computeDayPay(w, settings);
  const workedHours = parts.filter((p) => p.category === "worked").reduce((s, p) => s + p.hours, 0);
  const others = parts.filter((p) => p.category !== "worked");
  const has = (cat: DayStatus, paid?: boolean) => others.some((p) => p.category === cat && (paid === undefined || p.paid === paid));
  const unpaidAny = others.some((p) => !p.paid);
  const lines: string[] = [];

  if (workedHours > 0.001 && others.length === 0) {
    if (workedHours >= target - 0.01) {
      lines.push(overtimePay > 0.5 ? "קיבלת שכר מלא על היום, ועוד שעות נוספות 💪" : "קיבלת שכר מלא על היום 😊");
    } else {
      lines.push(`שולם על ${Math.floor(workedHours)}:${String(Math.round((workedHours % 1) * 60)).padStart(2, "0")} שעות עבודה 🙂`);
    }
  } else if (workedHours > 0.001) {
    // Worked part of the day, and the rest was something else.
    if (unpaidAny) lines.push("טוב שהצלחתם לעבוד, אבל שאר היום לא על חשבון המערכת 😕");
    else if (has("holiday")) lines.push("טוב שעבדתם היום, ויהיה המשך יום חג שמח 🎉");
    else if (has("sick")) lines.push("טוב שעבדת היום, ובשאר היום — תרגישו טוב 🤒");
    else if (has("vacation")) lines.push("טוב שעבדת היום, ובשאר היום — תהיו בחופש 🌴");
  } else {
    // A day only partly covered by the balance (a paid slice and an unpaid slice of the SAME kind) is
    // ONE message about a partial wage — never the "covered" line followed by the "not covered" line.
    if (has("sick", true) && has("sick", false)) lines.push("מקווה שתרגישו טוב. אך נוכל לתת לך רק חלק מהשכר על היום הזה 🤒");
    else if (has("sick", true)) lines.push("תרגישו טוב, ופיצינו אתכם על יום המחלה על חשבון ימי המחלה 🤒");
    else if (has("sick", false)) lines.push("מקווה שתרגישו טוב, אבל המערכת לא יכולה לתת לך כסף על זה 🤒");
    if (has("vacation", true) && has("vacation", false)) lines.push("שתהיה חופשה נעימה. אך לא נוכל לתת לך חלק מהשכר על היום הזה 🌴");
    else if (has("vacation", true)) lines.push("מגיע לך חופשה! 🌴");
    else if (has("vacation", false)) lines.push("תהנו בחופשה, אבל זה על חשבונך 🏖️");
    if (has("off")) lines.push("שמנו לב שאינך מקבל על זה שכר 👀");
    if (has("holiday")) lines.push("שיהיה לך חג שמח 🎉");
  }

  const dominant = parts.length ? parts.reduce((a, b) => (b.hours > a.hours ? b : a)) : null;
  return { lines, pay, category: dominant?.category ?? "worked", isMixed: new Set(parts.map((p) => p.category)).size > 1 };
};
