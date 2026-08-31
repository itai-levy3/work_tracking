import {
  computeLeaveUsage,
  computeMonthlyPayroll,
  computeVacationMinimumStatus,
  CORRECTABLE_PAYROLL_FIELDS,
  getProfileFirstName,
  getSettings,
  getWorkHoursForYear,
} from "@/lib/localData";

/**
 * The OpenAI key lives only in Netlify's server-side environment (OPENAI_KEY) and is read by
 * netlify/functions/ai-assistant.ts — it never reaches this client bundle. This module only
 * gathers a compact summary of the user's own already-loaded local data and asks the question.
 */

const RECENT_DAYS_WINDOW = 60;

/** "YYYY-MM-DD" from local calendar components — toISOString() converts to UTC first, which in a
 * timezone ahead of UTC can report the wrong day entirely for several hours after local midnight. */
const localDateKey = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const buildContext = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const settings = getSettings();

  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - RECENT_DAYS_WINDOW);
  const cutoffKey = localDateKey(cutoff);

  const recentDays = getWorkHoursForYear(year)
    .filter((d) => d.date >= cutoffKey)
    .map((d) => ({
      date: d.date,
      status: d.status || "worked",
      hoursWorked: d.hours_worked,
      fraction: d.fraction,
      segments: d.segments,
      note: d.note,
    }));

  const payroll = computeMonthlyPayroll(year, month, settings);
  const vacationMinimum = computeVacationMinimumStatus(settings, now);

  return {
    today: localDateKey(now),
    firstName: getProfileFirstName(),
    settings: {
      workDays: settings.work_days,
      hoursPerDay: settings.hours_per_day,
      hourlyRate: settings.hourly_rate,
      salaryMode: settings.salary_mode,
      employmentStartDate: settings.employment_start_date,
      annualVacationDays: settings.annual_vacation_days,
      annualSickDays: settings.annual_sick_days,
      minVacationDaysRequired: settings.min_vacation_days_required,
    },
    vacationUsedThisYear: computeLeaveUsage(year, "vacation", settings, now),
    sickUsedThisYear: computeLeaveUsage(year, "sick", settings, now),
    vacationMinimumStatus: vacationMinimum,
    thisMonthPayroll: {
      regularHours: payroll.regularHours,
      overtimeHours: payroll.overtimeHours,
      regularPay: payroll.regularPay,
      overtimePay: payroll.overtimePay,
      netPay: payroll.netPay,
      daysWorked: payroll.daysWorked,
      unpaidLeaveDays: payroll.unpaidLeaveDays,
      holidayDays: payroll.holidayDays,
    },
    recentDays,
  };
};

export const askAiAssistant = async (question: string): Promise<string> => {
  const context = buildContext();
  const resp = await fetch("/.netlify/functions/ai-assistant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, context }),
  });
  const data = await resp.json().catch(() => ({}) as { answer?: string; error?: string });
  if (!resp.ok) throw new Error(data.error || "שגיאה בשירות ה-AI");
  return String(data.answer || "");
};

export interface PayrollDeviationAnalysis {
  /** One id from CORRECTABLE_PAYROLL_FIELDS, or null if nothing in the allow-list matched. */
  field: string | null;
  explanation: string;
}

/** Sends one month's estimated-vs-actual net pay gap (plus whatever the user typed about it) to
 * the same AI assistant, asking it to pin the deviation to one specific, known-safe settings
 * field when the description clearly points to one (e.g. "מס הכנסה לא היה נכון" → income tax) —
 * the exact corrected number is computed deterministically from the deviation, never guessed by
 * the model, so this only ever needs to identify WHICH field, not what value. */
export const analyzePayrollDeviation = async (params: {
  year: number;
  month: number;
  estimatedNet: number;
  actualNet: number;
  reasonLabel?: string;
  note: string;
}): Promise<PayrollDeviationAnalysis> => {
  const { year, month, estimatedNet, actualNet, reasonLabel, note } = params;
  const diff = actualNet - estimatedNet;
  const fieldList = CORRECTABLE_PAYROLL_FIELDS.map((f) => `${f.id} (${f.label})`).join(", ");
  const question = `נתח פער בין המשכורת שהאפליקציה חישבה למשכורת שהתקבלה בפועל.
השורה הראשונה בתשובה שלך חייבת להיות בדיוק בפורמט: שדה: <מזהה השדה מהרשימה, או none אם אין התאמה ברורה וחד-משמעית>
לאחר מכן, משורה שנייה, הסבר קצר וממוקד בעברית (2-3 משפטים) למה כנראה נוצר הפער.
בחר שדה רק אם התיאור של המשתמש מצביע עליו במפורש וללא ספק — אחרת יש להשיב none. רשימת השדות המותרים בלבד: ${fieldList}.
חודש: ${month + 1}/${year}
נטו משוער במערכת: ₪${Math.round(estimatedNet)}
נטו בפועל שהתקבל: ₪${Math.round(actualNet)}
הפרש: ${diff >= 0 ? "+" : ""}₪${Math.round(diff)}
סיבה שהמשתמש בחר: ${reasonLabel || "לא נבחרה סיבה ספציפית"}
תיאור חופשי מהמשתמש: ${note || "(לא הוזן)"}`;
  const answer = await askAiAssistant(question);
  const lines = answer.split("\n");
  const firstLineMatch = lines[0]?.match(/שדה:\s*(\S+)/);
  const candidate = firstLineMatch?.[1]?.replace(/[.,:]$/, "");
  const field = candidate && candidate !== "none" && CORRECTABLE_PAYROLL_FIELDS.some((f) => f.id === candidate) ? candidate : null;
  const explanation = field || firstLineMatch ? lines.slice(1).join("\n").trim() || answer : answer;
  return { field, explanation };
};
