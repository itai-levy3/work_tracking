import { supabase } from "@/lib/supabaseClient";

/**
 * PIN + security-question account recovery — replaces email-link password reset entirely, so
 * resetting a forgotten password never depends on an email actually arriving. The real password
 * change for a signed-out user can only happen inside the "account-recovery" Edge Function (see
 * supabase/functions/account-recovery/index.ts), which alone holds the service_role key; this
 * module only ever sends hashes over the wire, never the raw PIN/answers/password.
 */

export interface SecurityQuestion {
  id: string;
  text: string;
}

export const SECURITY_QUESTIONS: SecurityQuestion[] = [
  { id: "childhood_nickname", text: "מה היה הכינוי הראשון שנתנו לך בילדות?" },
  { id: "first_street", text: "מה היה שם הרחוב הראשון שאתה זוכר שגרת בו?" },
  { id: "childhood_favorite_dish", text: "מה הייתה המנה האהובה עליך כשהיית ילד/ה?" },
  { id: "memorable_teacher", text: "מה היה שם המורה הראשון/ה שאתה זוכר במיוחד?" },
  { id: "first_movie", text: "מה היה הסרט הראשון שאתה זוכר שראית בקולנוע?" },
  { id: "first_family_pet", text: "מה היה שם חיית המחמד הראשונה שהייתה במשפחה?" },
  { id: "first_meaningful_gift", text: "מה הייתה המתנה המשמעותית הראשונה שקיבלת?" },
  { id: "anticipated_dish", text: "איזה מאכל מיוחד אתה תמיד מחכה שיהיה על השולחן?" },
  { id: "first_travel_destination", text: "מה היה היעד הראשון שאתה זוכר שטיילת אליו?" },
  { id: "first_job", text: "מה הייתה העבודה הראשונה שלך, או התפקיד הראשון שעשית באופן קבוע?" },
  { id: "favorite_school_subject", text: "מה היה המקצוע האהוב עליך בבית הספר?" },
  { id: "favorite_first_book", text: "מה היה שם הספר הראשון שאתה זוכר שאהבת במיוחד?" },
  { id: "first_childhood_friend", text: "מה היה שם החבר או החברה הראשונים שאתה זוכר מהילדות?" },
  { id: "disliked_food", text: "איזה מאכל אתה ממש לא אוהב מאז שאתה זוכר את עצמך?" },
  { id: "paternal_grandma_name", text: "מה שמה של סבתא שלך מצד אבא?" },
  { id: "maternal_cousins_count", text: "כמה בני דודים יש לך מצד אמא?" },
  { id: "oldest_cousin_name", text: "מה השם של בן או בת הדוד המבוגרים ביותר שלך?" },
  { id: "favorite_color", text: "מה הצבע האהוב עליך?" },
  { id: "favorite_animal", text: "מה החיה האהובה עליך?" },
  { id: "favorite_holiday", text: "מה החג האהוב עליך?" },
  { id: "favorite_season", text: "מה העונה האהובה עליך בשנה?" },
  { id: "favorite_childhood_tv_show", text: "מה הייתה תוכנית הטלוויזיה האהובה עליך בילדות?" },
  { id: "favorite_childhood_cartoon", text: "מה הייתה הדמות המצוירת האהובה עליך בילדות?" },
  { id: "favorite_childhood_candy", text: "מה היה הממתק האהוב עליך בילדות?" },
];

export const questionTextFor = (id: string): string => SECURITY_QUESTIONS.find((q) => q.id === id)?.text || id;

const normalize = (s: string) => s.trim().toLowerCase();

/** Salted with the (normalized) email so the same PIN/answer hashes differently per account. */
const hashRecoveryValue = async (value: string, email: string): Promise<string> => {
  const input = `${normalize(value)}::${normalize(email)}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

export interface SecurityAnswerInput {
  questionId: string;
  answer: string;
}

/** Set up (or replace) the current, already-authenticated user's PIN + 3 security questions. */
export const saveRecoverySetup = async (email: string, pin: string, answers: SecurityAnswerInput[]): Promise<void> => {
  const { data: auth } = await supabase.auth.getSession();
  const userId = auth.session?.user.id;
  if (!userId) throw new Error("NOT_AUTHENTICATED");
  const pinHash = await hashRecoveryValue(pin, email);
  const security_answers = await Promise.all(answers.map(async (a) => ({ questionId: a.questionId, hash: await hashRecoveryValue(a.answer, email) })));
  const { error } = await supabase
    .from("recovery_credentials")
    .upsert({ user_id: userId, email: normalize(email), pin_hash: pinHash, security_answers }, { onConflict: "user_id" });
  if (error) throw error;
};

export const hasRecoverySetup = async (): Promise<boolean> => {
  const { data: auth } = await supabase.auth.getSession();
  const userId = auth.session?.user.id;
  if (!userId) return false;
  const { data } = await supabase.from("recovery_credentials").select("user_id").eq("user_id", userId).maybeSingle();
  return !!data;
};

/** Unauthenticated step 1 of "forgot the PIN" — which 3 question ids this email chose. Also
 * used by the Settings "change PIN/questions" flow, since answering these same 3 questions is
 * how a signed-in user re-verifies ownership before replacing them. */
export const getRecoveryQuestionIds = async (email: string): Promise<string[] | null> => {
  const { data, error } = await supabase.functions.invoke("account-recovery", { body: { type: "get_questions", email } });
  if (error || !data?.ok) return null;
  return data.questionIds as string[];
};

/** Forgot password, but still remember the PIN — the PIN alone resets the login password. */
export const resetPasswordWithPin = async (email: string, pin: string, newPassword: string): Promise<{ ok: boolean; message?: string }> => {
  const pinHash = await hashRecoveryValue(pin, email);
  const { data, error } = await supabase.functions.invoke("account-recovery", {
    body: { type: "reset_password", email, pinHash, newPassword },
  });
  if (error) return { ok: false, message: "שגיאת תקשורת עם השרת" };
  return data as { ok: boolean; message?: string };
};

/** Forgot the PIN itself — the 3 security-question answers alone reset the PIN (the login
 * password is untouched; the user then uses the new PIN to reset the password as usual). */
export const resetPinWithSecurityAnswers = async (email: string, answers: SecurityAnswerInput[], newPin: string): Promise<{ ok: boolean; message?: string }> => {
  const answerHashes = await Promise.all(answers.map(async (a) => ({ questionId: a.questionId, hash: await hashRecoveryValue(a.answer, email) })));
  const newPinHash = await hashRecoveryValue(newPin, email);
  const { data, error } = await supabase.functions.invoke("account-recovery", {
    body: { type: "reset_pin", email, answerHashes, newPinHash },
  });
  if (error) return { ok: false, message: "שגיאת תקשורת עם השרת" };
  return data as { ok: boolean; message?: string };
};
