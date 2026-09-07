import {
  computeLeaveUsage,
  computeMonthlyPayroll,
  computeVacationMinimumStatus,
  CORRECTABLE_PAYROLL_FIELDS,
  getPayrollActual,
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

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

/** `history` carries prior turns of the SAME conversation (e.g. an ongoing investigation in the
 * chat) so the model keeps context across messages instead of answering each one cold. `extraContext`
 * merges in ad-hoc fields (a payroll deviation being investigated, allowedFields for a FIX
 * proposal, etc.) on top of the always-included local-data snapshot. */
export const askAiAssistant = async (question: string, history: ChatTurn[] = [], extraContext: Record<string, unknown> = {}): Promise<string> => {
  const context = { ...buildContext(), ...extraContext };
  const resp = await fetch("/.netlify/functions/ai-assistant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, context, history }),
  });
  const data = await resp.json().catch(() => ({}) as { answer?: string; error?: string });
  if (!resp.ok) throw new Error(data.error || "שגיאה בשירות ה-AI");
  return String(data.answer || "");
};

export interface PayrollDeviationAnalysis {
  /** One id from CORRECTABLE_PAYROLL_FIELDS, or null if nothing in the allow-list matched. */
  field: string | null;
  explanation: string;
  /** Whether the same-direction gap shows up in prior months too — a real signal that this is a
   * wrong permanent setting, not a one-off event, worth surfacing prominently to the user. */
  isRecurring: boolean;
  /** The full raw conversation so far (this exchange), handed off to the chat page so "המשך
   * בצ'אט" continues the SAME investigation instead of starting cold. */
  history: ChatTurn[];
}

const MONTH_HE = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];

/** Looks back up to 6 prior months for a saved actual-net record, comparing it against what the
 * plain estimate would have been — a same-direction gap repeating across months points at a wrong
 * permanent setting (hourly rate, a deduction mode) rather than a one-off event that month. */
const buildRecurrenceContext = (year: number, month: number, diffSign: number) => {
  const settings = getSettings();
  const history: { month: string; estimated: number; actual: number; diff: number }[] = [];
  let recurringCount = 0;
  for (let back = 1; back <= 6; back++) {
    const d = new Date(year, month - back, 1);
    const actual = getPayrollActual(d.getFullYear(), d.getMonth());
    if (!actual) continue;
    const estimate = computeMonthlyPayroll(d.getFullYear(), d.getMonth(), settings).netPay;
    const diff = actual.actualNet - estimate;
    history.push({ month: `${MONTH_HE[d.getMonth()]} ${d.getFullYear()}`, estimated: Math.round(estimate), actual: Math.round(actual.actualNet), diff: Math.round(diff) });
    if (Math.abs(diff) > 30 && Math.sign(diff) === diffSign) recurringCount += 1;
  }
  return { priorMonths: history, isRecurring: recurringCount >= 2 };
};

/** Sends one month's estimated-vs-actual net pay gap (plus whatever the user typed about it) to
 * the AI assistant for a genuinely thorough investigation — not a single guess. Checks hourly
 * rate/cap first (the most common and highest-impact cause), then statutory deductions, leave/sick
 * accounting, and overtime settings, and looks at whether the SAME gap repeats in prior months
 * (a recurring gap means a wrong permanent setting, not a one-off). Only proposes a concrete field
 * fix when it's genuinely confident, via a FIX block the UI turns into a one-tap confirmation. */
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
  const settings = getSettings();
  const recurrence = buildRecurrenceContext(year, month, Math.sign(diff));
  const question = `בצע חקירה מעמיקה של הפער בין המשכורת שהאפליקציה חישבה למשכורת שהתקבלה בפועל — לא תשובה שטחית. עבור על כל אחת מהאפשרויות שהוגדרו לך (שכר שעתי/תקרה, ניכויי חובה, ימי חופש/מחלה/חג, שעות נוספות, האם הפער חוזר על עצמו) ותסביר מה בדקת ומה המסקנה מכל אחת, לפני שאתה מגיע למסקנה סופית.
השורה הראשונה בתשובה שלך חייבת להיות בדיוק בפורמט: שדה: <מזהה השדה מהרשימה, או none אם אחרי החקירה עדיין אין התאמה סבירה>
לאחר מכן ההסבר המלא בעברית (חופשי באורך, אבל ממוקד — לא לשונות ריקות).
אם אתה בטוח בהצעת תיקון קונקרטית, סיים גם בבלוק FIX כמו שהוגדר לך בהוראות המערכת, עם "scope":"month" (זה חודש ספציפי, לא שינוי קבוע).
רשימת השדות המותרים בלבד (allowedFields): ${fieldList}.
נתוני שכר נוכחיים: מצב שכר=${settings.salary_mode ?? "hourly"}, שכר שעתי=₪${settings.hourly_rate ?? 0}${settings.salary_mode === "cap" ? `, תקרת שכר חודשית=₪${settings.salary_cap_amount ?? 0}` : ""}
חודש: ${month + 1}/${year}
נטו משוער במערכת: ₪${Math.round(estimatedNet)}
נטו בפועל שהתקבל: ₪${Math.round(actualNet)}
הפרש: ${diff >= 0 ? "+" : ""}₪${Math.round(diff)}
סיבה שהמשתמש בחר: ${reasonLabel || "לא נבחרה סיבה ספציפית"}
תיאור חופשי מהמשתמש: ${note || "(לא הוזן)"}
נתוני חודשים קודמים לבדיקת הישנות (previousMonthsComparison): ${JSON.stringify(recurrence.priorMonths)}
isDeviationRecurring: ${recurrence.isRecurring}`;
  const answer = await askAiAssistant(question, [], { allowedFields: CORRECTABLE_PAYROLL_FIELDS.map((f) => f.id) });
  const lines = answer.split("\n");
  const firstLineMatch = lines[0]?.match(/שדה:\s*(\S+)/);
  const candidate = firstLineMatch?.[1]?.replace(/[.,:]$/, "");
  const field = candidate && candidate !== "none" && CORRECTABLE_PAYROLL_FIELDS.some((f) => f.id === candidate) ? candidate : null;
  const explanation = field || firstLineMatch ? lines.slice(1).join("\n").trim() || answer : answer;
  return {
    field,
    explanation,
    isRecurring: recurrence.isRecurring,
    history: [
      { role: "user", content: question },
      { role: "assistant", content: answer },
    ],
  };
};

export interface ProposedFix {
  field: string;
  value: number;
  scope: "future" | "month";
  label: string;
}

/** Parses a trailing ```FIX ... ``` JSON block out of an AI reply, if present, validating the
 * field against CORRECTABLE_PAYROLL_FIELDS — a proposal for a field outside the allow-list (a
 * misread or a prompt-injection attempt) is discarded, never surfaced as actionable. Returns the
 * reply text with the block stripped, plus the parsed proposal (or null). */
export const extractProposedFix = (reply: string): { text: string; fix: ProposedFix | null } => {
  const match = reply.match(/```FIX\s*([\s\S]*?)```/);
  if (!match) return { text: reply.trim(), fix: null };
  const text = reply.slice(0, match.index).trim();
  try {
    const parsed = JSON.parse(match[1].trim());
    const meta = CORRECTABLE_PAYROLL_FIELDS.find((f) => f.id === parsed.field);
    if (!meta || typeof parsed.value !== "number" || !Number.isFinite(parsed.value) || (parsed.scope !== "future" && parsed.scope !== "month")) {
      return { text, fix: null };
    }
    return { text, fix: { field: parsed.field, value: parsed.value, scope: parsed.scope, label: meta.label } };
  } catch {
    return { text, fix: null };
  }
};
