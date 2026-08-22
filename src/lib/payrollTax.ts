/**
 * Israeli statutory payroll calculations (income tax, National Insurance, Health Insurance,
 * pension, Keren Hishtalmut) — progressive/marginal, never cliff-based. All legal rates and
 * thresholds live in PAYROLL_RULES, versioned by year, so a new tax year never requires touching
 * the calculation functions themselves.
 *
 * Source policy: only official sources (Israel Tax Authority / gov.il, National Insurance
 * Institute / btl.gov.il). Do not update these numbers from anywhere else.
 */

export interface TaxBracket {
  from: number;
  /** null = no upper bound (top bracket). */
  to: number | null;
  rate: number;
}

export interface PayrollRuleSet {
  year: number;
  effectiveFrom: string;
  source: string;
  lastVerifiedAt: string;
  /** Monthly brackets. */
  incomeTaxBrackets: TaxBracket[];
  taxCreditPointValue: number;
  nationalInsurance: { reducedThreshold: number; ceiling: number; reducedRate: number; fullRate: number };
  healthInsurance: { reducedThreshold: number; ceiling: number; reducedRate: number; fullRate: number };
  trainingFund: { monthlyCeiling: number; annualCeiling: number; defaultEmployeeRate: number };
  pension: { defaultEmployeeRate: number };
  defaultTaxCreditPoints: number;
}

/**
 * 2026 values as validated in the spec this module was built against. The top bracket (above
 * ₪60,130) is modeled as a flat 50% (47% ordinary + the 3% statutory surtax portion) rather than
 * a precise annual-surtax reconciliation, which genuinely depends on annual income and is out of
 * scope for a monthly estimate — flagged here rather than silently approximated elsewhere.
 */
export const PAYROLL_RULES: Record<number, PayrollRuleSet> = {
  2026: {
    year: 2026,
    effectiveFrom: "2026-01-01",
    source: "Israel Tax Authority (gov.il) / National Insurance Institute (btl.gov.il)",
    lastVerifiedAt: "2026-01-01",
    incomeTaxBrackets: [
      { from: 0, to: 7010, rate: 0.10 },
      { from: 7010, to: 10060, rate: 0.14 },
      { from: 10060, to: 19000, rate: 0.20 },
      { from: 19000, to: 25100, rate: 0.31 },
      { from: 25100, to: 46690, rate: 0.35 },
      { from: 46690, to: 60130, rate: 0.47 },
      { from: 60130, to: null, rate: 0.50 },
    ],
    taxCreditPointValue: 242,
    nationalInsurance: { reducedThreshold: 7703, ceiling: 51910, reducedRate: 0.0104, fullRate: 0.07 },
    healthInsurance: { reducedThreshold: 7703, ceiling: 51910, reducedRate: 0.0323, fullRate: 0.0517 },
    trainingFund: { monthlyCeiling: 15712, annualCeiling: 188544, defaultEmployeeRate: 0.025 },
    pension: { defaultEmployeeRate: 0.06 },
    defaultTaxCreditPoints: 2.25,
  },
};

export const getPayrollRules = (year: number): PayrollRuleSet => {
  if (PAYROLL_RULES[year]) return PAYROLL_RULES[year];
  const latestYear = Math.max(...Object.keys(PAYROLL_RULES).map(Number));
  return PAYROLL_RULES[latestYear];
};

/** Pure marginal-bracket tax — only the slice of income inside each bracket is taxed at that rate. */
export const calculateProgressiveTax = (taxableIncome: number, brackets: TaxBracket[]): number => {
  let tax = 0;
  for (const b of brackets) {
    const to = b.to ?? Infinity;
    const taxablePart = Math.max(Math.min(taxableIncome, to) - b.from, 0);
    tax += taxablePart * b.rate;
  }
  return tax;
};

export const calculateIncomeTax = (
  taxableIncome: number,
  taxCreditPoints: number,
  year = new Date().getFullYear(),
): { grossTax: number; credit: number; incomeTax: number } => {
  const rules = getPayrollRules(year);
  const grossTax = calculateProgressiveTax(taxableIncome, rules.incomeTaxBrackets);
  const credit = taxCreditPoints * rules.taxCreditPointValue;
  return { grossTax, credit, incomeTax: Math.max(grossTax - credit, 0) };
};

/** Employee share only — reduced rate up to the threshold, full rate up to the ceiling, nothing above it. */
export const calculateNationalInsurance = (income: number, year = new Date().getFullYear()): number => {
  const r = getPayrollRules(year).nationalInsurance;
  const lower = Math.min(income, r.reducedThreshold) * r.reducedRate;
  const upper = Math.max(Math.min(income, r.ceiling) - r.reducedThreshold, 0) * r.fullRate;
  return lower + upper;
};

/** Employee share only — same threshold/ceiling structure as National Insurance, different rates. */
export const calculateHealthInsurance = (income: number, year = new Date().getFullYear()): number => {
  const r = getPayrollRules(year).healthInsurance;
  const lower = Math.min(income, r.reducedThreshold) * r.reducedRate;
  const upper = Math.max(Math.min(income, r.ceiling) - r.reducedThreshold, 0) * r.fullRate;
  return lower + upper;
};

export interface StatutoryPayrollInput {
  taxCreditPoints: number;
  /** "automatic" computes income tax / National Insurance / Health Insurance from the bracket
   * tables; "manual" uses the fixed amounts the user entered instead. Pension and Keren
   * Hishtalmut are governed separately by their own `enabled` flags below regardless of this mode. */
  deductionMode: "automatic" | "manual";
  manualIncomeTax?: number;
  manualNationalInsurance?: number;
  manualHealthInsurance?: number;

  pensionEnabled: boolean;
  pensionEmployeeRate: number; // 0..1
  pensionableBase: "full" | "custom";
  pensionableCustomAmount?: number;

  trainingFundEnabled: boolean;
  trainingFundEmployeeRate: number; // 0..1
  trainingFundBase: "full" | "custom";
  trainingFundCustomAmount?: number;
}

export interface StatutoryPayrollResult {
  grossForTax: number;
  incomeTaxGross: number;
  taxCredit: number;
  incomeTax: number;
  nationalInsurance: number;
  healthInsurance: number;
  pensionEmployee: number;
  trainingFundEmployee: number;
  totalStatutoryDeductions: number;
}

/**
 * Recalculates every statutory deduction from the FULL cumulative monthly gross — this is the
 * live-and-cumulative behavior the product requires. Never call this per-day; always pass the
 * month's running total so far.
 *
 * Pension's Section 45A income-tax credit is intentionally NOT modeled (no reduction to
 * `incomeTax` from pension contributions) — the exact statutory limits depend on annual
 * qualifying-income ceilings this module doesn't yet have verified official figures for.
 * Producing an approximate number here would be worse than omitting it.
 */
export const calculateStatutoryPayroll = (
  grossForTax: number,
  input: StatutoryPayrollInput,
  year = new Date().getFullYear(),
): StatutoryPayrollResult => {
  let incomeTaxGross = 0;
  let taxCredit = 0;
  let incomeTax = 0;
  let nationalInsurance = 0;
  let healthInsurance = 0;

  if (input.deductionMode === "manual") {
    incomeTax = input.manualIncomeTax || 0;
    nationalInsurance = input.manualNationalInsurance || 0;
    healthInsurance = input.manualHealthInsurance || 0;
  } else {
    const it = calculateIncomeTax(grossForTax, input.taxCreditPoints, year);
    incomeTaxGross = it.grossTax;
    taxCredit = it.credit;
    incomeTax = it.incomeTax;
    nationalInsurance = calculateNationalInsurance(grossForTax, year);
    healthInsurance = calculateHealthInsurance(grossForTax, year);
  }

  const rules = getPayrollRules(year);

  const pensionBase = input.pensionEnabled ? (input.pensionableBase === "custom" ? input.pensionableCustomAmount || 0 : grossForTax) : 0;
  const pensionEmployee = input.pensionEnabled ? pensionBase * (input.pensionEmployeeRate || 0) : 0;

  const trainingFundBaseRaw = input.trainingFundEnabled
    ? input.trainingFundBase === "custom"
      ? input.trainingFundCustomAmount || 0
      : grossForTax
    : 0;
  // The tax-favored contribution structure only applies up to the statutory monthly ceiling —
  // capping the base here reflects that, rather than letting the employee rate apply unbounded.
  const trainingFundBase = Math.min(trainingFundBaseRaw, rules.trainingFund.monthlyCeiling);
  const trainingFundEmployee = input.trainingFundEnabled ? trainingFundBase * (input.trainingFundEmployeeRate || 0) : 0;

  const totalStatutoryDeductions = incomeTax + nationalInsurance + healthInsurance + pensionEmployee + trainingFundEmployee;

  return {
    grossForTax,
    incomeTaxGross,
    taxCredit,
    incomeTax,
    nationalInsurance,
    healthInsurance,
    pensionEmployee,
    trainingFundEmployee,
    totalStatutoryDeductions,
  };
};

/** Which income-tax bracket a shekel of income at `grossForTax` currently falls in (the marginal rate), for display. */
export const getCurrentMarginalRate = (grossForTax: number, year = new Date().getFullYear()): number => {
  const brackets = getPayrollRules(year).incomeTaxBrackets;
  for (let i = brackets.length - 1; i >= 0; i--) {
    if (grossForTax > brackets[i].from) return brackets[i].rate;
  }
  return brackets[0]?.rate ?? 0;
};

/** Total income tax actually paid divided by gross — for display alongside the marginal rate (they are never the same number). */
export const getEffectiveTaxRate = (incomeTax: number, grossForTax: number): number => (grossForTax > 0 ? incomeTax / grossForTax : 0);
