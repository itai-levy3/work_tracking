import { FoodEntry } from "@/lib/localData";

export interface FoodMonthSummary {
  monthlyAllowance: number;
  /** Sum of what actually came out of the tracked budget (never more than the daily cap per entry). */
  spentFromCard: number;
  /** Sum of what the employee paid personally, on top of the card, when a purchase exceeded the daily cap. */
  personalTopUpTotal: number;
  remaining: number;
  entries: FoodEntry[];
}

export const computeFoodMonthSummary = (entries: FoodEntry[], monthlyAllowance: number): FoodMonthSummary => {
  const spentFromCard = entries.reduce((s, e) => s + e.cardAmount, 0);
  const personalTopUpTotal = entries.reduce((s, e) => s + (e.personalTopUp || 0), 0);
  return { monthlyAllowance, spentFromCard, personalTopUpTotal, remaining: monthlyAllowance - spentFromCard, entries };
};

export interface DailyCapCheck {
  /** Total real spend today so far (card + personal top-ups), before this new entry. */
  todaySpentSoFar: number;
  /** null = no daily cap configured. */
  remainingDailyCap: number | null;
  /** How much of the requested amount would exceed today's remaining cap (0 = fits fine). */
  exceedsCapBy: number;
}

/** Checks a new expense against today's remaining daily cap, before it's actually recorded. */
export const checkDailyCap = (entriesToday: FoodEntry[], requestedAmount: number, dailyCap: number | undefined): DailyCapCheck => {
  const todaySpentSoFar = entriesToday.reduce((s, e) => s + e.cardAmount + (e.personalTopUp || 0), 0);
  if (!dailyCap || dailyCap <= 0) {
    return { todaySpentSoFar, remainingDailyCap: null, exceedsCapBy: 0 };
  }
  const remainingDailyCap = Math.max(0, dailyCap - todaySpentSoFar);
  const exceedsCapBy = Math.max(0, requestedAmount - remainingDailyCap);
  return { todaySpentSoFar, remainingDailyCap, exceedsCapBy };
};

/** Splits a requested amount into what the card actually covers vs. what the employee tops up personally. */
export const splitByDailyCap = (requestedAmount: number, check: DailyCapCheck): { cardAmount: number; personalTopUp: number } => {
  if (check.remainingDailyCap === null) return { cardAmount: requestedAmount, personalTopUp: 0 };
  const cardAmount = Math.min(requestedAmount, check.remainingDailyCap);
  return { cardAmount, personalTopUp: requestedAmount - cardAmount };
};
