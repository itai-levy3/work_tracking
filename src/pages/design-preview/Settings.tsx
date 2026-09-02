import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AccrualMethod,
  computeEffectiveHourlyRateForMonth,
  computeMonthlyPayroll,
  enableFoodTracking,
  exportLocalBackup,
  formatHM,
  getProfileFirstName,
  getSettings,
  importLocalBackup,
  isFoodRelatedLabel,
  LocalBackupFile,
  OvertimeTier,
  PayLineItem,
  replaceCurrentUserData,
  saveSettings,
  setProfileFirstName,
  UserSettings,
  WorkHour,
} from "@/lib/localData";
import { exportAnnualPayslipPdf, exportMonthlyPayslipPdf } from "@/lib/pdfExport";
import { getCurrentUserEmail, isLocalAuthenticated, logoutLocalAuth } from "@/lib/localAuth";
import { checkSecurityAnswer, getRecoveryQuestionIds, hasRecoverySetup, lockAccount, saveRecoverySetup, SECURITY_QUESTIONS } from "@/lib/recoveryAuth";
import { SecurityChallenge } from "./SecurityChallenge";
import { LH } from "./tokens";
import { LHHeader, LHBottomNav, globalStyle } from "./Shared";

/** Common (not exhaustive) credit-point categories — reference only, not tax advice. */
const BASE_CREDIT_POINTS = 2.25;
const CREDIT_POINT_CATEGORIES: { id: string; label: string; points: number; description: string }[] = [
  { id: "woman", label: "אישה", points: 0.5, description: "נקודת זיכוי נוספת לעובדת." },
  { id: "new_immigrant", label: "עולה חדש / תושב חוזר (שנה ראשונה)", points: 1.0, description: "יורד בהדרגה על פני כשלוש שנים ממועד העלייה." },
  { id: "discharged_soldier", label: "חייל/ת משוחרר/ת", points: 1.0, description: "לתקופה מוגבלת מיום השחרור משירות סדיר." },
  { id: "single_parent", label: "הורה יחיד", points: 1.0, description: "עבור הורה המגדל לבד ילד/ים." },
  { id: "child", label: "כל ילד עד גיל 18 (בד״כ לאם)", points: 1.0, description: "חישוב מדויק תלוי בגיל הילד ובזהות ההורה המקבל את הזיכוי — ערך זה לכל ילד כהערכה גסה." },
  { id: "disabled_dependent", label: "בן/בת זוג או ילד עם מוגבלות", points: 2.0, description: "בכפוף לאישורים רפואיים/סטטוטוריים מתאימים." },
  { id: "academic_degree", label: "תואר אקדמי ראשון", points: 1.0, description: "לתקופה מוגבלת (בד״כ עד 3 שנים) מתום הלימודים." },
];

const days = [
  { key: "sunday", label: "יום ראשון", short: "א'" },
  { key: "monday", label: "יום שני", short: "ב'" },
  { key: "tuesday", label: "יום שלישי", short: "ג'" },
  { key: "wednesday", label: "יום רביעי", short: "ד'" },
  { key: "thursday", label: "יום חמישי", short: "ה'" },
  { key: "friday", label: "יום שישי", short: "ו'" },
  { key: "saturday", label: "שבת", short: "ש'" },
];

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      aria-pressed={on}
      onClick={() => onChange(!on)}
      className="relative w-12 h-6 rounded-full transition-colors duration-300 outline-none shrink-0"
      style={{ background: on ? LH.primary : `${LH.surfaceVariant}CC` }}
    >
      <div
        className="absolute top-[2px] w-5 h-5 bg-white rounded-full shadow-sm transition-transform duration-300 ease-out flex items-center justify-center"
        style={{ right: 2, transform: on ? "translateX(-24px)" : "translateX(0)" }}
      >
        <div className="w-1.5 h-1.5 rounded-full transition-opacity duration-200" style={{ background: LH.primary, opacity: on ? 1 : 0 }} />
      </div>
    </button>
  );
}

function Row({ title, value, onClick }: { title: string; value: string; onClick?: () => void }) {
  return (
    <div
      className="p-4 flex items-center justify-between hover:bg-[#f0edf1]/30 transition-colors cursor-pointer"
      style={{ background: LH.surfaceContainerLowest }}
      onClick={onClick}
    >
      <div className="flex flex-col">
        <span className="text-[16px]" style={{ color: LH.onSurface }}>{title}</span>
        <span className="text-[12px] font-normal" style={{ color: LH.onSurfaceVariant }}>{value}</span>
      </div>
      <span className="material-symbols-outlined text-[20px]" style={{ color: LH.onSurfaceVariant }}>chevron_left</span>
    </div>
  );
}

function ToggleRow({ title, value, on, onChange }: { title: string; value: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="p-4 flex items-center justify-between transition-colors" style={{ background: LH.surfaceContainerLowest }}>
      <div className="flex flex-col">
        <span className="text-[16px]" style={{ color: LH.onSurface }}>{title}</span>
        <span className="text-[12px] font-normal" style={{ color: LH.onSurfaceVariant }}>{value}</span>
      </div>
      <Toggle on={on} onChange={onChange} />
    </div>
  );
}

function Section({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <div className="w-full flex flex-col gap-4 mb-10">
      <h3 className="text-[18px] font-bold flex items-center gap-2 px-2" style={{ color: LH.primary }}>
        <span className="material-symbols-outlined" style={{ color: `${LH.primary}CC` }}>{icon}</span>
        {title}
      </h3>
      <div className="rounded-2xl overflow-hidden flex flex-col gap-[1px]" style={{ background: `${LH.surfaceVariant}4D`, boxShadow: "0 16px 45px rgba(35,50,100,0.03)" }}>
        {children}
      </div>
    </div>
  );
}

/** A "0" amount field should show empty (with a "0" placeholder as a hint) rather than a literal
 * "0" the user has to delete before typing — but a genuinely-typed "10" etc. passes through untouched. */
const zeroToEmpty = (v: number | string): string | number => (Number(v) === 0 ? "" : v);

const dialogFieldStyle: React.CSSProperties = {
  background: "#F8FAFF",
  border: `1px solid ${LH.surfaceVariant}`,
  borderRadius: 14,
  padding: "10px 14px",
  fontSize: 16,
  color: LH.onSurface,
  width: "100%",
  outline: "none",
};

const dialogClassName = "max-w-md rounded-[24px] p-6 border-0";

export default function DesignPreviewSettings() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [firstName, setFirstName] = useState("WorkTrack");
  const [settings, setSettings] = useState<UserSettings | null>(null);

  const [nameDialogOpen, setNameDialogOpen] = useState(false);
  const [nameInput, setNameInput] = useState("");

  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [workDaysDraft, setWorkDaysDraft] = useState<Record<string, boolean>>({});
  const [hoursPerDayDraft, setHoursPerDayDraft] = useState<Record<string, number>>({});

  const [rateDialogOpen, setRateDialogOpen] = useState(false);
  const [rateInput, setRateInput] = useState("0");
  const [salaryModeDraft, setSalaryModeDraft] = useState<"hourly" | "cap">("hourly");
  const [capAmountDraft, setCapAmountDraft] = useState("0");

  type ViewRow = { label: string; value: string };
  const [viewDialog, setViewDialog] = useState<{ title: string; icon: string; rows: ViewRow[]; onEdit: () => void } | null>(null);
  const openView = (title: string, icon: string, rows: ViewRow[], onEdit: () => void) => setViewDialog({ title, icon, rows, onEdit });

  const [eveningDialogOpen, setEveningDialogOpen] = useState(false);
  const [eveningHoursInput, setEveningHoursInput] = useState("7");

  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
  const [vacationDaysInput, setVacationDaysInput] = useState("12");
  const [sickDaysInput, setSickDaysInput] = useState("18");
  const [vacationMethodDraft, setVacationMethodDraft] = useState<AccrualMethod>("monthly");
  const [sickMethodDraft, setSickMethodDraft] = useState<AccrualMethod>("monthly");
  const [startDateDraft, setStartDateDraft] = useState("");
  const [minVacationDraft, setMinVacationDraft] = useState("10");

  const [overtimeDialogOpen, setOvertimeDialogOpen] = useState(false);
  const [tiersDraft, setTiersDraft] = useState<OvertimeTier[]>([]);
  const [roundHoursDraft, setRoundHoursDraft] = useState(false);

  const [componentsDialogOpen, setComponentsDialogOpen] = useState(false);
  const [componentsDraft, setComponentsDraft] = useState<PayLineItem[]>([]);

  const [deductionsDialogOpen, setDeductionsDialogOpen] = useState(false);
  const [deductionsDraft, setDeductionsDraft] = useState<PayLineItem[]>([]);

  const [statutoryDialogOpen, setStatutoryDialogOpen] = useState(false);
  const [statutoryModeDraft, setStatutoryModeDraft] = useState<"automatic" | "manual">("manual");
  const [creditTableOpen, setCreditTableOpen] = useState(false);
  const [selectedCreditCategories, setSelectedCreditCategories] = useState<string[]>([]);
  const [taxCreditPointsDraft, setTaxCreditPointsDraft] = useState("2.25");
  const [manualIncomeTaxDraft, setManualIncomeTaxDraft] = useState("0");
  const [manualNIDraft, setManualNIDraft] = useState("0");
  const [manualHealthDraft, setManualHealthDraft] = useState("0");
  const [pensionEnabledDraft, setPensionEnabledDraft] = useState(false);
  const [pensionRateDraft, setPensionRateDraft] = useState("6");
  const [pensionBaseModeDraft, setPensionBaseModeDraft] = useState<"full" | "custom">("full");
  const [pensionCustomBaseDraft, setPensionCustomBaseDraft] = useState("0");
  const [tfEnabledDraft, setTfEnabledDraft] = useState(false);
  const [tfRateDraft, setTfRateDraft] = useState("2.5");
  const [tfBaseModeDraft, setTfBaseModeDraft] = useState<"full" | "custom">("full");
  const [tfCustomBaseDraft, setTfCustomBaseDraft] = useState("0");

  const [foodDialogOpen, setFoodDialogOpen] = useState(false);
  const [foodHasCardDraft, setFoodHasCardDraft] = useState(true);
  const [foodMonthlyDraft, setFoodMonthlyDraft] = useState("0");
  const [foodDailyCapDraft, setFoodDailyCapDraft] = useState("0");

  const [importExportOpen, setImportExportOpen] = useState(false);
  const [exportMonth, setExportMonth] = useState(new Date().getMonth());
  const [exportYear, setExportYear] = useState(new Date().getFullYear());
  const [busy, setBusy] = useState(false);
  const restoreInputRef = useRef<HTMLInputElement>(null);
  const [annualReportsOpen, setAnnualReportsOpen] = useState(false);
  const [annualReportsYear, setAnnualReportsYear] = useState(() => new Date().getFullYear());

  const [recoveryConfigured, setRecoveryConfigured] = useState(false);
  const [recoveryChallengeOpen, setRecoveryChallengeOpen] = useState(false);
  const [recoveryChallengeQuestionIds, setRecoveryChallengeQuestionIds] = useState<string[]>([]);
  const [recoveryDialogOpen, setRecoveryDialogOpen] = useState(false);
  const [recoveryPinDraft, setRecoveryPinDraft] = useState("");
  const [recoveryPinConfirmDraft, setRecoveryPinConfirmDraft] = useState("");
  const [recoveryQuestionIdsDraft, setRecoveryQuestionIdsDraft] = useState<[string, string, string]>([SECURITY_QUESTIONS[0].id, SECURITY_QUESTIONS[1].id, SECURITY_QUESTIONS[2].id]);
  const [recoveryAnswersDraft, setRecoveryAnswersDraft] = useState<[string, string, string]>(["", "", ""]);

  useEffect(() => {
    if (!isLocalAuthenticated()) {
      navigate("/design-preview/login");
      return;
    }
    void hasRecoverySetup().then((configured) => {
      setRecoveryConfigured(configured);
      if (!configured) {
        navigate("/design-preview/login");
        return;
      }
      const s = getSettings();
      setSettings(s);
      setFirstName(getProfileFirstName());
      setLoading(false);
    });
  }, [navigate]);

  const persist = (next: UserSettings) => {
    setSettings(next);
    saveSettings(next);
  };

  const workDaysSummary = () => {
    if (!settings) return "";
    const active = days.filter((d) => settings.work_days[d.key]).map((d) => d.short);
    return active.length ? active.join(", ") : "אין ימי עבודה מוגדרים";
  };

  const avgDailyTargetSummary = () => {
    if (!settings) return "";
    const active = days.filter((d) => settings.work_days[d.key]);
    if (!active.length) return "—";
    const hours = active.map((d) => settings.hours_per_day[d.key] || 0);
    const max = Math.max(...hours);
    return `${formatHM(max)} שעות`;
  };

  const openNameDialog = () => {
    setNameInput(firstName);
    setNameDialogOpen(true);
  };
  const saveName = () => {
    const trimmed = nameInput.trim() || "WorkTrack";
    setProfileFirstName(trimmed);
    setFirstName(trimmed);
    setNameDialogOpen(false);
    toast.success("השם עודכן");
  };

  const openScheduleDialog = () => {
    if (!settings) return;
    setWorkDaysDraft({ ...settings.work_days });
    setHoursPerDayDraft({ ...settings.hours_per_day });
    setScheduleDialogOpen(true);
  };
  const saveSchedule = () => {
    if (!settings) return;
    persist({ ...settings, work_days: workDaysDraft, hours_per_day: hoursPerDayDraft });
    setScheduleDialogOpen(false);
    toast.success("לוח העבודה עודכן");
  };

  const openRateDialog = () => {
    if (!settings) return;
    setRateInput(String(settings.hourly_rate || 0));
    setSalaryModeDraft(settings.salary_mode ?? "hourly");
    setCapAmountDraft(String(settings.salary_cap_amount ?? 0));
    setRateDialogOpen(true);
  };
  const saveRate = () => {
    if (!settings) return;
    const val = parseFloat(rateInput.replace(/[^0-9.]/g, "")) || 0;
    const cap = parseFloat(capAmountDraft.replace(/[^0-9.]/g, "")) || 0;
    persist({ ...settings, hourly_rate: val, salary_mode: salaryModeDraft, salary_cap_amount: cap });
    setRateDialogOpen(false);
    toast.success("שכר עודכן");
  };

  const openOvertimeDialog = () => {
    if (!settings) return;
    setTiersDraft(settings.overtime_tiers && settings.overtime_tiers.length ? settings.overtime_tiers.map((t) => ({ ...t })) : [{ rateType: "percent", rateValue: 125 }]);
    setRoundHoursDraft(!!settings.overtime_round_hours);
    setOvertimeDialogOpen(true);
  };
  const saveOvertime = () => {
    if (!settings) return;
    persist({ ...settings, overtime_tiers: tiersDraft, overtime_round_hours: roundHoursDraft });
    setOvertimeDialogOpen(false);
    toast.success("מדרגות שעות נוספות עודכנו");
  };
  const addTier = () => setTiersDraft((prev) => (prev.length >= 5 ? prev : [...prev, { rateType: "percent", rateValue: 125 }]));
  const removeTier = (i: number) => setTiersDraft((prev) => prev.filter((_, idx) => idx !== i));

  const openComponentsDialog = () => {
    if (!settings) return;
    setComponentsDraft(settings.fixed_components ? settings.fixed_components.map((c) => ({ ...c })) : []);
    setComponentsDialogOpen(true);
  };
  const saveComponents = () => {
    if (!settings) return;
    const cleaned = componentsDraft.filter((c) => c.label.trim());
    if (settings.food_card_enabled && cleaned.some((c) => isFoodRelatedLabel(c.label))) {
      toast.error('מעקב אוכל כבר פעיל אצלך — נהל הוצאות אוכל דרך פורטל האוכל (אייקון המזלג בתפריט), לא כאן.');
      return;
    }
    persist({ ...settings, fixed_components: cleaned });
    setComponentsDialogOpen(false);
    toast.success("תוספות לשכר עודכנו");
  };

  const openDeductionsDialog = () => {
    if (!settings) return;
    setDeductionsDraft(settings.deductions ? settings.deductions.map((d) => ({ ...d })) : []);
    setDeductionsDialogOpen(true);
  };
  const saveDeductions = () => {
    if (!settings) return;
    persist({ ...settings, deductions: deductionsDraft.filter((d) => d.label.trim()) });
    setDeductionsDialogOpen(false);
    toast.success("ניכויים עודכנו");
  };

  const openStatutoryDialog = () => {
    if (!settings) return;
    setStatutoryModeDraft(settings.statutory_deduction_mode ?? "manual");
    setTaxCreditPointsDraft(String(settings.tax_credit_points ?? 2.25));
    setManualIncomeTaxDraft(String(settings.manual_income_tax ?? 0));
    setManualNIDraft(String(settings.manual_national_insurance ?? 0));
    setManualHealthDraft(String(settings.manual_health_insurance ?? 0));
    setPensionEnabledDraft(!!settings.pension_enabled);
    setPensionRateDraft(String(settings.pension_employee_rate ?? 6));
    setPensionBaseModeDraft(settings.pension_base_mode ?? "full");
    setPensionCustomBaseDraft(String(settings.pension_custom_base ?? 0));
    setTfEnabledDraft(!!settings.training_fund_enabled);
    setTfRateDraft(String(settings.training_fund_employee_rate ?? 2.5));
    setTfBaseModeDraft(settings.training_fund_base_mode ?? "full");
    setTfCustomBaseDraft(String(settings.training_fund_custom_base ?? 0));
    setStatutoryDialogOpen(true);
  };
  const saveStatutory = () => {
    if (!settings) return;
    const num = (s: string) => parseFloat(s.replace(/[^0-9.]/g, "")) || 0;
    persist({
      ...settings,
      statutory_deduction_mode: statutoryModeDraft,
      tax_credit_points: num(taxCreditPointsDraft),
      manual_income_tax: num(manualIncomeTaxDraft),
      manual_national_insurance: num(manualNIDraft),
      manual_health_insurance: num(manualHealthDraft),
      pension_enabled: pensionEnabledDraft,
      pension_employee_rate: num(pensionRateDraft),
      pension_base_mode: pensionBaseModeDraft,
      pension_custom_base: num(pensionCustomBaseDraft),
      training_fund_enabled: tfEnabledDraft,
      training_fund_employee_rate: num(tfRateDraft),
      training_fund_base_mode: tfBaseModeDraft,
      training_fund_custom_base: num(tfCustomBaseDraft),
    });
    setStatutoryDialogOpen(false);
    toast.success("ניכויי חובה ופנסיה עודכנו");
  };

  const openFoodDialog = () => {
    if (!settings) return;
    setFoodHasCardDraft(settings.food_card_has_card ?? true);
    setFoodMonthlyDraft(String(settings.food_card_monthly_amount ?? 0));
    setFoodDailyCapDraft(String(settings.food_card_daily_cap ?? 0));
    setFoodDialogOpen(true);
  };
  const saveFoodSettings = () => {
    if (!settings) return;
    const num = (s: string) => parseFloat(s.replace(/[^0-9.]/g, "")) || 0;
    const next = enableFoodTracking(foodHasCardDraft, num(foodMonthlyDraft), num(foodDailyCapDraft));
    setSettings(next);
    setFoodDialogOpen(false);
    toast.success("מצב מעקב אוכל עודכן");
  };
  const disableFoodTracking = () => {
    if (!settings) return;
    persist({ ...settings, food_card_enabled: false });
    toast.success("מצב מעקב אוכל כובה");
  };

  const resetRecoveryDraft = () => {
    setRecoveryPinDraft("");
    setRecoveryPinConfirmDraft("");
    setRecoveryQuestionIdsDraft([SECURITY_QUESTIONS[0].id, SECURITY_QUESTIONS[1].id, SECURITY_QUESTIONS[2].id]);
    setRecoveryAnswersDraft(["", "", ""]);
  };

  const openRecoverySettings = async () => {
    if (!recoveryConfigured) {
      resetRecoveryDraft();
      setRecoveryDialogOpen(true);
      return;
    }
    // Already configured — require passing the same sequential security-question challenge used
    // for "forgot PIN" on the login screen before replacing them.
    const email = getCurrentUserEmail();
    if (!email) return;
    const status = await getRecoveryQuestionIds(email);
    if (!status) {
      toast.error("לא נמצא שחזור מוגדר");
      return;
    }
    if (status.locked) {
      toast.error("החשבון נעול לאחר יותר מדי טעויות — יש להתנתק ולשחזר אותו דרך \"שכחתי סיסמה\"");
      return;
    }
    setRecoveryChallengeQuestionIds(status.questionIds);
    setRecoveryChallengeOpen(true);
  };

  const recoveryChallengeAttempt = (questionId: string, answer: string) => {
    const email = getCurrentUserEmail();
    if (!email) return Promise.resolve({ ok: false });
    // No newPin passed — this challenge only confirms identity; the real new PIN/questions are
    // chosen in the dialog that opens right after (saveRecoverySetup overwrites everything).
    return checkSecurityAnswer(email, questionId, answer);
  };

  const recoveryChallengeSuccess = () => {
    setRecoveryChallengeOpen(false);
    resetRecoveryDraft();
    setRecoveryDialogOpen(true);
  };

  const recoveryChallengeLocked = async () => {
    const email = getCurrentUserEmail();
    if (email) await lockAccount(email);
    setRecoveryChallengeOpen(false);
    toast.error("החשבון ננעל לאחר יותר מדי טעויות — יש להתנתק ולשחזר אותו דרך \"שכחתי סיסמה\" במסך ההתחברות");
  };

  const saveRecoveryDraft = async () => {
    const email = getCurrentUserEmail();
    if (!email) return;
    if (!/^\d{4,8}$/.test(recoveryPinDraft)) return toast.error("ה-PIN חייב להיות 4-8 ספרות");
    if (recoveryPinDraft !== recoveryPinConfirmDraft) return toast.error("ה-PIN ואימות ה-PIN אינם תואמים");
    if (new Set(recoveryQuestionIdsDraft).size !== 3) return toast.error("יש לבחור 3 שאלות אבטחה שונות");
    if (recoveryAnswersDraft.some((a) => !a.trim())) return toast.error("יש למלא תשובה לכל שאלה");
    try {
      await saveRecoverySetup(
        email,
        recoveryPinDraft,
        recoveryQuestionIdsDraft.map((id, i) => ({ questionId: id, answer: recoveryAnswersDraft[i] })),
      );
      setRecoveryConfigured(true);
      setRecoveryDialogOpen(false);
      toast.success("שחזור הסיסמה עודכן");
    } catch {
      toast.error("שגיאה בשמירת שחזור הסיסמה");
    }
  };

  const openEveningDialog = () => {
    if (!settings) return;
    setEveningHoursInput(String(settings.evening_shift_hours ?? 7));
    setEveningDialogOpen(true);
  };
  const saveEveningHours = () => {
    if (!settings) return;
    const val = parseFloat(eveningHoursInput.replace(/[^0-9.]/g, "")) || 0;
    persist({ ...settings, evening_shift_hours: val });
    setEveningDialogOpen(false);
    toast.success("שעות משמרת ערב עודכנו");
  };

  const toggleEvening = (v: boolean) => {
    if (!settings) return;
    persist({ ...settings, evening_shift_enabled: v });
  };
  const toggleOvertime = (v: boolean) => {
    if (!settings) return;
    persist({ ...settings, overtime_calc_enabled: v });
  };
  const setOvertimePayoutMonth = (v: "current" | "next") => {
    if (!settings) return;
    persist({ ...settings, overtime_payout_month: v });
  };

  const openLeaveDialog = () => {
    if (!settings) return;
    setVacationDaysInput(String(settings.annual_vacation_days ?? 12));
    setSickDaysInput(String(settings.annual_sick_days ?? 18));
    setVacationMethodDraft(settings.vacation_accrual_method ?? "monthly");
    setSickMethodDraft(settings.sick_accrual_method ?? "monthly");
    setStartDateDraft(settings.employment_start_date ?? "");
    setMinVacationDraft(String(settings.min_vacation_days_required ?? 10));
    setLeaveDialogOpen(true);
  };
  const saveLeave = () => {
    if (!settings) return;
    persist({
      ...settings,
      annual_vacation_days: parseFloat(vacationDaysInput.replace(/[^0-9.]/g, "")) || 0,
      annual_sick_days: parseFloat(sickDaysInput.replace(/[^0-9.]/g, "")) || 0,
      vacation_accrual_method: vacationMethodDraft,
      sick_accrual_method: sickMethodDraft,
      employment_start_date: startDateDraft || null,
      min_vacation_days_required: parseFloat(minVacationDraft.replace(/[^0-9.]/g, "")) || 0,
    });
    setLeaveDialogOpen(false);
    toast.success("הגדרות חופש ומחלה עודכנו");
  };

  const handleExportReport = async () => {
    if (!settings) return;
    setBusy(true);
    try {
      await exportMonthlyPayslipPdf(exportYear, exportMonth, settings, firstName);
      toast.success("הדוח יוצא בהצלחה");
    } catch {
      toast.error("שגיאה בייצוא");
    } finally {
      setBusy(false);
    }
  };

  const handleExportYearlyReport = async () => {
    if (!settings) return;
    setBusy(true);
    try {
      const ok = await exportAnnualPayslipPdf(exportYear, settings, firstName);
      if (!ok) {
        toast.error("אין נתונים לשנה זו");
        setBusy(false);
        return;
      }
      toast.success("הדוח השנתי יוצא בהצלחה");
    } catch {
      toast.error("שגיאה בייצוא");
    } finally {
      setBusy(false);
    }
  };


  const handleExportBackup = async () => {
    setBusy(true);
    try {
      const backup = exportLocalBackup();
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `worktrack-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("קובץ גיבוי נשמר בהצלחה");
    } catch {
      toast.error("שגיאה ביצירת הגיבוי");
    } finally {
      setBusy(false);
    }
  };

  const handleRestoreBackup = async (file: File) => {
    setBusy(true);
    try {
      const content = await file.text();
      const parsed = JSON.parse(content) as Partial<LocalBackupFile>;
      if (!parsed || parsed.version !== 1 || !parsed.user_settings || !Array.isArray(parsed.work_hours)) {
        throw new Error("Invalid backup format");
      }
      importLocalBackup(parsed as LocalBackupFile);
      setSettings(parsed.user_settings as UserSettings);
      toast.success("השחזור הושלם בהצלחה");
    } catch {
      toast.error("קובץ הגיבוי לא תקין או ששחזור נכשל");
    } finally {
      setBusy(false);
      if (restoreInputRef.current) restoreInputRef.current.value = "";
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
    <div dir="rtl" className="min-h-screen w-full flex flex-col" style={{ background: LH.background, color: LH.onSurface, fontFamily: "'Heebo', system-ui, sans-serif" }}>
      <style>{globalStyle}</style>
      <LHHeader />
      <main className="flex-1 relative w-full pt-20 pb-32 px-6 overflow-x-hidden">
        <div className="flex flex-col w-full relative max-w-[440px] mx-auto" dir="rtl">
          <div className="w-full flex justify-start items-center mb-10 pt-4">
            <h1 className="text-[24px] leading-[32px] tracking-[-0.01em] font-bold" style={{ color: LH.onSurface }}>הגדרות</h1>
          </div>

          {/* Profile hero */}
          <div className="lh-rise w-full rounded-[24px] p-6 flex flex-col items-center justify-center gap-5 mb-10 relative overflow-hidden shadow-sm" style={{ background: `${LH.surfaceContainer}99`, backdropFilter: "blur(20px)" }}>
            <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full blur-2xl" style={{ background: `${LH.primary}1A` }} />
            <div className="absolute -bottom-10 -left-10 w-32 h-32 rounded-full blur-2xl" style={{ background: `${LH.secondary}1A` }} />
            <div className="relative w-24 h-24 rounded-full flex items-center justify-center overflow-hidden shadow-md z-10" style={{ background: LH.surfaceContainerHigh, boxShadow: `0 0 0 4px ${LH.surfaceBright}` }}>
              <span className="material-symbols-outlined text-[44px]" style={{ color: LH.onSurfaceVariant }}>person</span>
            </div>
            <div className="flex flex-col items-center z-10">
              <h2 className="text-[24px] leading-[32px] tracking-[-0.01em] font-bold" style={{ color: LH.onSurface }}>{firstName}</h2>
              <p className="text-[16px] leading-6 mt-1" style={{ color: LH.onSurfaceVariant }}>WorkTrack</p>
            </div>
            <button
              className="z-10 mt-2 px-6 py-2 rounded-full font-medium shadow-sm hover:shadow-md transition-all duration-300 flex items-center gap-2"
              style={{ background: LH.surfaceBright, color: LH.primary }}
              onClick={openNameDialog}
            >
              <span className="material-symbols-outlined text-[20px]">edit</span>
              עריכת שם
            </button>
          </div>

          <Section icon="person" title="פרופיל אישי">
            <Row title="שם" value={firstName} onClick={openNameDialog} />
            <Row
              title="PIN שחזור ושאלות אבטחה"
              value={recoveryConfigured ? "מוגדר — לחיצה כאן משנה" : "לא מוגדר — מומלץ להגדיר כדי לשחזר סיסמה"}
              onClick={openRecoverySettings}
            />
          </Section>

          <Section icon="payments" title="שכר">
            <Row
              title={settings.salary_mode === "cap" ? "תקרת שכר" : "שכר שעתי"}
              value={
                settings.salary_mode === "cap"
                  ? `${(settings.salary_cap_amount ?? 0).toFixed(0)} ₪ לחודש · שעתי מחושב: ${computeEffectiveHourlyRateForMonth(new Date().getFullYear(), new Date().getMonth(), settings).toFixed(2)} ₪`
                  : `${settings.hourly_rate.toFixed(2)} ₪ לשעה`
              }
              onClick={() => {
                const neverConfigured = settings.salary_mode !== "cap" && settings.hourly_rate <= 0;
                if (neverConfigured) return openRateDialog();
                openView(
                  settings.salary_mode === "cap" ? "תקרת שכר" : "שכר שעתי",
                  "payments",
                  settings.salary_mode === "cap"
                    ? [
                        { label: "מצב", value: "תקרת שכר חודשית" },
                        { label: "תקרה חודשית", value: `${(settings.salary_cap_amount ?? 0).toFixed(0)} ₪` },
                        {
                          label: "שכר שעתי מחושב (החודש)",
                          value: `${computeEffectiveHourlyRateForMonth(new Date().getFullYear(), new Date().getMonth(), settings).toFixed(2)} ₪`,
                        },
                      ]
                    : [
                        { label: "מצב", value: "שעתי קבוע" },
                        { label: "שכר שעתי", value: `${settings.hourly_rate.toFixed(2)} ₪` },
                      ],
                  openRateDialog,
                );
              }}
            />
            <Row
              title="מדרגות שעות נוספות"
              value={
                settings.overtime_tiers && settings.overtime_tiers.length
                  ? settings.overtime_tiers
                      .map((t, i) => `שעה ${i + 1}: ${t.rateType === "percent" ? `${t.rateValue}%` : `${t.rateValue}₪`}`)
                      .join(" · ")
                  : "לא הוגדרו מדרגות"
              }
              onClick={() =>
                openView(
                  "מדרגות שעות נוספות",
                  "timer",
                  [
                    ...((settings.overtime_tiers || []).map((t, i) => ({
                      label: `שעה ${i + 1}`,
                      value: t.rateType === "percent" ? `${t.rateValue}%` : `${t.rateValue} ₪`,
                    }))),
                    { label: "תשלום מהדקה הראשונה", value: settings.overtime_round_hours ? "כבוי (רק שעה עגולה)" : "פעיל" },
                  ],
                  openOvertimeDialog,
                )
              }
            />
            <Row
              title="תוספות לשכר"
              value={settings.fixed_components && settings.fixed_components.length ? `${settings.fixed_components.length} רכיבים · ${settings.fixed_components.reduce((s, c) => s + c.amount, 0).toFixed(0)} ₪` : "אין תוספות"}
              onClick={() => {
                if (!settings.fixed_components || settings.fixed_components.length === 0) return openComponentsDialog();
                openView(
                  "תוספות לשכר",
                  "add_card",
                  settings.fixed_components.map((c) => ({ label: c.label || "(ללא תיאור)", value: `${c.amount.toFixed(0)} ₪` })),
                  openComponentsDialog,
                );
              }}
            />
            {settings.fixed_components && settings.fixed_components.length > 0 && (
              <ToggleRow
                title="תוספות בתוך הברוטו"
                value={
                  (settings.fixed_components_in_gross ?? true)
                    ? "פעיל: הברוטו כולל את התוספות (נסיעות וכו')"
                    : "כבוי: הברוטו הוא שכר הבסיס בלבד, התוספות מוצגות בנפרד ומתווספות לסך הכולל"
                }
                on={settings.fixed_components_in_gross ?? true}
                onChange={(v) => persist({ ...settings, fixed_components_in_gross: v })}
              />
            )}
            <Row
              title="תוספות לניכויים"
              value={settings.deductions && settings.deductions.length ? `${settings.deductions.length} ניכויים · ${settings.deductions.reduce((s, d) => s + d.amount, 0).toFixed(0)} ₪` : "אין ניכויים"}
              onClick={() => {
                if (!settings.deductions || settings.deductions.length === 0) return openDeductionsDialog();
                openView(
                  "תוספות לניכויים",
                  "remove_shopping_cart",
                  settings.deductions.map((d) => ({ label: d.label || "(ללא תיאור)", value: `${d.amount.toFixed(0)} ₪` })),
                  openDeductionsDialog,
                );
              }}
            />
            <Row
              title="ניכויי חובה ופנסיה"
              value={(() => {
                const extras = [settings.pension_enabled && "פנסיה", settings.training_fund_enabled && "קרן השתלמות"].filter(Boolean).join(" + ");
                if ((settings.statutory_deduction_mode ?? "manual") === "automatic") {
                  return extras ? `אוטומטי · ${extras}` : "אוטומטי";
                }
                return `ידני · מס ${settings.manual_income_tax ?? 0}₪ · ב.ל׳ ${settings.manual_national_insurance ?? 0}₪ · בריאות ${settings.manual_health_insurance ?? 0}₪${extras ? ` · ${extras}` : ""}`;
              })()}
              onClick={() => {
                const mode = settings.statutory_deduction_mode ?? "manual";
                const rows: ViewRow[] =
                  mode === "automatic"
                    ? [
                        { label: "מצב", value: "אוטומטי (לפי מדרגות מס 2026)" },
                        { label: "נקודות זיכוי", value: String(settings.tax_credit_points ?? 2.25) },
                      ]
                    : [
                        { label: "מצב", value: "ידני" },
                        { label: "מס הכנסה", value: `${settings.manual_income_tax ?? 0} ₪` },
                        { label: "ביטוח לאומי", value: `${settings.manual_national_insurance ?? 0} ₪` },
                        { label: "ביטוח בריאות", value: `${settings.manual_health_insurance ?? 0} ₪` },
                      ];
                rows.push({
                  label: "פנסיה",
                  value: settings.pension_enabled ? `${settings.pension_employee_rate ?? 6}% · ${settings.pension_base_mode === "custom" ? "בסיס מותאם" : "כל השכר"}` : "כבוי",
                });
                rows.push({
                  label: "קרן השתלמות",
                  value: settings.training_fund_enabled ? `${settings.training_fund_employee_rate ?? 2.5}% · ${settings.training_fund_base_mode === "custom" ? "בסיס מותאם" : "כל השכר"}` : "כבוי",
                });
                openView("ניכויי חובה ופנסיה", "account_balance", rows, openStatutoryDialog);
              }}
            />
          </Section>

          <Section icon="restaurant" title="מצב אוכל">
            <Row
              title="מעקב הוצאות אוכל"
              value={
                settings.food_card_enabled
                  ? `פעיל · ${settings.food_card_has_card ? "כרטיס אוכל" : "מגולם בשכר"} · ${(settings.food_card_monthly_amount ?? 0).toFixed(0)} ₪ לחודש`
                  : "כבוי — הפעלה תוסיף אייקון פורטל אוכל בתפריט"
              }
              onClick={() => {
                if (!settings.food_card_enabled) return openFoodDialog();
                openView(
                  "מעקב הוצאות אוכל",
                  "restaurant",
                  [
                    { label: "סטטוס", value: "פעיל" },
                    { label: "אופן קבלת תקציב", value: settings.food_card_has_card ? "כרטיס אוכל (חיצוני לשכר)" : "מגולם בשכר" },
                    { label: "תקציב חודשי", value: `${(settings.food_card_monthly_amount ?? 0).toFixed(0)} ₪` },
                    { label: "תקרה יומית", value: settings.food_card_daily_cap ? `${settings.food_card_daily_cap.toFixed(0)} ₪` : "ללא תקרה" },
                  ],
                  openFoodDialog,
                );
              }}
            />
          </Section>

          <Section icon="timer" title="נוכחות">
            <Row
              title="לוח עבודה ושעות יעד"
              value={`${workDaysSummary()} · עד ${avgDailyTargetSummary()}`}
              onClick={() =>
                openView(
                  "לוח עבודה ושעות יעד",
                  "calendar_month",
                  days.map((d) => ({ label: d.label, value: settings.work_days[d.key] ? `${formatHM(settings.hours_per_day[d.key] || 0)} שעות` : "לא עובד" })),
                  openScheduleDialog,
                )
              }
            />
            <ToggleRow
              title="משמרת ערב"
              value={settings.evening_shift_enabled ? `פעיל: ${formatHM(settings.evening_shift_hours || 0)} שעות` : "כבוי"}
              on={!!settings.evening_shift_enabled}
              onChange={toggleEvening}
            />
            {settings.evening_shift_enabled && <Row title="שעות משמרת ערב" value={formatHM(settings.evening_shift_hours || 0)} onClick={openEveningDialog} />}
            <ToggleRow
              title="חישוב שעות נוספות"
              value={settings.overtime_calc_enabled ? "פעיל: מעל שעות היעד היומיות" : "כבוי"}
              on={!!settings.overtime_calc_enabled}
              onChange={toggleOvertime}
            />
            {settings.overtime_calc_enabled && (
              <ToggleRow
                title="תשלום שעות נוספות בתלוש הבא"
                value={
                  settings.overtime_payout_month === "next"
                    ? "פעיל: שעות נוספות מהחודש הזה משולמות בתלוש של החודש הבא"
                    : "כבוי: שעות נוספות משולמות באותו חודש שבו עבדת"
                }
                on={settings.overtime_payout_month === "next"}
                onChange={(v) => setOvertimePayoutMonth(v ? "next" : "current")}
              />
            )}
          </Section>

          <Section icon="beach_access" title="חופש ומחלה">
            <Row
              title="ימי חופש בשנה"
              value={`${settings.annual_vacation_days ?? 0} ימים · ${settings.vacation_accrual_method === "monthly" ? "מצטבר חודשי" : "הכל בבת אחת"}`}
              onClick={openLeaveDialog}
            />
            <Row
              title="ימי מחלה בשנה"
              value={`${settings.annual_sick_days ?? 0} ימים · ${settings.sick_accrual_method === "monthly" ? "מצטבר חודשי" : "הכל בבת אחת"}`}
              onClick={openLeaveDialog}
            />
            <Row
              title="תאריך תחילת עבודה"
              value={settings.employment_start_date ? new Date(`${settings.employment_start_date}T00:00:00`).toLocaleDateString("he-IL") : "לא הוגדר"}
              onClick={openLeaveDialog}
            />
          </Section>

          <Section icon="summarize" title="דוחות">
            <Row title="דוחות שנתיים" value="סיכום שכר נטו/ברוטו לפי שנה" onClick={() => setAnnualReportsOpen(true)} />
          </Section>

          {/* Backup & restore — always visible and dead simple, so switching phones is a 2-tap job */}
          <div
            className="lh-rise w-full rounded-[24px] p-6 flex flex-col gap-4 mb-10 relative overflow-hidden"
            style={{ background: `linear-gradient(155deg, ${LH.primary}0D, ${LH.secondary}0D)`, border: `1px solid ${LH.primary}1F` }}
          >
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0" style={{ background: `linear-gradient(155deg,#7639FF,#00D2FF)`, boxShadow: "0 10px 20px -6px rgba(118,57,255,0.4)" }}>
                <span className="material-symbols-outlined text-white">cloud_done</span>
              </div>
              <div>
                <h3 className="text-[16px] font-bold" style={{ color: LH.onSurface }}>גיבוי הנתונים שלי</h3>
                <p className="text-[12px]" style={{ color: LH.onSurfaceVariant }}>עוברים למכשיר חדש? שמרו קובץ אחד, והעלו אותו כאן במכשיר החדש — וזהו.</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button
                disabled={busy}
                onClick={handleExportBackup}
                className="h-12 rounded-2xl font-bold text-white flex items-center justify-center gap-2"
                style={{ background: "linear-gradient(155deg,#7639FF,#00D2FF)", boxShadow: "0 12px 24px -8px rgba(118,57,255,0.4)" }}
              >
                <span className="material-symbols-outlined text-[20px]">save</span>
                שמירת גיבוי
              </button>
              <button
                disabled={busy}
                onClick={() => restoreInputRef.current?.click()}
                className="h-12 rounded-2xl font-bold flex items-center justify-center gap-2"
                style={{ background: LH.surfaceContainerLowest, color: LH.primary, border: `1px solid ${LH.primary}33` }}
              >
                <span className="material-symbols-outlined text-[20px]">upload_file</span>
                שחזור מגיבוי
              </button>
            </div>
            <input
              ref={restoreInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleRestoreBackup(file);
              }}
            />
          </div>

          {/* Collapsible advanced import/export — closed by default */}
          <div className="w-full flex flex-col gap-4 mb-10">
            <button
              className="text-[18px] font-bold flex items-center justify-between gap-2 px-2 w-full"
              style={{ color: LH.primary }}
              onClick={() => setImportExportOpen((v) => !v)}
            >
              <span className="flex items-center gap-2">
                <span className="material-symbols-outlined" style={{ color: `${LH.primary}CC` }}>folder_zip</span>
                ייבוא וייצוא מתקדם
              </span>
              <span className="material-symbols-outlined transition-transform duration-300" style={{ transform: importExportOpen ? "rotate(90deg)" : "rotate(0deg)" }}>
                chevron_left
              </span>
            </button>
            {importExportOpen && (
              <div className="rounded-2xl overflow-hidden flex flex-col gap-4 p-4" style={{ background: LH.surfaceContainerLowest, boxShadow: "0 16px 45px rgba(35,50,100,0.03)" }}>
                <div className="flex gap-2">
                  <select
                    value={exportMonth}
                    onChange={(e) => setExportMonth(Number(e.target.value))}
                    style={{ ...dialogFieldStyle, flex: 1 }}
                  >
                    {Array.from({ length: 12 }, (_, i) => (
                      <option key={i} value={i}>{new Date(2000, i, 1).toLocaleDateString("he-IL", { month: "long" })}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    value={exportYear}
                    onChange={(e) => setExportYear(Number(e.target.value) || new Date().getFullYear())}
                    style={{ ...dialogFieldStyle, width: 100 }}
                  />
                </div>
                <button
                  disabled={busy}
                  onClick={handleExportReport}
                  className="w-full h-11 rounded-xl font-bold text-white flex items-center justify-center gap-2"
                  style={{ background: LH.primary }}
                >
                  <span className="material-symbols-outlined text-[18px]">picture_as_pdf</span>
                  תלוש חודשי (PDF) — {new Date(2000, exportMonth, 1).toLocaleDateString("he-IL", { month: "long" })} {exportYear}
                </button>
                <button
                  disabled={busy}
                  onClick={handleExportYearlyReport}
                  className="w-full h-11 rounded-xl font-bold flex items-center justify-center gap-2"
                  style={{ background: `${LH.primary}0F`, color: LH.primary }}
                >
                  <span className="material-symbols-outlined text-[18px]">summarize</span>
                  ריכוז כל התלושים של {exportYear} (PDF)
                </button>
                <p className="text-[11px]" style={{ color: LH.onSurfaceVariant }}>
                  מומלץ להוריד את הריכוז השנתי עד סוף ינואר של השנה שאחרי, לפני שעוברים לעקוב אחרי שנה חדשה. גיבוי ושחזור הנתונים המלאים נמצאים למעלה, בכרטיס "גיבוי הנתונים שלי".
                </p>
              </div>
            )}
          </div>

          <button
            onClick={async () => {
              await logoutLocalAuth();
              navigate("/design-preview/login");
            }}
            className="w-full h-12 rounded-2xl font-bold flex items-center justify-center gap-2 mb-10"
            style={{ background: `${LH.error}0D`, color: LH.error }}
          >
            <span className="material-symbols-outlined text-[18px]">logout</span>
            התנתקות
          </button>

          <div className="h-8" />
        </div>
      </main>
      <LHBottomNav active="settings" foodEnabled={!!settings.food_card_enabled} />

      {/* Name dialog */}
      <Dialog open={nameDialogOpen} onOpenChange={setNameDialogOpen}>
        <DialogContent className={dialogClassName} style={{ background: LH.background, fontFamily: "'Heebo', system-ui, sans-serif" }} dir="rtl">
          <DialogHeader>
            <DialogTitle style={{ color: LH.onSurface }}>עריכת שם</DialogTitle>
          </DialogHeader>
          <input value={nameInput} onChange={(e) => setNameInput(e.target.value)} style={dialogFieldStyle} placeholder="השם שלך" />
          <button onClick={saveName} className="w-full h-11 rounded-xl font-bold text-white mt-2" style={{ background: LH.primary }}>שמירה</button>
        </DialogContent>
      </Dialog>

      {/* Hourly rate / salary cap dialog */}
      <Dialog open={rateDialogOpen} onOpenChange={setRateDialogOpen}>
        <DialogContent className={dialogClassName} style={{ background: LH.background, fontFamily: "'Heebo', system-ui, sans-serif" }} dir="rtl">
          <DialogHeader>
            <DialogTitle style={{ color: LH.onSurface }}>שכר</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div>
              <label className="text-[11px] font-medium block mb-2" style={{ color: LH.onSurfaceVariant }}>איך מוגדר השכר?</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setSalaryModeDraft("hourly")}
                  className="h-11 rounded-xl font-bold text-[13px] transition-all"
                  style={salaryModeDraft === "hourly" ? { background: LH.primary, color: "#fff" } : { background: LH.surfaceContainer, color: LH.onSurfaceVariant }}
                >
                  שכר שעתי
                </button>
                <button
                  onClick={() => setSalaryModeDraft("cap")}
                  className="h-11 rounded-xl font-bold text-[13px] transition-all"
                  style={salaryModeDraft === "cap" ? { background: LH.primary, color: "#fff" } : { background: LH.surfaceContainer, color: LH.onSurfaceVariant }}
                >
                  תקרת שכר
                </button>
              </div>
            </div>
            {salaryModeDraft === "hourly" ? (
              <div>
                <label className="text-[11px] font-medium block mb-1" style={{ color: LH.onSurfaceVariant }}>שכר שעתי (₪)</label>
                <input type="number" step="0.5" value={zeroToEmpty(rateInput)} onChange={(e) => setRateInput(e.target.value)} style={dialogFieldStyle} placeholder="0" />
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <div>
                  <label className="text-[11px] font-medium block mb-1" style={{ color: LH.onSurfaceVariant }}>תקרת שכר חודשית (₪)</label>
                  <input type="number" step="10" value={zeroToEmpty(capAmountDraft)} onChange={(e) => setCapAmountDraft(e.target.value)} style={dialogFieldStyle} placeholder="0" />
                </div>
                <p className="text-[10.5px]" style={{ color: LH.onSurfaceVariant }}>
                  שעות רגילות לעולם לא יעברו את התקרה — רק שעות נוספות יכולות. השכר השעתי מחושב אוטומטית מדי חודש לפי התקרה חלקי סך שעות העבודה המתוכננות באותו חודש
                  {settings && (settings.hourly_rate || capAmountDraft) ? (
                    <>
                      {" "}(החודש הנוכחי: <span dir="ltr" style={{ fontWeight: 700, color: LH.onSurface }}>
                        {computeEffectiveHourlyRateForMonth(new Date().getFullYear(), new Date().getMonth(), {
                          ...settings,
                          salary_mode: "cap",
                          salary_cap_amount: parseFloat(capAmountDraft.replace(/[^0-9.]/g, "")) || 0,
                        }).toFixed(2)} ₪
                      </span>)
                    </>
                  ) : null}
                  .
                </p>
              </div>
            )}
          </div>
          <button onClick={saveRate} className="w-full h-11 rounded-xl font-bold text-white mt-2" style={{ background: LH.primary }}>שמירה</button>
        </DialogContent>
      </Dialog>

      {/* Generic read-only view for a setting — the row's own click opens this summary first; "עריכה" switches to the real editable dialog. */}
      <Dialog open={!!viewDialog} onOpenChange={(open) => !open && setViewDialog(null)}>
        <DialogContent className={dialogClassName} style={{ background: LH.background, fontFamily: "'Heebo', system-ui, sans-serif" }} dir="rtl">
          <DialogHeader>
            <DialogTitle style={{ color: LH.onSurface, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
              <span className="material-symbols-outlined" style={{ color: LH.primary }}>{viewDialog?.icon}</span>
              {viewDialog?.title}
            </DialogTitle>
          </DialogHeader>
          <div className="rounded-2xl overflow-hidden flex flex-col gap-[1px]" style={{ background: `${LH.surfaceVariant}4D` }}>
            {viewDialog?.rows.map((r, i) => (
              <div key={i} className="p-3.5 flex items-center justify-between" style={{ background: LH.surfaceContainerLowest }}>
                <span className="text-[13px]" style={{ color: LH.onSurfaceVariant }}>{r.label}</span>
                <span className="text-[14px] font-bold" style={{ color: LH.onSurface }}>{r.value}</span>
              </div>
            ))}
          </div>
          <button
            onClick={() => {
              const onEdit = viewDialog?.onEdit;
              setViewDialog(null);
              // Let the view dialog's close animation start before mounting the edit dialog —
              // opening both in the same tick left the edit dialog stuck at opacity 0.
              setTimeout(() => onEdit?.(), 0);
            }}
            className="w-full h-11 rounded-xl font-bold text-white mt-2 flex items-center justify-center gap-2"
            style={{ background: LH.primary }}
          >
            <span className="material-symbols-outlined text-[18px]">edit</span>
            עריכה
          </button>
        </DialogContent>
      </Dialog>

      {/* Evening shift hours dialog */}
      <Dialog open={eveningDialogOpen} onOpenChange={setEveningDialogOpen}>
        <DialogContent className={dialogClassName} style={{ background: LH.background, fontFamily: "'Heebo', system-ui, sans-serif" }} dir="rtl">
          <DialogHeader>
            <DialogTitle style={{ color: LH.onSurface }}>כמה שעות זו משמרת ערב</DialogTitle>
          </DialogHeader>
          <input type="number" step="0.5" value={eveningHoursInput} onChange={(e) => setEveningHoursInput(e.target.value)} style={dialogFieldStyle} placeholder="7" />
          <button onClick={saveEveningHours} className="w-full h-11 rounded-xl font-bold text-white mt-2" style={{ background: LH.primary }}>שמירה</button>
        </DialogContent>
      </Dialog>

      {/* Work schedule dialog */}
      <Dialog open={scheduleDialogOpen} onOpenChange={setScheduleDialogOpen}>
        <DialogContent className={dialogClassName} style={{ background: LH.background, fontFamily: "'Heebo', system-ui, sans-serif", maxHeight: "80vh", overflowY: "auto" }} dir="rtl">
          <DialogHeader>
            <DialogTitle style={{ color: LH.onSurface }}>לוח עבודה ושעות יעד</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2.5">
            {days.map((d) => (
              <div key={d.key} className="flex items-center justify-between gap-3 p-3 rounded-2xl" style={{ background: workDaysDraft[d.key] ? `${LH.primary}0D` : `${LH.surfaceVariant}33` }}>
                <div className="flex items-center gap-3">
                  <Toggle on={!!workDaysDraft[d.key]} onChange={(v) => setWorkDaysDraft((prev) => ({ ...prev, [d.key]: v }))} />
                  <span className="text-[14px] font-medium" style={{ color: LH.onSurface }}>{d.label}</span>
                </div>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  max="24"
                  value={zeroToEmpty(hoursPerDayDraft[d.key] ?? 0)}
                  onChange={(e) => setHoursPerDayDraft((prev) => ({ ...prev, [d.key]: parseFloat(e.target.value) || 0 }))}
                  disabled={!workDaysDraft[d.key]}
                  placeholder="0"
                  style={{ ...dialogFieldStyle, width: 72, textAlign: "center", padding: "8px 6px" }}
                />
              </div>
            ))}
          </div>
          <button onClick={saveSchedule} className="w-full h-11 rounded-xl font-bold text-white mt-2" style={{ background: LH.primary }}>שמירה</button>
        </DialogContent>
      </Dialog>

      {/* Leave & sick settings dialog */}
      <Dialog open={leaveDialogOpen} onOpenChange={setLeaveDialogOpen}>
        <DialogContent className={dialogClassName} style={{ background: LH.background, fontFamily: "'Heebo', system-ui, sans-serif" }} dir="rtl">
          <DialogHeader>
            <DialogTitle style={{ color: LH.onSurface }}>חופש ומחלה</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div>
              <label className="text-[12px] font-medium block mb-1" style={{ color: LH.onSurfaceVariant }}>ימי חופש בשנה</label>
              <div className="flex gap-2">
                <input type="number" step="0.5" min="0" value={vacationDaysInput} onChange={(e) => setVacationDaysInput(e.target.value)} style={{ ...dialogFieldStyle, flex: 1 }} />
                <select value={vacationMethodDraft} onChange={(e) => setVacationMethodDraft(e.target.value as AccrualMethod)} style={{ ...dialogFieldStyle, flex: 1 }}>
                  <option value="lump_sum">הכל בבת אחת</option>
                  <option value="monthly">מצטבר חודשי</option>
                </select>
              </div>
            </div>
            <div>
              <label className="text-[12px] font-medium block mb-1" style={{ color: LH.onSurfaceVariant }}>ימי מחלה בשנה</label>
              <div className="flex gap-2">
                <input type="number" step="0.5" min="0" value={sickDaysInput} onChange={(e) => setSickDaysInput(e.target.value)} style={{ ...dialogFieldStyle, flex: 1 }} />
                <select value={sickMethodDraft} onChange={(e) => setSickMethodDraft(e.target.value as AccrualMethod)} style={{ ...dialogFieldStyle, flex: 1 }}>
                  <option value="lump_sum">הכל בבת אחת</option>
                  <option value="monthly">מצטבר חודשי</option>
                </select>
              </div>
            </div>
            <div>
              <label className="text-[12px] font-medium block mb-1" style={{ color: LH.onSurfaceVariant }}>תאריך תחילת עבודה (לחישוב יחסי בשנה הראשונה)</label>
              <input type="date" value={startDateDraft} onChange={(e) => setStartDateDraft(e.target.value)} style={dialogFieldStyle} />
            </div>
            <div className="pt-2" style={{ borderTop: `1px solid ${LH.surfaceVariant}` }}>
              <label className="text-[12px] font-medium block mb-1" style={{ color: LH.onSurfaceVariant }}>מינימום ימי חופש חובה בשנה</label>
              <input type="number" step="1" min="0" value={minVacationDraft} onChange={(e) => setMinVacationDraft(e.target.value)} style={dialogFieldStyle} />
              <p className="text-[11px] mt-1.5" style={{ color: LH.onSurfaceVariant }}>
                לפי חוק חופשה שנתית יש לנצל מספר ימי חופש מינימלי בכל שנה קלנדרית, גם אם נצברו יותר. 0 = ללא חובה.
                אם תחילת העבודה אמצע שנה, החובה מחושבת יחסית לחלק מהשנה שנותר.
              </p>
            </div>
            <p className="text-[11px] -mt-1" style={{ color: LH.onSurfaceVariant }}>
              היתרה המוצגת בדף הבית מצטברת משנה לשנה ולא מתאפסת בתחילת שנה קלנדרית — ימים שלא נוצלו ממשיכים להצטבר.
            </p>
          </div>
          <button onClick={saveLeave} className="w-full h-11 rounded-xl font-bold text-white mt-2" style={{ background: LH.primary }}>שמירה</button>
        </DialogContent>
      </Dialog>

      {/* Overtime tiers dialog */}
      <Dialog open={overtimeDialogOpen} onOpenChange={setOvertimeDialogOpen}>
        <DialogContent className={dialogClassName} style={{ background: LH.background, fontFamily: "'Heebo', system-ui, sans-serif", maxHeight: "85vh", overflowY: "auto" }} dir="rtl">
          <DialogHeader>
            <DialogTitle style={{ color: LH.onSurface }}>מדרגות שעות נוספות</DialogTitle>
          </DialogHeader>
          <p className="text-[12px]" style={{ color: LH.onSurfaceVariant }}>
            כל מדרגה קובעת את התעריף עבור שעת החריגה המקבילה מעבר ליעד היומי (שעה 1 = השעה הראשונה מעבר ליעד, וכן הלאה). אפשר להגדיר עד 5 מדרגות; מעבר לכך ממשיכים להשתלם לפי המדרגה האחרונה.
          </p>
          <div
            className="flex items-center justify-between p-3 rounded-2xl"
            style={{ background: `${LH.primary}08` }}
          >
            <div className="flex-1 pl-2">
              <p className="text-[13px] font-bold" style={{ color: LH.onSurface }}>תשלום מהדקה הראשונה</p>
              <p className="text-[11px]" style={{ color: LH.onSurfaceVariant }}>
                {roundHoursDraft
                  ? "כבוי: התוספת משולמת רק על שעה עגולה שהושלמה מעבר ליעד"
                  : "פעיל: התוספת נצברת יחסית כבר מהדקה הראשונה מעבר ליעד"}
              </p>
            </div>
            <Toggle on={!roundHoursDraft} onChange={(v) => setRoundHoursDraft(!v)} />
          </div>
          <div className="flex flex-col gap-3">
            {tiersDraft.map((tier, i) => (
              <div key={i} className="flex items-center gap-2 p-3 rounded-2xl" style={{ background: `${LH.primary}08` }}>
                <div className="flex flex-col gap-1 items-center justify-center shrink-0" style={{ width: 56 }}>
                  <label className="text-[10px] font-bold" style={{ color: LH.onSurfaceVariant }}>שעה</label>
                  <span className="text-[16px] font-extrabold" style={{ color: LH.primary }}>{i + 1}</span>
                </div>
                <div className="flex flex-col gap-1" style={{ width: 100 }}>
                  <label className="text-[10px] font-bold" style={{ color: LH.onSurfaceVariant }}>סוג</label>
                  <select
                    value={tier.rateType}
                    onChange={(e) => setTiersDraft((prev) => prev.map((t, idx) => (idx === i ? { ...t, rateType: e.target.value as "percent" | "fixed" } : t)))}
                    style={{ ...dialogFieldStyle, padding: "8px 10px" }}
                  >
                    <option value="percent">אחוז</option>
                    <option value="fixed">₪ קבוע</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1 flex-1">
                  <label className="text-[10px] font-bold" style={{ color: LH.onSurfaceVariant }}>{tier.rateType === "percent" ? "% מהשכר" : "₪ לשעה"}</label>
                  <input
                    type="number" step="1" min="0"
                    value={tier.rateValue}
                    onChange={(e) => setTiersDraft((prev) => prev.map((t, idx) => (idx === i ? { ...t, rateValue: parseFloat(e.target.value) || 0 } : t)))}
                    style={{ ...dialogFieldStyle, padding: "8px 10px" }}
                  />
                </div>
                <button onClick={() => removeTier(i)} className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: `${LH.error}14`, color: LH.error }}>
                  <span className="material-symbols-outlined text-[16px]">close</span>
                </button>
              </div>
            ))}
          </div>
          {tiersDraft.length < 5 && (
            <button onClick={addTier} className="w-full h-10 rounded-xl font-bold text-[13px] flex items-center justify-center gap-1" style={{ background: `${LH.primary}0D`, color: LH.primary }}>
              <span className="material-symbols-outlined text-[16px]">add</span>
              הוספת מדרגה
            </button>
          )}
          <button onClick={saveOvertime} className="w-full h-11 rounded-xl font-bold text-white mt-2" style={{ background: LH.primary }}>שמירה</button>
        </DialogContent>
      </Dialog>

      {/* Fixed components dialog */}
      <Dialog open={componentsDialogOpen} onOpenChange={setComponentsDialogOpen}>
        <DialogContent className={dialogClassName} style={{ background: LH.background, fontFamily: "'Heebo', system-ui, sans-serif", maxHeight: "85vh", overflowY: "auto" }} dir="rtl">
          <DialogHeader>
            <DialogTitle style={{ color: LH.onSurface }}>תוספות לשכר</DialogTitle>
          </DialogHeader>
          <p className="text-[12px]" style={{ color: LH.onSurfaceVariant }}>סכומים קבועים שמתווספים לדוח השכר של כל חודש (למשל נסיעות, בונוס קבוע).</p>
          <div className="flex flex-col gap-2">
            {componentsDraft.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <input placeholder="תיאור" value={c.label} onChange={(e) => setComponentsDraft((prev) => prev.map((x, idx) => (idx === i ? { ...x, label: e.target.value } : x)))} style={{ ...dialogFieldStyle, flex: 2 }} />
                <input type="number" placeholder="₪" value={zeroToEmpty(c.amount)} onChange={(e) => setComponentsDraft((prev) => prev.map((x, idx) => (idx === i ? { ...x, amount: parseFloat(e.target.value) || 0 } : x)))} style={{ ...dialogFieldStyle, flex: 1 }} />
                <button onClick={() => setComponentsDraft((prev) => prev.filter((_, idx) => idx !== i))} className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: `${LH.error}14`, color: LH.error }}>
                  <span className="material-symbols-outlined text-[16px]">close</span>
                </button>
              </div>
            ))}
          </div>
          <button onClick={() => setComponentsDraft((prev) => [...prev, { label: "", amount: 0 }])} className="w-full h-10 rounded-xl font-bold text-[13px] flex items-center justify-center gap-1" style={{ background: `${LH.primary}0D`, color: LH.primary }}>
            <span className="material-symbols-outlined text-[16px]">add</span>
            הוספת רכיב
          </button>
          <button onClick={saveComponents} className="w-full h-11 rounded-xl font-bold text-white mt-2" style={{ background: LH.primary }}>שמירה</button>
        </DialogContent>
      </Dialog>

      {/* Deductions dialog */}
      <Dialog open={deductionsDialogOpen} onOpenChange={setDeductionsDialogOpen}>
        <DialogContent className={dialogClassName} style={{ background: LH.background, fontFamily: "'Heebo', system-ui, sans-serif", maxHeight: "85vh", overflowY: "auto" }} dir="rtl">
          <DialogHeader>
            <DialogTitle style={{ color: LH.onSurface }}>תוספות לניכויים</DialogTitle>
          </DialogHeader>
          <p className="text-[12px]" style={{ color: LH.onSurfaceVariant }}>סכום בודד או כמה סכומים מפורטים שיורדו מדוח השכר של כל חודש.</p>
          <div className="flex flex-col gap-2">
            {deductionsDraft.map((d, i) => (
              <div key={i} className="flex items-center gap-2">
                <input placeholder="תיאור (למשל: ביטוח)" value={d.label} onChange={(e) => setDeductionsDraft((prev) => prev.map((x, idx) => (idx === i ? { ...x, label: e.target.value } : x)))} style={{ ...dialogFieldStyle, flex: 2 }} />
                <input type="number" placeholder="₪" value={zeroToEmpty(d.amount)} onChange={(e) => setDeductionsDraft((prev) => prev.map((x, idx) => (idx === i ? { ...x, amount: parseFloat(e.target.value) || 0 } : x)))} style={{ ...dialogFieldStyle, flex: 1 }} />
                <button onClick={() => setDeductionsDraft((prev) => prev.filter((_, idx) => idx !== i))} className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: `${LH.error}14`, color: LH.error }}>
                  <span className="material-symbols-outlined text-[16px]">close</span>
                </button>
              </div>
            ))}
          </div>
          <button onClick={() => setDeductionsDraft((prev) => [...prev, { label: "", amount: 0 }])} className="w-full h-10 rounded-xl font-bold text-[13px] flex items-center justify-center gap-1" style={{ background: `${LH.primary}0D`, color: LH.primary }}>
            <span className="material-symbols-outlined text-[16px]">add</span>
            הוספת ניכוי
          </button>
          <button onClick={saveDeductions} className="w-full h-11 rounded-xl font-bold text-white mt-2" style={{ background: LH.primary }}>שמירה</button>
        </DialogContent>
      </Dialog>

      {/* Statutory deductions + pension/training-fund dialog */}
      <Dialog open={statutoryDialogOpen} onOpenChange={setStatutoryDialogOpen}>
        <DialogContent className={dialogClassName} style={{ background: LH.background, fontFamily: "'Heebo', system-ui, sans-serif", maxHeight: "85vh", overflowY: "auto" }} dir="rtl">
          <DialogHeader>
            <DialogTitle style={{ color: LH.onSurface }}>ניכויי חובה ופנסיה</DialogTitle>
          </DialogHeader>

          <div className="flex gap-2">
            {(["manual", "automatic"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setStatutoryModeDraft(m)}
                className="flex-1 h-10 rounded-xl text-[13px] font-bold transition-colors"
                style={{ background: statutoryModeDraft === m ? LH.primary : `${LH.primary}0D`, color: statutoryModeDraft === m ? "#fff" : LH.primary }}
              >
                {m === "manual" ? "ידני" : "אוטומטי (לפי מדרגות מס 2026)"}
              </button>
            ))}
          </div>
          <p className="text-[11px]" style={{ color: LH.onSurfaceVariant }}>
            {statutoryModeDraft === "automatic"
              ? "מס הכנסה, ביטוח לאומי וביטוח בריאות יחושבו אוטומטית לפי מדרגות המס הרשמיות, על השכר המצטבר בפועל עד כה החודש."
              : "מס הכנסה, ביטוח לאומי וביטוח בריאות יהיו בדיוק הסכומים הקבועים שתזין כאן, בלי חישוב אוטומטי."}
          </p>

          {statutoryModeDraft === "automatic" ? (
            <div>
              <label className="text-[12px] font-medium block mb-1" style={{ color: LH.onSurfaceVariant }}>נקודות זיכוי</label>
              <div className="flex gap-2">
                <input type="number" step="0.25" min="0" value={taxCreditPointsDraft} onChange={(e) => setTaxCreditPointsDraft(e.target.value)} style={{ ...dialogFieldStyle, flex: 1 }} />
                <button
                  type="button"
                  onClick={() => setCreditTableOpen((v) => !v)}
                  className="px-3 rounded-xl text-[12px] font-bold flex items-center gap-1 shrink-0"
                  style={{ background: `${LH.primary}0D`, color: LH.primary }}
                >
                  מה מתאים לי?
                  <span className="material-symbols-outlined text-[16px] transition-transform duration-300" style={{ transform: creditTableOpen ? "rotate(180deg)" : "none" }}>
                    expand_more
                  </span>
                </button>
              </div>

              {creditTableOpen && (
                <div className="mt-3 rounded-2xl p-3 flex flex-col gap-1" style={{ background: `${LH.primary}08`, border: `1px solid ${LH.primary}1A` }}>
                  <p className="text-[10.5px] mb-1" style={{ color: LH.onSurfaceVariant }}>
                    הערכים להתמצאות כללית בלבד ואינם ייעוץ מס — יש לוודא את המספר הסופי מול תלוש שכר רשמי או טופס 101.
                  </p>
                  {CREDIT_POINT_CATEGORIES.map((cat) => {
                    const checked = selectedCreditCategories.includes(cat.id);
                    return (
                      <label key={cat.id} className="flex items-center gap-2.5 py-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            setSelectedCreditCategories((prev) => (e.target.checked ? [...prev, cat.id] : prev.filter((id) => id !== cat.id)));
                          }}
                          className="w-4 h-4 accent-[#7639FF] shrink-0"
                        />
                        <div className="flex-1">
                          <div className="flex items-center justify-between">
                            <span className="text-[12.5px] font-bold" style={{ color: LH.onSurface }}>{cat.label}</span>
                            <span className="text-[12px] font-bold tabular-nums" style={{ color: LH.primary }}>+{cat.points}</span>
                          </div>
                          <p className="text-[10.5px]" style={{ color: LH.onSurfaceVariant }}>{cat.description}</p>
                        </div>
                      </label>
                    );
                  })}
                  <div className="flex items-center justify-between pt-2 mt-1" style={{ borderTop: `1px solid ${LH.primary}1A` }}>
                    <span className="text-[12px] font-bold" style={{ color: LH.onSurface }}>
                      סה"כ מסומן: {(BASE_CREDIT_POINTS + selectedCreditCategories.reduce((s, id) => s + (CREDIT_POINT_CATEGORIES.find((c) => c.id === id)?.points || 0), 0)).toFixed(2)}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setTaxCreditPointsDraft(
                          String(BASE_CREDIT_POINTS + selectedCreditCategories.reduce((s, id) => s + (CREDIT_POINT_CATEGORIES.find((c) => c.id === id)?.points || 0), 0)),
                        )
                      }
                      className="px-3 h-8 rounded-lg text-[11px] font-bold text-white"
                      style={{ background: LH.primary }}
                    >
                      החל סכום זה
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div>
                <label className="text-[12px] font-medium block mb-1" style={{ color: LH.onSurfaceVariant }}>מס הכנסה (₪)</label>
                <input type="number" value={zeroToEmpty(manualIncomeTaxDraft)} onChange={(e) => setManualIncomeTaxDraft(e.target.value)} style={dialogFieldStyle} placeholder="0" />
              </div>
              <div>
                <label className="text-[12px] font-medium block mb-1" style={{ color: LH.onSurfaceVariant }}>ביטוח לאומי (₪)</label>
                <input type="number" value={zeroToEmpty(manualNIDraft)} onChange={(e) => setManualNIDraft(e.target.value)} style={dialogFieldStyle} placeholder="0" />
              </div>
              <div>
                <label className="text-[12px] font-medium block mb-1" style={{ color: LH.onSurfaceVariant }}>ביטוח בריאות (₪)</label>
                <input type="number" value={zeroToEmpty(manualHealthDraft)} onChange={(e) => setManualHealthDraft(e.target.value)} style={dialogFieldStyle} placeholder="0" />
              </div>
            </div>
          )}

          <div className="pt-3 flex flex-col gap-3" style={{ borderTop: `1px solid ${LH.surfaceVariant}` }}>
            <label className="flex items-center justify-between gap-2">
              <span className="text-[14px] font-medium" style={{ color: LH.onSurface }}>הפרשת עובד לפנסיה</span>
              <Toggle on={pensionEnabledDraft} onChange={setPensionEnabledDraft} />
            </label>
            {pensionEnabledDraft && (
              <div className="flex gap-2">
                <div style={{ flex: 1 }}>
                  <label className="text-[11px] font-medium block mb-1" style={{ color: LH.onSurfaceVariant }}>אחוז מהשכר</label>
                  <input type="number" step="0.5" value={pensionRateDraft} onChange={(e) => setPensionRateDraft(e.target.value)} style={dialogFieldStyle} />
                </div>
                <div style={{ flex: 1 }}>
                  <label className="text-[11px] font-medium block mb-1" style={{ color: LH.onSurfaceVariant }}>בסיס שכר</label>
                  <select value={pensionBaseModeDraft} onChange={(e) => setPensionBaseModeDraft(e.target.value as "full" | "custom")} style={dialogFieldStyle}>
                    <option value="full">כל השכר</option>
                    <option value="custom">סכום מותאם</option>
                  </select>
                </div>
              </div>
            )}
            {pensionEnabledDraft && pensionBaseModeDraft === "custom" && (
              <div>
                <label className="text-[11px] font-medium block mb-1" style={{ color: LH.onSurfaceVariant }}>סכום בסיס לפנסיה (₪)</label>
                <input type="number" value={zeroToEmpty(pensionCustomBaseDraft)} onChange={(e) => setPensionCustomBaseDraft(e.target.value)} style={dialogFieldStyle} placeholder="0" />
              </div>
            )}
          </div>

          <div className="pt-3 flex flex-col gap-3" style={{ borderTop: `1px solid ${LH.surfaceVariant}` }}>
            <label className="flex items-center justify-between gap-2">
              <span className="text-[14px] font-medium" style={{ color: LH.onSurface }}>קרן השתלמות</span>
              <Toggle on={tfEnabledDraft} onChange={setTfEnabledDraft} />
            </label>
            {tfEnabledDraft && (
              <div className="flex gap-2">
                <div style={{ flex: 1 }}>
                  <label className="text-[11px] font-medium block mb-1" style={{ color: LH.onSurfaceVariant }}>אחוז מהשכר</label>
                  <input type="number" step="0.5" value={tfRateDraft} onChange={(e) => setTfRateDraft(e.target.value)} style={dialogFieldStyle} />
                </div>
                <div style={{ flex: 1 }}>
                  <label className="text-[11px] font-medium block mb-1" style={{ color: LH.onSurfaceVariant }}>בסיס שכר</label>
                  <select value={tfBaseModeDraft} onChange={(e) => setTfBaseModeDraft(e.target.value as "full" | "custom")} style={dialogFieldStyle}>
                    <option value="full">כל השכר</option>
                    <option value="custom">סכום מותאם</option>
                  </select>
                </div>
              </div>
            )}
            {tfEnabledDraft && tfBaseModeDraft === "custom" && (
              <div>
                <label className="text-[11px] font-medium block mb-1" style={{ color: LH.onSurfaceVariant }}>סכום בסיס לקרן השתלמות (₪)</label>
                <input type="number" value={zeroToEmpty(tfCustomBaseDraft)} onChange={(e) => setTfCustomBaseDraft(e.target.value)} style={dialogFieldStyle} placeholder="0" />
              </div>
            )}
            <p className="text-[10.5px]" style={{ color: LH.onSurfaceVariant }}>
              התקרה החודשית לצבירה מוטבת מס בקרן השתלמות לשנת 2026 היא 15,712 ₪.
            </p>
          </div>

          <button onClick={saveStatutory} className="w-full h-11 rounded-xl font-bold text-white mt-2" style={{ background: LH.primary }}>שמירה</button>
        </DialogContent>
      </Dialog>

      <Dialog open={foodDialogOpen} onOpenChange={setFoodDialogOpen}>
        <DialogContent className={dialogClassName} style={{ background: LH.background, fontFamily: "'Heebo', system-ui, sans-serif" }} dir="rtl">
          <DialogHeader>
            <DialogTitle style={{ color: LH.onSurface }}>מצב מעקב אוכל</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 mt-2">
            <div className="p-3 rounded-xl flex gap-2" style={{ background: `${LH.tertiaryContainer}14` }}>
              <span className="material-symbols-outlined text-[18px] shrink-0" style={{ color: LH.tertiaryContainer }}>restaurant</span>
              <p className="text-[11.5px] leading-5" style={{ color: LH.onSurfaceVariant }}>
                הפעלת מצב אוכל פותחת פורטל מעקב הוצאות אוכל (אייקון המזלג בתפריט) ומסירה אוטומטית כל תוספת "אוכל"/"ארוחות" שהוגדרה ידנית ב"תוספות לשכר".
              </p>
            </div>
            <div>
              <label className="text-[11px] font-medium block mb-2" style={{ color: LH.onSurfaceVariant }}>איך מקבלים את תקציב האוכל?</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setFoodHasCardDraft(true)}
                  className="h-11 rounded-xl font-bold text-[13px] transition-all"
                  style={foodHasCardDraft ? { background: LH.primary, color: "#fff" } : { background: LH.surfaceContainer, color: LH.onSurfaceVariant }}
                >
                  כרטיס אוכל
                </button>
                <button
                  onClick={() => setFoodHasCardDraft(false)}
                  className="h-11 rounded-xl font-bold text-[13px] transition-all"
                  style={!foodHasCardDraft ? { background: LH.primary, color: "#fff" } : { background: LH.surfaceContainer, color: LH.onSurfaceVariant }}
                >
                  מגולם בשכר
                </button>
              </div>
              <p className="text-[10.5px] mt-1.5" style={{ color: LH.onSurfaceVariant }}>
                {foodHasCardDraft
                  ? "כרטיס פיזי: התקציב חיצוני לגמרי ולא משפיע על השכר או הדוחות."
                  : "בלי כרטיס: הסכום נוסף כתוספת לשכר בדוחות, וכל הוצאת אוכל מדווחת יורדת מהשכר בפועל."}
              </p>
            </div>
            <div>
              <label className="text-[11px] font-medium block mb-1" style={{ color: LH.onSurfaceVariant }}>תקציב חודשי (₪)</label>
              <input type="number" value={zeroToEmpty(foodMonthlyDraft)} onChange={(e) => setFoodMonthlyDraft(e.target.value)} style={dialogFieldStyle} placeholder="0" />
            </div>
            <div>
              <label className="text-[11px] font-medium block mb-1" style={{ color: LH.onSurfaceVariant }}>תקרה יומית (₪, אופציונלי — 0 = אין תקרה)</label>
              <input type="number" value={zeroToEmpty(foodDailyCapDraft)} onChange={(e) => setFoodDailyCapDraft(e.target.value)} style={dialogFieldStyle} placeholder="0" />
            </div>
          </div>
          <button onClick={saveFoodSettings} className="w-full h-11 rounded-xl font-bold text-white mt-4" style={{ background: LH.primary }}>שמירה והפעלה</button>
          {settings?.food_card_enabled && (
            <button onClick={disableFoodTracking} className="w-full h-11 rounded-xl font-bold mt-2" style={{ background: `${LH.error}14`, color: LH.error }}>כיבוי מצב מעקב אוכל</button>
          )}
        </DialogContent>
      </Dialog>

      {/* Re-auth challenge before changing an already-configured PIN/security questions */}
      <Dialog open={recoveryChallengeOpen} onOpenChange={setRecoveryChallengeOpen}>
        <DialogContent className={dialogClassName} style={{ background: LH.background, fontFamily: "'Heebo', system-ui, sans-serif" }} dir="rtl">
          <DialogHeader>
            <DialogTitle style={{ color: LH.onSurface }}>אימות זהות</DialogTitle>
          </DialogHeader>
          <p className="text-[12px] -mt-2 mb-2" style={{ color: LH.onSurfaceVariant }}>כדי לשנות PIN ושאלות אבטחה קיימים, יש לענות קודם נכון על אחת משאלות האבטחה שכבר הגדרת.</p>
          <SecurityChallenge
            questionIds={recoveryChallengeQuestionIds}
            fieldStyle={dialogFieldStyle}
            onAttempt={recoveryChallengeAttempt}
            onSuccess={recoveryChallengeSuccess}
            onLocked={() => void recoveryChallengeLocked()}
          />
        </DialogContent>
      </Dialog>

      {/* Set up (or replace) the PIN + 3 security questions */}
      <Dialog open={recoveryDialogOpen} onOpenChange={setRecoveryDialogOpen}>
        <DialogContent className={dialogClassName} style={{ background: LH.background, fontFamily: "'Heebo', system-ui, sans-serif", maxHeight: "85vh", overflowY: "auto" }} dir="rtl">
          <DialogHeader>
            <DialogTitle style={{ color: LH.onSurface }}>PIN שחזור ושאלות אבטחה</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <p className="text-[12px]" style={{ color: LH.onSurfaceVariant }}>אם תשכח/י את הסיסמה, תוכל/י לשחזר אותה עם ה-PIN והתשובות האלה — בלי צורך במייל.</p>
            <div>
              <label className="text-[11px] font-medium block mb-1" style={{ color: LH.onSurfaceVariant }}>PIN חדש (4-8 ספרות)</label>
              <input type="password" inputMode="numeric" maxLength={8} value={recoveryPinDraft} onChange={(e) => setRecoveryPinDraft(e.target.value)} style={dialogFieldStyle} />
            </div>
            <div>
              <label className="text-[11px] font-medium block mb-1" style={{ color: LH.onSurfaceVariant }}>אימות PIN</label>
              <input type="password" inputMode="numeric" maxLength={8} value={recoveryPinConfirmDraft} onChange={(e) => setRecoveryPinConfirmDraft(e.target.value)} style={dialogFieldStyle} />
            </div>
            {([0, 1, 2] as const).map((i) => (
              <div key={i} className="flex flex-col gap-1">
                <label className="text-[11px] font-medium" style={{ color: LH.onSurfaceVariant }}>{`שאלת אבטחה ${i + 1}`}</label>
                <select
                  value={recoveryQuestionIdsDraft[i]}
                  onChange={(e) =>
                    setRecoveryQuestionIdsDraft((prev) => {
                      const next = [...prev] as typeof prev;
                      next[i] = e.target.value;
                      return next;
                    })
                  }
                  style={dialogFieldStyle}
                >
                  {SECURITY_QUESTIONS.filter((q) => q.id === recoveryQuestionIdsDraft[i] || !recoveryQuestionIdsDraft.includes(q.id)).map((q) => (
                    <option key={q.id} value={q.id}>{q.text}</option>
                  ))}
                </select>
                <input
                  type="text"
                  placeholder="התשובה שלך"
                  value={recoveryAnswersDraft[i]}
                  onChange={(e) =>
                    setRecoveryAnswersDraft((prev) => {
                      const next = [...prev] as typeof prev;
                      next[i] = e.target.value;
                      return next;
                    })
                  }
                  style={dialogFieldStyle}
                />
              </div>
            ))}
          </div>
          <button onClick={saveRecoveryDraft} className="w-full h-11 rounded-xl font-bold text-white mt-4" style={{ background: LH.primary }}>שמירה</button>
        </DialogContent>
      </Dialog>

      {/* Annual reports — summed live from the current data (not a frozen snapshot), so a later
          correction to a past month's hours is reflected here automatically. */}
      <Dialog open={annualReportsOpen} onOpenChange={setAnnualReportsOpen}>
        <DialogContent className={dialogClassName} style={{ background: LH.background, fontFamily: "'Heebo', system-ui, sans-serif", maxHeight: "85vh", overflowY: "auto" }} dir="rtl">
          <DialogHeader>
            <DialogTitle style={{ color: LH.onSurface }}>דוחות שנתיים</DialogTitle>
          </DialogHeader>
          {(() => {
            let totalGross = 0;
            let totalNet = 0;
            let totalDeductions = 0;
            let monthsWithData = 0;
            for (let m = 0; m < 12; m++) {
              const p = computeMonthlyPayroll(annualReportsYear, m, settings);
              if (p.regularHours === 0 && p.overtimeHours === 0 && p.fixedComponentsTotal === 0) continue;
              monthsWithData += 1;
              totalGross += p.regularPay + p.overtimePay + p.fixedComponentsTotal + p.foodAllowanceAddition;
              totalNet += p.netPay;
              totalDeductions += p.statutory.totalStatutoryDeductions + p.deductionsTotal;
            }
            return (
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-center gap-6">
                  <button onClick={() => setAnnualReportsYear((y) => y - 1)} style={{ color: LH.onSurfaceVariant }}>
                    <span className="material-symbols-outlined">chevron_right</span>
                  </button>
                  <span className="text-[17px] font-bold" style={{ color: LH.onSurface }}>{annualReportsYear}</span>
                  <button onClick={() => setAnnualReportsYear((y) => Math.min(new Date().getFullYear(), y + 1))} style={{ color: LH.onSurfaceVariant }}>
                    <span className="material-symbols-outlined">chevron_left</span>
                  </button>
                </div>

                {monthsWithData === 0 ? (
                  <p className="text-[13px] text-center" style={{ color: LH.onSurfaceVariant }}>אין נתונים רשומים לשנת {annualReportsYear}.</p>
                ) : (
                  <>
                    <div className="rounded-2xl p-5" style={{ background: LH.primary }}>
                      <span className="text-[10.5px] font-bold uppercase tracking-[0.08em] block mb-1" style={{ color: "rgba(255,255,255,0.65)" }}>סה״כ נטו לשנה</span>
                      <span dir="ltr" className="tabular-nums block" style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 28, fontWeight: 800, color: "#fff" }}>₪{Math.round(totalNet).toLocaleString("he-IL")}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-2xl p-4" style={{ background: LH.surfaceContainerLow }}>
                        <span className="text-[10px] font-bold uppercase tracking-[0.08em] block mb-1" style={{ color: LH.onSurfaceVariant }}>סה״כ ברוטו</span>
                        <span dir="ltr" className="tabular-nums block" style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 17, fontWeight: 800, color: LH.onSurface }}>₪{Math.round(totalGross).toLocaleString("he-IL")}</span>
                      </div>
                      <div className="rounded-2xl p-4" style={{ background: "rgba(220,38,38,0.06)" }}>
                        <span className="text-[10px] font-bold uppercase tracking-[0.08em] block mb-1" style={{ color: "#DC2626" }}>סה״כ ניכויים</span>
                        <span dir="ltr" className="tabular-nums block" style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 17, fontWeight: 800, color: "#DC2626" }}>₪{Math.round(totalDeductions).toLocaleString("he-IL")}</span>
                      </div>
                    </div>
                    <span className="text-[11px]" style={{ color: LH.onSurfaceVariant }}>{monthsWithData} חודשים עם נתונים</span>
                    <button
                      onClick={async () => {
                        const ok = await exportAnnualPayslipPdf(annualReportsYear, settings, firstName);
                        if (!ok) toast.error(`אין נתונים לשנת ${annualReportsYear}`);
                      }}
                      className="w-full h-11 rounded-xl font-bold text-white flex items-center justify-center gap-2"
                      style={{ background: LH.primary }}
                    >
                      <span className="material-symbols-outlined text-[18px]">download</span>
                      הורדת תלוש שנתי PDF
                    </button>
                  </>
                )}
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
