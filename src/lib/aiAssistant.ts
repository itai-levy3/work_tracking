import {
  computeLeaveUsage,
  computeMonthlyPayroll,
  computeVacationMinimumStatus,
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
