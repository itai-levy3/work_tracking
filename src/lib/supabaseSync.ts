import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";
import type { FoodEntry, PdfArchiveEntry, UserSettings, WorkHour } from "@/lib/localData";

/**
 * Background sync to Supabase — the app's UI stays fully synchronous against localStorage (see
 * localData.ts); every mutation there also fires one of these push* calls, which upsert/delete the
 * same change in Supabase in the background. This keeps every existing component untouched (no
 * async rewiring) while still landing every change in the cloud. Failures are logged, never thrown
 * — a sync hiccup must never block the local save the user is staring at.
 */

let cachedUserId: string | null | undefined; // undefined = not yet checked this session

const getUserId = async (): Promise<string | null> => {
  if (!isSupabaseConfigured) return null;
  if (cachedUserId !== undefined) return cachedUserId;
  const { data } = await supabase.auth.getSession();
  cachedUserId = data.session?.user.id ?? null;
  return cachedUserId;
};

// Cleared/reset whenever auth state changes, so a login/logout can't leak the previous user's id.
if (isSupabaseConfigured) {
  supabase.auth.onAuthStateChange((_event, session) => {
    cachedUserId = session?.user.id ?? null;
  });
}

const logSyncError = (label: string, error: unknown) => {
  console.warn(`[supabaseSync] ${label} failed — change is saved locally but not yet synced`, error);
};

// ---- settings ----

const toDbSettings = (settings: UserSettings, firstName: string, userId: string) => ({
  user_id: userId,
  work_days: settings.work_days,
  hours_per_day: settings.hours_per_day,
  hourly_rate: settings.hourly_rate,
  salary_mode: settings.salary_mode ?? "hourly",
  salary_cap_amount: settings.salary_cap_amount ?? 0,
  evening_shift_enabled: !!settings.evening_shift_enabled,
  evening_shift_hours: settings.evening_shift_hours ?? 7,
  overtime_calc_enabled: settings.overtime_calc_enabled !== false,
  overtime_tiers: settings.overtime_tiers ?? [],
  overtime_round_hours: !!settings.overtime_round_hours,
  fixed_components: settings.fixed_components ?? [],
  deductions: settings.deductions ?? [],
  annual_vacation_days: settings.annual_vacation_days ?? 12,
  annual_sick_days: settings.annual_sick_days ?? 18,
  vacation_accrual_method: settings.vacation_accrual_method ?? "monthly",
  sick_accrual_method: settings.sick_accrual_method ?? "monthly",
  employment_start_date: settings.employment_start_date ?? null,
  min_vacation_days_required: settings.min_vacation_days_required ?? 10,
  first_name: firstName?.trim() || "WorkTrack",
  statutory_deduction_mode: settings.statutory_deduction_mode ?? "manual",
  tax_credit_points: settings.tax_credit_points ?? 2.25,
  manual_income_tax: settings.manual_income_tax ?? 0,
  manual_national_insurance: settings.manual_national_insurance ?? 0,
  manual_health_insurance: settings.manual_health_insurance ?? 0,
  pension_enabled: !!settings.pension_enabled,
  pension_employee_rate: settings.pension_employee_rate ?? 6,
  pension_base_mode: settings.pension_base_mode ?? "full",
  pension_custom_base: settings.pension_custom_base ?? 0,
  training_fund_enabled: !!settings.training_fund_enabled,
  training_fund_employee_rate: settings.training_fund_employee_rate ?? 2.5,
  training_fund_base_mode: settings.training_fund_base_mode ?? "full",
  training_fund_custom_base: settings.training_fund_custom_base ?? 0,
  food_card_enabled: !!settings.food_card_enabled,
  food_card_has_card: settings.food_card_has_card ?? true,
  food_card_monthly_amount: settings.food_card_monthly_amount ?? 0,
  food_card_daily_cap: settings.food_card_daily_cap ?? 0,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fromDbSettings = (row: any): { settings: UserSettings; firstName: string } => ({
  firstName: row.first_name,
  settings: {
    work_days: row.work_days,
    hours_per_day: row.hours_per_day,
    hourly_rate: Number(row.hourly_rate) || 0,
    salary_mode: row.salary_mode,
    salary_cap_amount: Number(row.salary_cap_amount) || 0,
    evening_shift_enabled: row.evening_shift_enabled,
    evening_shift_hours: Number(row.evening_shift_hours) || 0,
    overtime_calc_enabled: row.overtime_calc_enabled,
    overtime_tiers: row.overtime_tiers ?? [],
    overtime_round_hours: row.overtime_round_hours,
    fixed_components: row.fixed_components ?? [],
    deductions: row.deductions ?? [],
    annual_vacation_days: Number(row.annual_vacation_days) || 0,
    annual_sick_days: Number(row.annual_sick_days) || 0,
    vacation_accrual_method: row.vacation_accrual_method,
    sick_accrual_method: row.sick_accrual_method,
    employment_start_date: row.employment_start_date,
    min_vacation_days_required: Number(row.min_vacation_days_required) || 0,
    statutory_deduction_mode: row.statutory_deduction_mode,
    tax_credit_points: Number(row.tax_credit_points) || 0,
    manual_income_tax: Number(row.manual_income_tax) || 0,
    manual_national_insurance: Number(row.manual_national_insurance) || 0,
    manual_health_insurance: Number(row.manual_health_insurance) || 0,
    pension_enabled: row.pension_enabled,
    pension_employee_rate: Number(row.pension_employee_rate) || 0,
    pension_base_mode: row.pension_base_mode,
    pension_custom_base: Number(row.pension_custom_base) || 0,
    training_fund_enabled: row.training_fund_enabled,
    training_fund_employee_rate: Number(row.training_fund_employee_rate) || 0,
    training_fund_base_mode: row.training_fund_base_mode,
    training_fund_custom_base: Number(row.training_fund_custom_base) || 0,
    food_card_enabled: row.food_card_enabled,
    food_card_has_card: row.food_card_has_card,
    food_card_monthly_amount: Number(row.food_card_monthly_amount) || 0,
    food_card_daily_cap: Number(row.food_card_daily_cap) || 0,
  },
});

export const pushSettings = async (settings: UserSettings, firstName: string): Promise<void> => {
  const userId = await getUserId();
  if (!userId) return;
  const { error } = await supabase.from("settings").upsert(toDbSettings(settings, firstName, userId), { onConflict: "user_id" });
  if (error) logSyncError("pushSettings", error);
};

// ---- work hours ----

const toDbWorkHour = (w: WorkHour, userId: string) => ({
  user_id: userId,
  date: w.date,
  hours_worked: w.hours_worked,
  start_time: w.start_time,
  end_time: w.end_time,
  segments: w.segments ?? null,
  status: w.status || "worked",
  fraction: w.fraction ?? null,
  paid: w.paid ?? null,
  deficit_covered_by: w.deficitCoveredBy ?? null,
  evening: !!w.evening,
  note: w.note ?? null,
  one_time_planned_hours: w.oneTimePlannedHours ?? null,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fromDbWorkHour = (row: any): WorkHour => ({
  date: row.date,
  hours_worked: Number(row.hours_worked) || 0,
  start_time: row.start_time,
  end_time: row.end_time,
  segments: row.segments ?? undefined,
  status: row.status,
  fraction: row.fraction ?? undefined,
  paid: row.paid ?? undefined,
  deficitCoveredBy: row.deficit_covered_by ?? undefined,
  evening: row.evening ?? undefined,
  note: row.note ?? undefined,
  oneTimePlannedHours: row.one_time_planned_hours != null ? Number(row.one_time_planned_hours) : undefined,
});

export const pushWorkHour = async (workHour: WorkHour): Promise<void> => {
  const userId = await getUserId();
  if (!userId) return;
  const { error } = await supabase.from("work_hours").upsert(toDbWorkHour(workHour, userId), { onConflict: "user_id,date" });
  if (error) logSyncError("pushWorkHour", error);
};

export const pushDeleteWorkHour = async (date: string): Promise<void> => {
  const userId = await getUserId();
  if (!userId) return;
  const { error } = await supabase.from("work_hours").delete().eq("user_id", userId).eq("date", date);
  if (error) logSyncError("pushDeleteWorkHour", error);
};

export const pushDeleteWorkHoursRange = async (startDate: string, endDate: string): Promise<void> => {
  const userId = await getUserId();
  if (!userId) return;
  const { error } = await supabase.from("work_hours").delete().eq("user_id", userId).gte("date", startDate).lte("date", endDate);
  if (error) logSyncError("pushDeleteWorkHoursRange", error);
};

// ---- food entries ----

const toDbFoodEntry = (e: FoodEntry, userId: string) => ({
  id: e.id,
  user_id: userId,
  date: e.date,
  time: e.time ?? null,
  card_amount: e.cardAmount,
  personal_top_up: e.personalTopUp ?? null,
  note: e.note ?? null,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fromDbFoodEntry = (row: any): FoodEntry => ({
  id: row.id,
  date: row.date,
  time: row.time ?? undefined,
  cardAmount: Number(row.card_amount) || 0,
  personalTopUp: row.personal_top_up != null ? Number(row.personal_top_up) : undefined,
  note: row.note ?? undefined,
});

export const pushFoodEntry = async (entry: FoodEntry): Promise<void> => {
  const userId = await getUserId();
  if (!userId) return;
  const { error } = await supabase.from("food_entries").upsert(toDbFoodEntry(entry, userId), { onConflict: "id" });
  if (error) logSyncError("pushFoodEntry", error);
};

export const pushDeleteFoodEntry = async (id: string): Promise<void> => {
  const userId = await getUserId();
  if (!userId) return;
  const { error } = await supabase.from("food_entries").delete().eq("user_id", userId).eq("id", id);
  if (error) logSyncError("pushDeleteFoodEntry", error);
};

// ---- pdf archive ----

export const pushPdfArchiveEntry = async (entry: PdfArchiveEntry): Promise<void> => {
  const userId = await getUserId();
  if (!userId) return;
  const { error } = await supabase.from("pdf_archive").upsert(
    { user_id: userId, year: entry.year, month: entry.month, generated_at: entry.generatedAt, data_url: entry.dataUrl },
    { onConflict: "user_id,year,month" },
  );
  if (error) logSyncError("pushPdfArchiveEntry", error);
};

// ---- pull-everything-on-login ----

export interface PulledData {
  settings: UserSettings | null;
  firstName: string | null;
  workHours: WorkHour[];
  foodEntries: FoodEntry[];
  pdfArchive: PdfArchiveEntry[];
}

/** Called once right after a real Supabase session is confirmed — fetches this user's full state
 * from Supabase so it can replace whatever's cached in localStorage (a fresh device/browser has
 * nothing locally yet; a returning one gets whatever was last synced from any device). */
export const pullAllFromSupabase = async (): Promise<PulledData | null> => {
  const userId = await getUserId();
  if (!userId) return null;

  const [settingsRes, workHoursRes, foodRes, pdfRes] = await Promise.all([
    supabase.from("settings").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("work_hours").select("*").eq("user_id", userId),
    supabase.from("food_entries").select("*").eq("user_id", userId),
    supabase.from("pdf_archive").select("*").eq("user_id", userId),
  ]);

  if (settingsRes.error) logSyncError("pull settings", settingsRes.error);
  if (workHoursRes.error) logSyncError("pull work_hours", workHoursRes.error);
  if (foodRes.error) logSyncError("pull food_entries", foodRes.error);
  if (pdfRes.error) logSyncError("pull pdf_archive", pdfRes.error);

  const parsedSettings = settingsRes.data ? fromDbSettings(settingsRes.data) : null;

  return {
    settings: parsedSettings?.settings ?? null,
    firstName: parsedSettings?.firstName ?? null,
    workHours: (workHoursRes.data ?? []).map(fromDbWorkHour),
    foodEntries: (foodRes.data ?? []).map(fromDbFoodEntry),
    pdfArchive: (pdfRes.data ?? []).map(
      (row): PdfArchiveEntry => ({
        year: row.year,
        month: row.month,
        generatedAt: row.generated_at,
        dataUrl: row.data_url,
      }),
    ),
  };
};
