import { getCurrentUserEmail } from "@/lib/localAuth";
import { calculateStatutoryPayroll, StatutoryPayrollResult } from "@/lib/payrollTax";
import {
  fetchPdfArchiveEntry,
  PulledData,
  pushDeleteFoodEntry,
  pushDeleteWorkHour,
  pushDeleteWorkHoursRange,
  pushFoodEntry,
  pushPayrollActual,
  pushPdfArchiveEntry,
  pushSettings,
  pushWorkHour,
} from "@/lib/supabaseSync";

/**
 * "YYYY-MM-DD" built directly from local calendar components — never via `Date#toISOString()`,
 * which converts to UTC first. In any timezone ahead of UTC (e.g. Israel), midnight-local on the
 * 1st (or last day) of a month rolls back a calendar day in UTC, so `new Date(y,m,1).toISOString()`
 * silently produces the LAST day of the PREVIOUS month. That shifted every month/year date-range
 * filter in this file one day early, which on the actual last day of a month excluded that day's
 * own entry entirely — the "clock-in does nothing" bug.
 */
const localDateKey = (year: number, month: number, day: number): string =>
  `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

export type DayFraction = "full" | "three_quarters" | "half" | "quarter";

/**
 * "worked" (default) | "vacation" | "sick" | "holiday" (חג — always paid in full, never counted
 * against vacation/sick balances) | "off" (לא עובד — always unpaid, never counted against
 * vacation/sick balances).
 */
export type DayStatus = "worked" | "vacation" | "sick" | "holiday" | "off";

/** One clock-in/clock-out segment within a day. Days with a single shift never need this — only
 * a day where the employee clocked back in after already clocking out earlier gets more than one. */
export interface WorkHourSegment {
  start: string;
  end: string | null;
  evening?: boolean;
}

export interface WorkHour {
  date: string;
  hours_worked: number;
  start_time: string | null;
  end_time: string | null;
  /** Full breakdown when a day has more than one clock-in/out (e.g. left and came back). When
   * present, hours_worked is always the sum of every completed segment's duration, and
   * start_time/end_time always mirror the LAST (most recent) segment for backward compatibility. */
  segments?: WorkHourSegment[];
  status?: string | null;
  /** Fraction of a day for non-"worked" entries (full / 3-4 / half). Ignored for "worked". */
  fraction?: DayFraction;
  /** Whether a non-"worked" entry is paid. "holiday" is always paid, "off" is always unpaid — only vacation/sick are user-toggled. */
  paid?: boolean;
  /**
   * On a "worked" day that fell short of its daily target, marks the shortfall as covered by
   * leave instead of a missing-hours shortfall. Deducts (target - worked) / target as a
   * fractional day from that leave type's yearly balance.
   */
  deficitCoveredBy?: "vacation" | "sick";
  /**
   * Only meaningful when status === "holiday" and fraction !== "full": the holiday's own fraction
   * is always paid in full and never touches any balance, but the REST of the day is automatically
   * a vacation-day request. true (default when unset) = that remainder is paid vacation (deducted
   * from the vacation balance, possibly negative). false = the remainder is unpaid and excluded
   * from salary, same as any other unpaid leave.
   */
  remainderPaid?: boolean;
  /** Marks this specific "worked" day as an evening shift — its target comes from evening_shift_hours. */
  evening?: boolean;
  /** A free-text note/event left on this day (e.g. "יציאה מוקדמת ב-15:30"), settable in advance via Schedule. */
  note?: string;
  /**
   * Set only when clocking in on a day NOT in `settings.work_days` (e.g. clocking in on a Friday
   * when Friday isn't a scheduled work day) after the user confirms a one-time working day and
   * states how many hours they plan to work. Purely a display value for the live countdown /
   * estimated-exit time on Home — the actual daily target for payroll stays 0 for this day, so
   * every hour worked counts as overtime, matching a genuinely unscheduled work day.
   */
  oneTimePlannedHours?: number;
}

/** Formats a decimal hours value as "H:MM" (e.g. 8.75 -> "8:45"), never a decimal point. */
export const formatHM = (hoursDecimal: number): string => {
  const totalMinutes = Math.round(hoursDecimal * 60);
  const sign = totalMinutes < 0 ? "-" : "";
  const abs = Math.abs(totalMinutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${h}:${String(m).padStart(2, "0")}`;
};

export const fractionMultiplier = (fraction: DayFraction | undefined): number => {
  switch (fraction) {
    case "three_quarters":
      return 0.75;
    case "half":
      return 0.5;
    case "quarter":
      return 0.25;
    default:
      return 1;
  }
};

export type AccrualMethod = "lump_sum" | "monthly";

/**
 * One overtime tier: rate for the Nth hour of overtime (array index 0 = 1st hour past the daily
 * target, index 1 = 2nd hour, etc). Up to 5 tiers; overtime beyond the configured tiers keeps
 * paying at the last tier's rate.
 */
export interface OvertimeTier {
  rateType: "percent" | "fixed";
  rateValue: number;
}

export interface PayLineItem {
  label: string;
  amount: number;
}

export interface UserSettings {
  work_days: Record<string, boolean>;
  hours_per_day: Record<string, number>;
  hourly_rate: number;
  /**
   * "hourly" (default) = hourly_rate is used as-is. "cap" = a fixed monthly salary ceiling;
   * regular hours can never earn more than salary_cap_amount in a given month — the effective
   * hourly rate for that month is derived (salary_cap_amount ÷ that month's total scheduled
   * regular hours) so a fully-worked schedule lands exactly on the cap. Overtime is paid on top,
   * uncapped, same as always. See computeEffectiveHourlyRateForMonth.
   */
  salary_mode?: "hourly" | "cap";
  salary_cap_amount?: number;
  evening_shift_enabled?: boolean;
  evening_shift_hours?: number;
  overtime_calc_enabled?: boolean;
  /** Up to 5 tiers, applied in order (by hour number) to hours worked beyond the daily target. */
  overtime_tiers?: OvertimeTier[];
  /**
   * true = overtime premium only counts once a full hour past the daily target is completed
   * (the leftover fraction is paid at the regular rate). false (default) = the premium accrues
   * proportionally from the first minute past the target.
   */
  overtime_round_hours?: boolean;
  /**
   * "current" (default) = overtime pay counts in the payslip for the month it was actually
   * worked. "next" = some workplaces settle overtime a month behind — hours worked in August
   * appear on September's payslip — so that month's payroll excludes its own overtime and
   * includes the PREVIOUS month's instead.
   */
  overtime_payout_month?: "current" | "next";
  /** Fixed monthly additions (e.g. travel allowance) added to every month's payroll report. */
  fixed_components?: PayLineItem[];
  /**
   * true (default) = the "ברוטו" figure shown includes fixed_components/food allowance, matching
   * how it was always shown. false = "ברוטו" is base pay only (regular + overtime, whatever the
   * cap or hourly rate produces) with fixed_components/food shown as separate additions on top —
   * for anyone whose real payslip reports gross that way instead.
   */
  fixed_components_in_gross?: boolean;
  /** Fixed monthly deductions (e.g. pension) subtracted from every month's payroll report. */
  deductions?: PayLineItem[];
  /** Total vacation/sick days granted per calendar year. */
  annual_vacation_days?: number;
  annual_sick_days?: number;
  /** Whether the year's quota is all available on Jan 1, or accrues 1/12 per completed month. */
  vacation_accrual_method?: AccrualMethod;
  sick_accrual_method?: AccrualMethod;
  /** ISO date (yyyy-MM-dd). Used to prorate the first calendar year if employment started after Jan 1. */
  employment_start_date?: string | null;
  /**
   * Workplace-mandated minimum vacation days that must be used within a calendar year (0/undefined
   * = no minimum). Prorated for a mid-year employment start, same as a lump-sum accrual.
   */
  min_vacation_days_required?: number;
  /**
   * How many days a vacation/sick balance may go negative before the app blocks further paid
   * requests and forces "unpaid" instead. undefined = not configured yet (the quick-mark flow asks
   * for this the first time a request would exceed a 0/positive balance).
   */
  vacation_negative_limit?: number;
  sick_negative_limit?: number;

  // ---- Statutory payroll (Israeli income tax / National Insurance / Health Insurance / pension / Keren Hishtalmut) ----
  /** "manual" (default) keeps today's behavior — the 3 mandatory deductions below are exactly what's entered.
   * "automatic" computes them from the official bracket tables in src/lib/payrollTax.ts instead. */
  statutory_deduction_mode?: "automatic" | "manual";
  tax_credit_points?: number;
  manual_income_tax?: number;
  manual_national_insurance?: number;
  manual_health_insurance?: number;
  /** Pension and Keren Hishtalmut are never mandatory — each has its own on/off switch regardless of statutory_deduction_mode. */
  pension_enabled?: boolean;
  pension_employee_rate?: number; // percent, e.g. 6 = 6%
  pension_base_mode?: "full" | "custom";
  pension_custom_base?: number;
  training_fund_enabled?: boolean;
  training_fund_employee_rate?: number; // percent, e.g. 2.5 = 2.5%
  training_fund_base_mode?: "full" | "custom";
  training_fund_custom_base?: number;

  // ---- Food card / meal-budget tracking (see src/lib/foodCard.ts) ----
  food_card_enabled?: boolean;
  /** true = a real employer-issued card; false = voluntary tracking with no physical card. */
  food_card_has_card?: boolean;
  /** Refills to this amount at the start of every calendar month. */
  food_card_monthly_amount?: number;
  /** Per-day spending ceiling some employers impose. 0/undefined = no daily cap. */
  food_card_daily_cap?: number;
}

/** One food/meal expense logged against the monthly food-card budget. */
export interface FoodEntry {
  id: string;
  date: string; // yyyy-MM-dd
  time?: string; // HH:mm
  /** Amount actually charged against the tracked budget — capped at the daily ceiling when one is configured. */
  cardAmount: number;
  /** Extra amount the employee paid personally when a purchase exceeded the daily cap. */
  personalTopUp?: number;
  note?: string;
}

/** A month-end payslip PDF, auto-archived so the gross salary stays on record even though the
 * live in-app view only ever shows a forecast. Only the 3 most recent months are kept. */
export interface PdfArchiveEntry {
  year: number;
  month: number; // 0-indexed
  generatedAt: string; // ISO timestamp
  dataUrl: string; // jsPDF's own "datauristring" output
}

/** One reason chip for a payroll deviation — "less" reasons only ever offered when the actual
 * net was lower than estimated, "more" only when it was higher. */
export interface PayrollDeviationReason {
  id: string;
  label: string;
  direction: "less" | "more";
}

export const PAYROLL_DEVIATION_REASONS: PayrollDeviationReason[] = [
  { id: "higher_tax", label: "ניכוי מס גבוה יותר ממה שהוזן", direction: "less" },
  { id: "advance_or_loan", label: "מקדמה או הלוואה שקוזזה", direction: "less" },
  { id: "unreported_absence", label: "ימי היעדרות שלא דווחו במערכת", direction: "less" },
  { id: "penalty_or_delay", label: "קנס או עיכוב תשלום", direction: "less" },
  { id: "missing_deduction", label: "ניכוי אחר שלא הוגדר בהגדרות", direction: "less" },
  { id: "less_other", label: "משהו אחר", direction: "less" },
  { id: "bonus", label: "בונוס או מענק", direction: "more" },
  { id: "expense_reimbursement", label: "החזר הוצאות", direction: "more" },
  { id: "retroactive_fix", label: "תיקון רטרואקטיבי מחודש קודם", direction: "more" },
  { id: "missing_addition", label: "תוספת אחרת שלא הוגדרה בהגדרות", direction: "more" },
  { id: "more_other", label: "משהו אחר", direction: "more" },
];

/**
 * One month's reconciliation between the app's own computed net pay and what the user actually
 * received — logged locally only (not synced to Supabase yet) so future months can eventually
 * learn from the pattern. `aiAnalysis` holds the AI assistant's free-text read on `note`.
 */
/** Settings fields the AI deviation analysis is allowed to point at and propose a corrected
 * value for — deliberately narrow (only numeric statutory-deduction inputs) so a misread of the
 * user's free text can never silently touch anything else. */
export const CORRECTABLE_PAYROLL_FIELDS: { id: keyof UserSettings; label: string; kind: "amount" | "rate" | "points" }[] = [
  { id: "manual_income_tax", label: "מס הכנסה", kind: "amount" },
  { id: "manual_national_insurance", label: "ביטוח לאומי", kind: "amount" },
  { id: "manual_health_insurance", label: "ביטוח בריאות", kind: "amount" },
  { id: "pension_employee_rate", label: "אחוז פנסיה", kind: "rate" },
  { id: "training_fund_employee_rate", label: "אחוז קרן השתלמות", kind: "rate" },
  { id: "tax_credit_points", label: "נקודות זיכוי", kind: "points" },
];

export interface PayrollActual {
  year: number;
  month: number; // 0-indexed
  actualNet: number;
  estimatedNet: number;
  reasonId?: string;
  note?: string;
  aiAnalysis?: string;
  /** A field from CORRECTABLE_PAYROLL_FIELDS the AI (or the user directly) pinned the deviation
   * to, with the value that would have made this month's estimate match what was actually
   * received — applied either to just this month (via computeMonthlyPayrollWithOverride) or to
   * settings permanently, per the user's choice. */
  overrideField?: string;
  overrideValue?: number;
  updatedAt: string; // ISO timestamp
}

interface LocalDataShape {
  settings: UserSettings;
  workHours: WorkHour[];
  foodEntries: FoodEntry[];
  pdfArchive: PdfArchiveEntry[];
  payrollActuals: PayrollActual[];
  profile: {
    firstName: string;
  };
}

type LocalUsersData = Record<string, LocalDataShape>;

export interface LocalBackupFile {
  version: 1;
  exported_at: string;
  user_settings: UserSettings;
  work_hours: WorkHour[];
}

const STORAGE_KEY = "worktrack_local_data_by_user_v1";
const LEGACY_STORAGE_KEY = "worktrack_local_data_v1";

const defaultSettings: UserSettings = {
  work_days: {
    monday: true,
    tuesday: true,
    wednesday: true,
    thursday: true,
    friday: true,
    saturday: false,
    sunday: false,
  },
  hours_per_day: {
    monday: 8,
    tuesday: 8,
    wednesday: 8,
    thursday: 8,
    friday: 8,
    saturday: 0,
    sunday: 0,
  },
  hourly_rate: 0,
  salary_mode: "hourly",
  salary_cap_amount: 0,
  evening_shift_enabled: false,
  evening_shift_hours: 7,
  overtime_calc_enabled: true,
  overtime_tiers: [
    { rateType: "percent", rateValue: 125 },
    { rateType: "percent", rateValue: 150 },
  ],
  overtime_round_hours: false,
  overtime_payout_month: "current",
  fixed_components: [],
  fixed_components_in_gross: true,
  deductions: [],
  annual_vacation_days: 12,
  annual_sick_days: 18,
  vacation_accrual_method: "monthly",
  sick_accrual_method: "monthly",
  employment_start_date: null,
  min_vacation_days_required: 10,
  statutory_deduction_mode: "manual",
  tax_credit_points: 2.25,
  manual_income_tax: 0,
  manual_national_insurance: 0,
  manual_health_insurance: 0,
  pension_enabled: false,
  pension_employee_rate: 6,
  pension_base_mode: "full",
  pension_custom_base: 0,
  training_fund_enabled: false,
  training_fund_employee_rate: 2.5,
  training_fund_base_mode: "full",
  training_fund_custom_base: 0,
  food_card_enabled: false,
  food_card_has_card: true,
  food_card_monthly_amount: 0,
  food_card_daily_cap: 0,
};

const defaultData: LocalDataShape = {
  settings: defaultSettings,
  workHours: [],
  foodEntries: [],
  pdfArchive: [],
  payrollActuals: [],
  profile: {
    firstName: "WorkTrack",
  },
};

const normalizeEmail = (email: string) => email.toLowerCase().trim();

const safeParseUserData = (raw: string | null): LocalDataShape => {
  if (!raw) return defaultData;
  try {
    const parsed = JSON.parse(raw) as Partial<LocalDataShape>;
    return {
      settings: {
        work_days: parsed.settings?.work_days ?? defaultSettings.work_days,
        hours_per_day: parsed.settings?.hours_per_day ?? defaultSettings.hours_per_day,
        hourly_rate:
          typeof parsed.settings?.hourly_rate === "number"
            ? parsed.settings.hourly_rate
            : defaultSettings.hourly_rate,
        salary_mode: parsed.settings?.salary_mode ?? defaultSettings.salary_mode,
        salary_cap_amount:
          typeof parsed.settings?.salary_cap_amount === "number" ? parsed.settings.salary_cap_amount : defaultSettings.salary_cap_amount,
        evening_shift_enabled: parsed.settings?.evening_shift_enabled ?? defaultSettings.evening_shift_enabled,
        evening_shift_hours:
          typeof parsed.settings?.evening_shift_hours === "number"
            ? parsed.settings.evening_shift_hours
            : defaultSettings.evening_shift_hours,
        overtime_calc_enabled: parsed.settings?.overtime_calc_enabled ?? defaultSettings.overtime_calc_enabled,
        overtime_tiers: Array.isArray(parsed.settings?.overtime_tiers) ? parsed.settings.overtime_tiers : defaultSettings.overtime_tiers,
        overtime_round_hours: parsed.settings?.overtime_round_hours ?? defaultSettings.overtime_round_hours,
        overtime_payout_month: parsed.settings?.overtime_payout_month ?? defaultSettings.overtime_payout_month,
        fixed_components: Array.isArray(parsed.settings?.fixed_components) ? parsed.settings.fixed_components : defaultSettings.fixed_components,
        fixed_components_in_gross: parsed.settings?.fixed_components_in_gross ?? defaultSettings.fixed_components_in_gross,
        deductions: Array.isArray(parsed.settings?.deductions) ? parsed.settings.deductions : defaultSettings.deductions,
        annual_vacation_days:
          typeof parsed.settings?.annual_vacation_days === "number"
            ? parsed.settings.annual_vacation_days
            : defaultSettings.annual_vacation_days,
        annual_sick_days:
          typeof parsed.settings?.annual_sick_days === "number"
            ? parsed.settings.annual_sick_days
            : defaultSettings.annual_sick_days,
        vacation_accrual_method: parsed.settings?.vacation_accrual_method ?? defaultSettings.vacation_accrual_method,
        sick_accrual_method: parsed.settings?.sick_accrual_method ?? defaultSettings.sick_accrual_method,
        employment_start_date: parsed.settings?.employment_start_date ?? defaultSettings.employment_start_date,
        min_vacation_days_required:
          typeof parsed.settings?.min_vacation_days_required === "number"
            ? parsed.settings.min_vacation_days_required
            : defaultSettings.min_vacation_days_required,
        statutory_deduction_mode: parsed.settings?.statutory_deduction_mode ?? defaultSettings.statutory_deduction_mode,
        tax_credit_points:
          typeof parsed.settings?.tax_credit_points === "number" ? parsed.settings.tax_credit_points : defaultSettings.tax_credit_points,
        manual_income_tax:
          typeof parsed.settings?.manual_income_tax === "number" ? parsed.settings.manual_income_tax : defaultSettings.manual_income_tax,
        manual_national_insurance:
          typeof parsed.settings?.manual_national_insurance === "number"
            ? parsed.settings.manual_national_insurance
            : defaultSettings.manual_national_insurance,
        manual_health_insurance:
          typeof parsed.settings?.manual_health_insurance === "number"
            ? parsed.settings.manual_health_insurance
            : defaultSettings.manual_health_insurance,
        pension_enabled: parsed.settings?.pension_enabled ?? defaultSettings.pension_enabled,
        pension_employee_rate:
          typeof parsed.settings?.pension_employee_rate === "number"
            ? parsed.settings.pension_employee_rate
            : defaultSettings.pension_employee_rate,
        pension_base_mode: parsed.settings?.pension_base_mode ?? defaultSettings.pension_base_mode,
        pension_custom_base:
          typeof parsed.settings?.pension_custom_base === "number" ? parsed.settings.pension_custom_base : defaultSettings.pension_custom_base,
        training_fund_enabled: parsed.settings?.training_fund_enabled ?? defaultSettings.training_fund_enabled,
        training_fund_employee_rate:
          typeof parsed.settings?.training_fund_employee_rate === "number"
            ? parsed.settings.training_fund_employee_rate
            : defaultSettings.training_fund_employee_rate,
        training_fund_base_mode: parsed.settings?.training_fund_base_mode ?? defaultSettings.training_fund_base_mode,
        training_fund_custom_base:
          typeof parsed.settings?.training_fund_custom_base === "number"
            ? parsed.settings.training_fund_custom_base
            : defaultSettings.training_fund_custom_base,
        food_card_enabled: parsed.settings?.food_card_enabled ?? defaultSettings.food_card_enabled,
        food_card_has_card: parsed.settings?.food_card_has_card ?? defaultSettings.food_card_has_card,
        food_card_monthly_amount:
          typeof parsed.settings?.food_card_monthly_amount === "number"
            ? parsed.settings.food_card_monthly_amount
            : defaultSettings.food_card_monthly_amount,
        food_card_daily_cap:
          typeof parsed.settings?.food_card_daily_cap === "number" ? parsed.settings.food_card_daily_cap : defaultSettings.food_card_daily_cap,
      },
      workHours: Array.isArray(parsed.workHours) ? parsed.workHours : [],
      foodEntries: Array.isArray(parsed.foodEntries) ? parsed.foodEntries : [],
      pdfArchive: Array.isArray(parsed.pdfArchive) ? parsed.pdfArchive : [],
      payrollActuals: Array.isArray(parsed.payrollActuals) ? parsed.payrollActuals : [],
      profile: {
        firstName: parsed.profile?.firstName || "WorkTrack",
      },
    };
  } catch {
    return defaultData;
  }
};

const safeParseUsers = (raw: string | null): LocalUsersData => {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, Partial<LocalDataShape>>;
    const entries = Object.entries(parsed).map(([email, value]) => [normalizeEmail(email), safeParseUserData(JSON.stringify(value))]);
    return Object.fromEntries(entries);
  } catch {
    return {};
  }
};

const writeUsersData = (data: LocalUsersData) => {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
};

const readUsersData = (): LocalUsersData => {
  if (typeof window === "undefined") return {};
  const users = safeParseUsers(localStorage.getItem(STORAGE_KEY));
  const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
  const currentEmail = getCurrentUserEmail();
  if (legacy && currentEmail) {
    const normalized = normalizeEmail(currentEmail);
    const currentBucket = users[normalized];
    const currentHasHours = (currentBucket?.workHours?.length ?? 0) > 0;
    if (!currentHasHours) {
      users[normalized] = safeParseUserData(legacy);
    }
    writeUsersData(users);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  }
  return users;
};

const readData = (): LocalDataShape => {
  const currentEmail = getCurrentUserEmail();
  if (!currentEmail) return defaultData;
  const users = readUsersData();
  const normalized = normalizeEmail(currentEmail);
  if (users[normalized]) return users[normalized];

  // Recovery fallback: clone the richest existing bucket so old data remains visible.
  const buckets = Object.values(users);
  const dataBuckets = buckets.filter((bucket) => (bucket.workHours?.length ?? 0) > 0);
  if (dataBuckets.length > 0) {
    const bestBucket = dataBuckets.sort(
      (a, b) => (b.workHours?.length ?? 0) - (a.workHours?.length ?? 0),
    )[0];
    users[normalized] = bestBucket;
    writeUsersData(users);
    return users[normalized];
  }

  return defaultData;
};

const writeData = (data: LocalDataShape) => {
  const currentEmail = getCurrentUserEmail();
  if (!currentEmail) return;
  const users = readUsersData();
  users[normalizeEmail(currentEmail)] = data;
  writeUsersData(users);
};

export const getSettings = (): UserSettings => readData().settings;

export const saveSettings = (settings: UserSettings) => {
  const data = readData();
  writeData({ ...data, settings });
  void pushSettings(settings, data.profile.firstName);
};

const FOOD_LABEL_KEYWORDS = ["אוכל", "ארוח", "מזון", "food", "meal", "כרטיס אוכל"];
/** True if a manual addition/deduction label looks food-related — used to keep the food-tracking
 * feature as the single source of truth once it's turned on, instead of double-counting. */
export const isFoodRelatedLabel = (label: string): boolean => {
  const normalized = label.toLowerCase();
  return FOOD_LABEL_KEYWORDS.some((kw) => normalized.includes(kw.toLowerCase()));
};

/**
 * Turns food-card tracking on (or reconfigures it) and — since the dedicated food system is now
 * the single source of truth — strips any food-related manual "addition" line the user may have
 * created before this feature existed, so the same money isn't counted twice.
 */
export const enableFoodTracking = (hasCard: boolean, monthlyAmount: number, dailyCap: number): UserSettings => {
  const data = readData();
  const settings: UserSettings = {
    ...data.settings,
    food_card_enabled: true,
    food_card_has_card: hasCard,
    food_card_monthly_amount: monthlyAmount,
    food_card_daily_cap: dailyCap,
    fixed_components: (data.settings.fixed_components || []).filter((c) => !isFoodRelatedLabel(c.label)),
  };
  writeData({ ...data, settings });
  void pushSettings(settings, data.profile.firstName);
  return settings;
};

export const getProfileFirstName = (): string => readData().profile.firstName || "WorkTrack";

export const setProfileFirstName = (firstName: string) => {
  const data = readData();
  const trimmed = firstName?.trim() || "WorkTrack";
  writeData({
    ...data,
    profile: {
      firstName: trimmed,
    },
  });
  void pushSettings(data.settings, trimmed);
};

export const getWorkHoursForMonth = (year: number, month: number): WorkHour[] => {
  const data = readData();
  const startDate = localDateKey(year, month, 1);
  const endDate = localDateKey(year, month, new Date(year, month + 1, 0).getDate());
  return data.workHours
    .filter((w) => w.date >= startDate && w.date <= endDate)
    .sort((a, b) => a.date.localeCompare(b.date));
};

export const getWorkHoursForYear = (year: number): WorkHour[] => {
  const data = readData();
  const startDate = `${year}-01-01`;
  const endDate = `${year}-12-31`;
  return data.workHours
    .filter((w) => w.date >= startDate && w.date <= endDate)
    .sort((a, b) => a.date.localeCompare(b.date));
};

const WEEKDAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

/** Scheduled target hours for the weekday a given yyyy-MM-dd date string falls on. */
export const getDailyTargetHoursForDate = (dateStr: string, settings: UserSettings): number => {
  const date = new Date(`${dateStr}T00:00:00`);
  const weekday = WEEKDAY_KEYS[date.getDay()];
  // A day not scheduled as a work day has a 0 target — any hours worked on it are entirely
  // overtime (e.g. a one-time shift on a normally-off day), regardless of hours_per_day's value.
  if (!settings.work_days[weekday]) return 0;
  return settings.hours_per_day[weekday] || 0;
};

/**
 * The effective hourly rate to use for a given month. In "hourly" mode this is just hourly_rate.
 * In "cap" mode, the monthly salary_cap_amount is divided by that month's total scheduled regular
 * hours (per work_days/hours_per_day) — so working exactly the schedule earns exactly the cap, and
 * any hours beyond the daily target still count as overtime (paid extra, uncapped) as usual.
 */
export const computeEffectiveHourlyRateForMonth = (year: number, month: number, settings: UserSettings): number => {
  if (settings.salary_mode !== "cap") return settings.hourly_rate || 0;
  const cap = settings.salary_cap_amount || 0;
  if (cap <= 0) return 0;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  let totalScheduledHours = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    totalScheduledHours += getDailyTargetHoursForDate(dateStr, settings);
  }
  if (totalScheduledHours <= 0) return 0;
  return cap / totalScheduledHours;
};

/** Like getDailyTargetHoursForDate, but returns the evening-shift target when that specific entry is marked evening. */
export const getEffectiveDailyTarget = (dateStr: string, entry: WorkHour | undefined, settings: UserSettings): number => {
  if (entry?.evening && settings.evening_shift_enabled) {
    return settings.evening_shift_hours || 0;
  }
  return getDailyTargetHoursForDate(dateStr, settings);
};

/**
 * The hours a day actually counts for. Single source of truth used by every display and by
 * payroll, so a stale stored `hours_worked` can never leak through.
 *
 * A "worked" day that has a clock-in but no clock-out is still in progress and counts as 0 —
 * its final duration isn't known until the shift is closed. (A worked day with neither time is
 * treated as a manual entry and keeps its stored value.)
 */
/** Hours between two "HH:MM" strings, never negative. */
export const calcHoursBetween = (start: string | null | undefined, end: string | null | undefined): number => {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return Math.max(0, (eh * 60 + em - (sh * 60 + sm)) / 60);
};

export const getCountedHours = (entry: WorkHour | undefined): number => {
  if (!entry) return 0;
  const status = entry.status || "worked";
  if (status === "worked" && entry.start_time && !entry.end_time) {
    // Currently mid-shift: count whatever earlier segments already completed today, but not the
    // segment still running (matches the existing "in-progress counts as 0 more" behavior).
    if (entry.segments && entry.segments.length > 1) {
      return entry.segments.slice(0, -1).reduce((sum, seg) => sum + calcHoursBetween(seg.start, seg.end), 0);
    }
    return 0;
  }
  return Number(entry.hours_worked || 0);
};

/**
 * Fractional days of vacation/sick used within a calendar year, from:
 *  - status entries of that type (weighted by their fraction: full/3-4/half), regardless of paid/unpaid, and
 *  - "worked" days whose shortfall was explicitly marked as covered by that leave type.
 *
 * A day scheduled in a month that hasn't started yet (e.g. it's August and vacation is booked
 * for October) is NOT deducted from the balance yet — it only counts once that month begins,
 * matching a real payslip which only reflects the current and past months.
 */
export const computeLeaveUsage = (year: number, type: "vacation" | "sick", settings: UserSettings, asOfDate: Date = new Date()): number => {
  const entries = getWorkHoursForYear(year);
  const asOfYearMonth = asOfDate.getFullYear() * 12 + asOfDate.getMonth();
  let used = 0;
  for (const w of entries) {
    const entryDate = new Date(`${w.date}T00:00:00`);
    if (entryDate.getFullYear() * 12 + entryDate.getMonth() > asOfYearMonth) continue;
    if (w.status === type) {
      used += fractionMultiplier(w.fraction);
    } else if (type === "vacation" && w.status === "holiday" && w.remainderPaid !== false) {
      used += 1 - fractionMultiplier(w.fraction);
    } else if ((w.status === "worked" || !w.status) && w.deficitCoveredBy === type) {
      const target = getEffectiveDailyTarget(w.date, w, settings);
      if (target > 0) {
        const shortfall = Math.max(0, target - getCountedHours(w));
        used += Math.min(1, shortfall / target);
      }
    }
  }
  return used;
};

/**
 * Days accrued so far this calendar year, prorated for a mid-year employment start and
 * (for monthly accrual) prorated for the current date within the year.
 */
export const computeAccruedDays = (
  annualDays: number,
  method: AccrualMethod | undefined,
  employmentStartDate: string | null | undefined,
  year: number,
  asOfDate: Date = new Date(),
): number => {
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year, 11, 31);
  const effectiveStart = employmentStartDate ? new Date(`${employmentStartDate}T00:00:00`) : yearStart;
  const start = effectiveStart > yearStart ? effectiveStart : yearStart;
  if (start > yearEnd) return 0;

  const monthsInYear = 12;
  // Whole months remaining in the year from `start` (used to prorate a mid-year start).
  const startMonthsRemaining = monthsInYear - start.getMonth() - (start.getDate() > 1 ? 1 : 0);
  const proratedAnnual = employmentStartDate && start.getFullYear() === year
    ? annualDays * (Math.max(0, startMonthsRemaining) / monthsInYear)
    : annualDays;

  if (method === "monthly") {
    const cappedAsOf = asOfDate > yearEnd ? yearEnd : asOfDate;
    if (cappedAsOf < start) return 0;
    // The current in-progress month is credited immediately, same as a real payslip.
    const monthsElapsed = Math.min(
      monthsInYear,
      Math.max(0, (cappedAsOf.getFullYear() - start.getFullYear()) * 12 + (cappedAsOf.getMonth() - start.getMonth()) + 1),
    );
    const perMonth = annualDays / monthsInYear;
    return +(perMonth * monthsElapsed).toFixed(3);
  }

  // Lump sum: the full (possibly prorated) annual amount is available from the start date.
  return +proratedAnnual.toFixed(3);
};

/**
 * Running leave balance since employment started — does NOT reset every Jan 1. Each calendar
 * year still accrues its own quota (prorated for a mid-year start, monthly or lump-sum per that
 * year's method), but unused days simply carry into the next year and keep piling up.
 */
export const computeCumulativeAccrued = (
  annualDays: number,
  method: AccrualMethod | undefined,
  employmentStartDate: string | null | undefined,
  asOfDate: Date = new Date(),
): number => {
  if (!annualDays) return 0;
  const start = employmentStartDate ? new Date(`${employmentStartDate}T00:00:00`) : new Date(asOfDate.getFullYear(), 0, 1);
  if (asOfDate < start) return 0;

  if (method === "monthly") {
    // One continuous timeline (not decomposed per calendar year) so a month that straddles a
    // Dec→Jan boundary is still credited correctly. The current in-progress month is credited
    // immediately (matches a real payslip, which shows the current month's accrual right away).
    const monthsElapsed = Math.max(0, (asOfDate.getFullYear() - start.getFullYear()) * 12 + (asOfDate.getMonth() - start.getMonth()) + 1);
    return +((annualDays / 12) * monthsElapsed).toFixed(3);
  }

  // Lump sum: each calendar year re-grants its (possibly prorated) full quota immediately at
  // the start of that year, so this part still walks year by year.
  let total = 0;
  for (let y = start.getFullYear(); y <= asOfDate.getFullYear(); y++) {
    const yearEnd = new Date(y, 11, 31, 23, 59, 59, 999);
    const capped = y === asOfDate.getFullYear() ? asOfDate : yearEnd;
    total += computeAccruedDays(annualDays, "lump_sum", employmentStartDate, y, capped);
  }
  return +total.toFixed(3);
};

/**
 * A one-line congratulatory message when today is exactly a work-anniversary milestone (1/3/6
 * months, then every full year), or null on any other day. Uses calendar-accurate month/year
 * arithmetic (not a fixed day count) so a start date late in a month still lands on the right day.
 */
export const getMilestoneMessageForToday = (settings: UserSettings, today: Date = new Date()): string | null => {
  if (!settings.employment_start_date) return null;
  const start = new Date(`${settings.employment_start_date}T00:00:00`);
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  const monthMessages: Record<number, string> = {
    1: "איזה כיף — עברת חודש שלם בעבודה הזו! תמשיך ככה 💪",
    3: "3 חודשים כבר מאחוריך. את/ה ממש מתבסס/ת כאן! 🎉",
    6: "חצי שנה של עבודה — ההתמדה שלך מרשימה. יאללה קדימה! ✨",
  };
  for (const months of Object.keys(monthMessages).map(Number)) {
    const anniv = new Date(start.getFullYear(), start.getMonth() + months, start.getDate());
    if (sameDay(anniv, t)) return monthMessages[months];
  }

  const years = t.getFullYear() - start.getFullYear();
  if (years >= 1) {
    const anniv = new Date(start.getFullYear() + years, start.getMonth(), start.getDate());
    if (sameDay(anniv, t)) {
      return years === 1
        ? "שנה שלמה! כל הכבוד על ההתמדה — הישג יפה 🏆"
        : `${years} שנים באותו מקום! אתה ממשיך להתמיד ולהצליח 🌟`;
    }
  }
  return null;
};

/** Total vacation/sick days used since employment started, summed across every calendar year (no annual reset). */
export const computeCumulativeLeaveUsage = (
  type: "vacation" | "sick",
  settings: UserSettings,
  asOfDate: Date = new Date(),
): number => {
  const startYear = settings.employment_start_date ? new Date(`${settings.employment_start_date}T00:00:00`).getFullYear() : asOfDate.getFullYear();
  let total = 0;
  for (let y = startYear; y <= asOfDate.getFullYear(); y++) {
    total += computeLeaveUsage(y, "vacation" === type ? "vacation" : "sick", settings);
  }
  return +total.toFixed(3);
};

export interface VacationMinimumStatus {
  required: number;
  usedThisYear: number;
  remaining: number;
  met: boolean;
}

/**
 * Status against the workplace's mandatory minimum vacation days used per calendar year
 * (`settings.min_vacation_days_required`), prorated for a mid-year employment start just like
 * a lump-sum accrual. Returns null when no minimum is configured.
 */
export const computeVacationMinimumStatus = (settings: UserSettings, asOfDate: Date = new Date()): VacationMinimumStatus | null => {
  const min = settings.min_vacation_days_required || 0;
  if (min <= 0) return null;
  const year = asOfDate.getFullYear();
  const required = computeAccruedDays(min, "lump_sum", settings.employment_start_date, year);
  const usedThisYear = computeLeaveUsage(year, "vacation", settings);
  const remaining = Math.max(0, required - usedThisYear);
  return {
    required: +required.toFixed(2),
    usedThisYear: +usedThisYear.toFixed(2),
    remaining: +remaining.toFixed(2),
    met: usedThisYear >= required,
  };
};

const tierHourlyRate = (tier: OvertimeTier | undefined, baseRate: number): number => {
  if (!tier) return baseRate;
  return tier.rateType === "percent" ? baseRate * (tier.rateValue / 100) : tier.rateValue;
};

/**
 * Splits `overtimeHours` into 1-hour brackets, pricing the Nth bracket with `tiers[N]` (the last
 * configured tier keeps applying to every bracket beyond it). Called with a whole number of hours
 * when `overtime_round_hours` is on, or a fractional amount when the premium accrues from the
 * first minute past the target.
 */
const computeOvertimePay = (overtimeHours: number, baseRate: number, tiers: OvertimeTier[] | undefined): number => {
  if (overtimeHours <= 0) return 0;
  let remaining = overtimeHours;
  let pay = 0;
  let i = 0;
  while (remaining > 1e-9) {
    const portion = Math.min(remaining, 1);
    const tier = tiers && tiers.length ? tiers[Math.min(i, tiers.length - 1)] : undefined;
    pay += portion * tierHourlyRate(tier, baseRate);
    remaining -= portion;
    i += 1;
  }
  return pay;
};

export interface DayPayBreakdown {
  date: string;
  regularHours: number;
  overtimeHours: number;
  regularPay: number;
  overtimePay: number;
}

export interface MonthlyPayroll {
  regularHours: number;
  /** What actually counts toward THIS month's pay — equal to ownOvertimeHours unless
   * overtime_payout_month is "next", in which case this is last month's overtime instead. */
  overtimeHours: number;
  regularPay: number;
  overtimePay: number;
  /** What was actually worked as overtime THIS calendar month, regardless of which month's
   * payslip it's paid on — always accurate for "hours accrued this month" indicators. */
  ownOvertimeHours: number;
  ownOvertimePay: number;
  fixedComponentsTotal: number;
  deductionsTotal: number;
  netPay: number;
  daysWorked: number;
  /** Unpaid vacation/sick days this month (fractional). */
  unpaidLeaveDays: number;
  /** Unpaid "לא עובד" days this month (fractional) — not counted against vacation/sick balances. */
  unpaidOffDays: number;
  /** Paid "חג" days this month (fractional) — paid in full, not counted against vacation/sick balances. */
  holidayDays: number;
  perDay: DayPayBreakdown[];
  /** Statutory deductions (income tax, National Insurance, Health Insurance, pension, Keren Hishtalmut) — see src/lib/payrollTax.ts. */
  statutory: StatutoryPayrollResult;
  /**
   * Food allowance baked into salary (only when food_card_enabled && !food_card_has_card): the
   * monthly allowance is added to gross, and every reported meal expense this month is deducted —
   * mirroring the "remaining balance" the card path shows, but flowing through real payroll too.
   * Both are 0 whenever the user has a physical card (fully external) or food mode is off.
   */
  foodAllowanceAddition: number;
  foodExpenseDeduction: number;
}

/**
 * Full monthly payroll estimate: regular + overtime pay (split across the configured tiers),
 * plus fixed components, minus deductions. Unpaid leave/off days simply earn nothing for their
 * hours — which is itself the "cut" a hourly-rate employee would see. Holidays are always paid
 * in full and never touch the vacation/sick balances.
 */
interface RawMonthPay {
  regularHours: number;
  overtimeHours: number;
  regularPay: number;
  overtimePay: number;
  daysWorked: number;
  unpaidLeaveDays: number;
  unpaidOffDays: number;
  holidayDays: number;
  perDay: DayPayBreakdown[];
}

/** The actual per-day work/leave accounting for one month, with no knowledge of the
 * overtime-payout-month setting — computeMonthlyPayroll below decides which month's overtime
 * pay actually counts. */
const computeRawMonthPay = (year: number, month: number, settings: UserSettings, entriesOverride?: WorkHour[]): RawMonthPay => {
  const entries = entriesOverride ?? getWorkHoursForMonth(year, month);
  const baseRate = computeEffectiveHourlyRateForMonth(year, month, settings);
  const useOvertime = settings.overtime_calc_enabled !== false;

  let regularHours = 0;
  let overtimeHours = 0;
  let regularPay = 0;
  let overtimePay = 0;
  let daysWorked = 0;
  let unpaidLeaveDays = 0;
  let unpaidOffDays = 0;
  let holidayDays = 0;
  const perDay: DayPayBreakdown[] = [];

  for (const w of entries) {
    const isOff = w.status === "sick" || w.status === "vacation" || w.status === "holiday" || w.status === "off";
    if (isOff) {
      if (w.paid === false) {
        if (w.status === "off") {
          unpaidOffDays += fractionMultiplier(w.fraction);
        } else {
          unpaidLeaveDays += fractionMultiplier(w.fraction);
        }
      } else {
        const hours = Number(w.hours_worked || 0);
        regularHours += hours;
        regularPay += hours * baseRate;
        if (w.status === "holiday") {
          holidayDays += fractionMultiplier(w.fraction);
          // A partial-day holiday's remainder is automatically a vacation-day request for the
          // rest of the day — paid (its hours are already folded into hours_worked/regularPay
          // above) and deducted from the vacation balance via computeLeaveUsage, or declined and
          // unpaid/excluded from salary here, same as any other unpaid leave day.
          if (w.remainderPaid === false) {
            unpaidLeaveDays += 1 - fractionMultiplier(w.fraction);
          }
        }
      }
      continue;
    }
    const worked = getCountedHours(w);
    if (worked <= 0) continue;
    const target = getEffectiveDailyTarget(w.date, w, settings);
    const rawOvertime = useOvertime ? Math.max(0, worked - target) : 0;
    // Round-hours mode: only whole completed hours past the target earn the premium — the
    // leftover fraction is paid at the regular rate instead of proportionally.
    const dayOvertime = useOvertime && settings.overtime_round_hours ? Math.floor(rawOvertime + 1e-9) : rawOvertime;
    const dayRegular = worked - dayOvertime;
    const dayRegularPay = dayRegular * baseRate;
    const dayOvertimePay = computeOvertimePay(dayOvertime, baseRate, settings.overtime_tiers);

    regularHours += dayRegular;
    overtimeHours += dayOvertime;
    regularPay += dayRegularPay;
    overtimePay += dayOvertimePay;
    daysWorked += 1;
    perDay.push({ date: w.date, regularHours: dayRegular, overtimeHours: dayOvertime, regularPay: dayRegularPay, overtimePay: dayOvertimePay });
  }

  return { regularHours, overtimeHours, regularPay, overtimePay, daysWorked, unpaidLeaveDays, unpaidOffDays, holidayDays, perDay };
};

export const computeMonthlyPayroll = (year: number, month: number, settings: UserSettings, entriesOverride?: WorkHour[]): MonthlyPayroll => {
  const raw = computeRawMonthPay(year, month, settings, entriesOverride);
  const { daysWorked, unpaidLeaveDays, unpaidOffDays, holidayDays, perDay, regularHours, regularPay } = raw;
  let { overtimeHours, overtimePay } = raw;

  // Some workplaces pay overtime worked in month N on the payslip for month N+1 instead of N's
  // own payslip — this month's own overtime moves out (it'll count next month instead), and last
  // month's overtime moves in. Regular hours/pay and the attendance figures above are unaffected.
  if (settings.overtime_payout_month === "next") {
    const prevMonthDate = new Date(year, month - 1, 1);
    const prevRaw = computeRawMonthPay(prevMonthDate.getFullYear(), prevMonthDate.getMonth(), settings);
    overtimeHours = prevRaw.overtimeHours;
    overtimePay = prevRaw.overtimePay;
  }

  const fixedComponentsTotal = (settings.fixed_components || []).reduce((s, c) => s + (c.amount || 0), 0);
  const deductionsTotal = (settings.deductions || []).reduce((s, d) => s + (d.amount || 0), 0);

  // Statutory deductions are recalculated from the FULL cumulative gross for the month so far —
  // never per-day — so crossing a tax/NI bracket mid-month only changes the marginal slice above it.
  const grossForTax = regularPay + overtimePay + fixedComponentsTotal;
  const statutory = calculateStatutoryPayroll(
    grossForTax,
    {
      taxCreditPoints: settings.tax_credit_points ?? 2.25,
      deductionMode: settings.statutory_deduction_mode ?? "manual",
      manualIncomeTax: settings.manual_income_tax,
      manualNationalInsurance: settings.manual_national_insurance,
      manualHealthInsurance: settings.manual_health_insurance,
      pensionEnabled: !!settings.pension_enabled,
      pensionEmployeeRate: (settings.pension_employee_rate ?? 6) / 100,
      pensionableBase: settings.pension_base_mode ?? "full",
      pensionableCustomAmount: settings.pension_custom_base,
      trainingFundEnabled: !!settings.training_fund_enabled,
      trainingFundEmployeeRate: (settings.training_fund_employee_rate ?? 2.5) / 100,
      trainingFundBase: settings.training_fund_base_mode ?? "full",
      trainingFundCustomAmount: settings.training_fund_custom_base,
    },
    year,
  );

  const foodBakedIntoSalary = !!settings.food_card_enabled && !settings.food_card_has_card;
  const foodAllowanceAddition = foodBakedIntoSalary ? settings.food_card_monthly_amount || 0 : 0;
  const foodExpenseDeduction = foodBakedIntoSalary
    ? getFoodEntriesForMonth(year, month).reduce((s, e) => s + (e.cardAmount || 0) + (e.personalTopUp || 0), 0)
    : 0;

  const netPay =
    regularPay +
    overtimePay +
    fixedComponentsTotal -
    deductionsTotal -
    statutory.totalStatutoryDeductions +
    foodAllowanceAddition -
    foodExpenseDeduction;

  return {
    regularHours,
    overtimeHours,
    regularPay,
    overtimePay,
    ownOvertimeHours: raw.overtimeHours,
    ownOvertimePay: raw.overtimePay,
    fixedComponentsTotal,
    deductionsTotal,
    netPay,
    daysWorked,
    unpaidLeaveDays,
    unpaidOffDays,
    holidayDays,
    perDay,
    statutory,
    foodAllowanceAddition,
    foodExpenseDeduction,
  };
};

/**
 * "שכר נטו נוכחי" — net pay as it actually stands right now, mid-month, instead of the full-month
 * forecast. Regular/overtime pay is already naturally "to date" (there's no data for days that
 * haven't happened yet). Flat monthly additions (fixed components, food allowance) and flat manual
 * deductions are prorated by how much of the month's scheduled work days have elapsed so far — a
 * ₪300 addition for the month becomes ₪300 × (scheduled work days so far / scheduled work days in
 * the month), rising day by day regardless of whether a given day was worked, vacation, or holiday
 * (it's a schedule-based proration, not a worked-days one — the addition is owed regardless).
 * Automatic statutory deductions already recompute correctly from the smaller to-date gross with no
 * extra work; manual ones are prorated the same way as the flat additions.
 */
export const computeCurrentMonthToDatePayroll = (year: number, month: number, settings: UserSettings): MonthlyPayroll => {
  const raw = computeRawMonthPay(year, month, settings);
  const { regularHours, overtimeHours, regularPay, overtimePay, daysWorked, unpaidLeaveDays, unpaidOffDays, holidayDays, perDay } = raw;

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
  const lastDay = isCurrentMonth ? today.getDate() : daysInMonth;
  let scheduledInMonth = 0;
  let scheduledSoFar = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const weekday = new Date(year, month, d).toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
    if (settings.work_days[weekday]) {
      scheduledInMonth += 1;
      if (d <= lastDay) scheduledSoFar += 1;
    }
  }
  const ratio = scheduledInMonth > 0 ? Math.min(1, scheduledSoFar / scheduledInMonth) : 0;

  const fixedComponentsTotal = (settings.fixed_components || []).reduce((s, c) => s + (c.amount || 0), 0) * ratio;
  const deductionsTotal = (settings.deductions || []).reduce((s, d) => s + (d.amount || 0), 0) * ratio;

  const grossForTax = regularPay + overtimePay + fixedComponentsTotal;
  const statutory = calculateStatutoryPayroll(
    grossForTax,
    {
      taxCreditPoints: settings.tax_credit_points ?? 2.25,
      deductionMode: settings.statutory_deduction_mode ?? "manual",
      manualIncomeTax: (settings.manual_income_tax ?? 0) * ratio,
      manualNationalInsurance: (settings.manual_national_insurance ?? 0) * ratio,
      manualHealthInsurance: (settings.manual_health_insurance ?? 0) * ratio,
      pensionEnabled: !!settings.pension_enabled,
      pensionEmployeeRate: (settings.pension_employee_rate ?? 6) / 100,
      pensionableBase: settings.pension_base_mode ?? "full",
      pensionableCustomAmount: settings.pension_custom_base,
      trainingFundEnabled: !!settings.training_fund_enabled,
      trainingFundEmployeeRate: (settings.training_fund_employee_rate ?? 2.5) / 100,
      trainingFundBase: settings.training_fund_base_mode ?? "full",
      trainingFundCustomAmount: settings.training_fund_custom_base,
    },
    year,
  );

  const foodBakedIntoSalary = !!settings.food_card_enabled && !settings.food_card_has_card;
  const foodAllowanceAddition = foodBakedIntoSalary ? (settings.food_card_monthly_amount || 0) * ratio : 0;
  const foodExpenseDeduction = foodBakedIntoSalary
    ? getFoodEntriesForMonth(year, month).reduce((s, e) => s + (e.cardAmount || 0) + (e.personalTopUp || 0), 0)
    : 0;

  const netPay = regularPay + overtimePay + fixedComponentsTotal - deductionsTotal - statutory.totalStatutoryDeductions + foodAllowanceAddition - foodExpenseDeduction;

  return {
    regularHours,
    overtimeHours,
    regularPay,
    overtimePay,
    ownOvertimeHours: raw.overtimeHours,
    ownOvertimePay: raw.overtimePay,
    fixedComponentsTotal,
    deductionsTotal,
    netPay,
    daysWorked,
    unpaidLeaveDays,
    unpaidOffDays,
    holidayDays,
    perDay,
    statutory,
    foodAllowanceAddition,
    foodExpenseDeduction,
  };
};

/**
 * computeMonthlyPayroll, but patched with a single CORRECTABLE_PAYROLL_FIELDS override for this
 * one month only — used to preview and apply a "fix just this month" choice from the payroll
 * reconciliation card without touching the user's real settings at all. `overrideField` outside
 * the allow-list is ignored (falls back to plain computeMonthlyPayroll) since it's never expected
 * to hold anything else, but a stray/legacy value must never silently patch an arbitrary field.
 */
export const computeMonthlyPayrollWithOverride = (
  year: number,
  month: number,
  settings: UserSettings,
  overrideField: string | undefined,
  overrideValue: number | undefined,
): MonthlyPayroll => {
  const isAllowed = overrideField && CORRECTABLE_PAYROLL_FIELDS.some((f) => f.id === overrideField);
  if (!isAllowed || overrideValue === undefined) return computeMonthlyPayroll(year, month, settings);
  const patched: UserSettings = { ...settings, [overrideField]: overrideValue };
  // The manual_* deduction fields only ever feed the calculation in "manual" mode — patch that
  // too for this one-month preview, otherwise the override would silently have no effect.
  if (overrideField.startsWith("manual_") && patched.statutory_deduction_mode !== "manual") {
    patched.statutory_deduction_mode = "manual";
  }
  return computeMonthlyPayroll(year, month, patched);
};

/**
 * Like computeMonthlyPayroll, but for the CURRENT month projects every remaining day that has no
 * entry yet: a scheduled work day contributes its target hours at the regular rate (no overtime —
 * that's never predictable in advance), while an already-planned future entry (leave marked ahead
 * of time via Schedule, etc.) is left exactly as computeMonthlyPayroll already treats it. This
 * gives an accurate "what will actually be withheld this month" figure mid-month, instead of only
 * reflecting whatever's been logged so far. Past/other months return the plain actual payroll —
 * there's nothing left to project.
 */
export const computeProjectedMonthlyPayroll = (year: number, month: number, settings: UserSettings): MonthlyPayroll => {
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
  const actualEntries = getWorkHoursForMonth(year, month);
  if (!isCurrentMonth) return computeMonthlyPayroll(year, month, settings, actualEntries);

  const loggedDates = new Set(actualEntries.map((e) => e.date));
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const projectedEntries: WorkHour[] = [...actualEntries];

  for (let d = today.getDate() + 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (loggedDates.has(dateStr)) continue;
    const target = getDailyTargetHoursForDate(dateStr, settings);
    if (target > 0) {
      projectedEntries.push({ date: dateStr, hours_worked: target, start_time: null, end_time: null, status: "worked" });
    }
  }

  return computeMonthlyPayroll(year, month, settings, projectedEntries);
};

export const upsertWorkHour = (workHour: WorkHour) => {
  const data = readData();
  const idx = data.workHours.findIndex((w) => w.date === workHour.date);
  if (idx >= 0) {
    data.workHours[idx] = workHour;
  } else {
    data.workHours.push(workHour);
  }
  writeData(data);
  void pushWorkHour(workHour);
};

export const deleteWorkHourByDate = (date: string) => {
  const data = readData();
  data.workHours = data.workHours.filter((w) => w.date !== date);
  writeData(data);
  void pushDeleteWorkHour(date);
};

export const clearMonthWorkHours = (year: number, month: number) => {
  const data = readData();
  const startDate = localDateKey(year, month, 1);
  const endDate = localDateKey(year, month, new Date(year, month + 1, 0).getDate());
  data.workHours = data.workHours.filter((w) => w.date < startDate || w.date > endDate);
  writeData(data);
  void pushDeleteWorkHoursRange(startDate, endDate);
};

// ---- Food card / meal-budget entries ----

export const getFoodEntriesForMonth = (year: number, month: number): FoodEntry[] => {
  const data = readData();
  const startDate = localDateKey(year, month, 1);
  const endDate = localDateKey(year, month, new Date(year, month + 1, 0).getDate());
  return (data.foodEntries || [])
    .filter((e) => e.date >= startDate && e.date <= endDate)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time || "").localeCompare(b.time || ""));
};

export const addFoodEntry = (entry: FoodEntry) => {
  const data = readData();
  data.foodEntries = [...(data.foodEntries || []), entry];
  writeData(data);
  void pushFoodEntry(entry);
};

export const updateFoodEntry = (entry: FoodEntry) => {
  const data = readData();
  data.foodEntries = (data.foodEntries || []).map((e) => (e.id === entry.id ? entry : e));
  writeData(data);
  void pushFoodEntry(entry);
};

export const deleteFoodEntry = (id: string) => {
  const data = readData();
  data.foodEntries = (data.foodEntries || []).filter((e) => e.id !== id);
  writeData(data);
  void pushDeleteFoodEntry(id);
};

// ---- Month-end PDF archive (last 3 months, so the actual gross salary stays on record even
// though the live in-app forecast deliberately de-emphasizes it) ----

export const getPdfArchive = (): PdfArchiveEntry[] => {
  const data = readData();
  return (data.pdfArchive || []).slice().sort((a, b) => b.year - a.year || b.month - a.month);
};

/** Adds (or replaces) the archived payslip for a month, then trims to the 3 most recent months. */
export const archiveMonthlyPdf = (year: number, month: number, dataUrl: string) => {
  const data = readData();
  const rest = (data.pdfArchive || []).filter((e) => !(e.year === year && e.month === month));
  const entry: PdfArchiveEntry = { year, month, generatedAt: new Date().toISOString(), dataUrl };
  const next = [...rest, entry].sort((a, b) => b.year - a.year || b.month - a.month).slice(0, 3);
  data.pdfArchive = next;
  writeData(data);
  void pushPdfArchiveEntry(entry);
};

/** Looks up one month's archived payslip — the local 3-month cache first (instant), falling back
 * to Supabase (which never trims old rows) for anything older, so browsing back with the month
 * arrows can reach payslips from years ago even though only the last 3 are ever cached locally. */
export const getArchivedPdfForMonth = async (year: number, month: number): Promise<PdfArchiveEntry | null> => {
  const local = getPdfArchive().find((e) => e.year === year && e.month === month);
  if (local) return local;
  return fetchPdfArchiveEntry(year, month);
};

// ---- Actual-vs-estimated net pay reconciliation (local only, not yet synced to Supabase) ----

export const getPayrollActual = (year: number, month: number): PayrollActual | undefined => {
  const data = readData();
  return (data.payrollActuals || []).find((e) => e.year === year && e.month === month);
};

export const savePayrollActual = (entry: Omit<PayrollActual, "updatedAt">) => {
  const data = readData();
  const rest = (data.payrollActuals || []).filter((e) => !(e.year === entry.year && e.month === entry.month));
  const full: PayrollActual = { ...entry, updatedAt: new Date().toISOString() };
  data.payrollActuals = [...rest, full];
  writeData(data);
  void pushPayrollActual(full);
};

export const exportLocalBackup = (): LocalBackupFile => {
  const data = readData();
  return {
    version: 1,
    exported_at: new Date().toISOString(),
    user_settings: data.settings,
    work_hours: data.workHours.sort((a, b) => a.date.localeCompare(b.date)),
  };
};

export const importLocalBackup = (backup: LocalBackupFile) => {
  const data = readData();
  writeData({
    ...data,
    settings: backup.user_settings,
    workHours: backup.work_hours,
  });
};

export const replaceCurrentUserData = (payload: {
  settings: UserSettings;
  workHours: WorkHour[];
  firstName?: string;
}) => {
  const data = readData();
  writeData({
    ...data,
    settings: payload.settings,
    workHours: payload.workHours,
    profile: {
      firstName: payload.firstName?.trim() || data.profile.firstName || "WorkTrack",
    },
  });
};

/**
 * Called once right after a real login/session-restore is confirmed. Two cases:
 *  - This Supabase account already has a settings row (synced before, from this device or
 *    another) → its data replaces whatever's cached locally ("server wins" — fine for one person
 *    using the app from one device at a time, not safe for genuinely concurrent multi-device
 *    editing).
 *  - Brand-new Supabase account with nothing synced yet → the opposite direction: this device's
 *    existing local data (if any) is pushed UP to Supabase instead, so a first-time sync can never
 *    silently wipe out real local history just because the cloud side started out empty.
 */
export const syncAfterLogin = async (pulled: PulledData): Promise<void> => {
  const data = readData();
  if (pulled.settings) {
    writeData({
      settings: pulled.settings,
      workHours: pulled.workHours,
      foodEntries: pulled.foodEntries,
      pdfArchive: pulled.pdfArchive,
      payrollActuals: pulled.payrollActuals,
      profile: { firstName: pulled.firstName || data.profile.firstName || "WorkTrack" },
    });
    return;
  }
  await pushSettings(data.settings, data.profile.firstName);
  await Promise.all(data.workHours.map((w) => pushWorkHour(w)));
  await Promise.all(data.foodEntries.map((e) => pushFoodEntry(e)));
  await Promise.all(data.pdfArchive.map((e) => pushPdfArchiveEntry(e)));
  await Promise.all((data.payrollActuals || []).map((e) => pushPayrollActual(e)));
};
