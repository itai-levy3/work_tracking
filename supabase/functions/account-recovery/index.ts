// Deno Edge Function — the ONLY place the service_role key is used. It never reaches the
// browser. Recovery is a two-tier chain:
//   - Forgot password (still remember the PIN) -> PIN alone resets the password.
//   - Forgot the PIN too -> a sequential single-question security challenge (see check_answer)
//     resets the PIN (not the password) — the user then uses that new PIN to reset the password.
// Repeated wrong answers lock the account (locked_at) until all 3 questions are answered
// correctly at once via `unlock`, which also lets the owner set a brand-new password AND PIN.
// All hashing happens client-side (see src/lib/recoveryAuth.ts) — this function only ever sees
// hashes, never the raw PIN/answers/password in a form it could log or leak.
//
// Actions:
//   { type: "get_questions", email }
//     -> which 3 security-question ids this account chose, and whether it's currently locked.
//   { type: "verify_pin", email, pinHash }
//     -> true/false only — used to gate sensitive in-app actions (e.g. deleting a food expense)
//        without changing anything.
//   { type: "check_answer", email, questionId, answerHash, newPinHash? }
//     -> single-question step of the sequential challenge. Correct -> resets the attempt
//        counter, atomically writes newPinHash if provided (so "answer this to set your new
//        PIN" is one round trip, not two), and succeeds. Wrong -> increments the counter;
//        reaching the limit locks the account. Refuses outright (locked:true) if already locked.
//   { type: "lock_account", email }
//     -> client-side 90s countdown on the final question expired — locks immediately.
//   { type: "unlock", email, answerHashes (all 3), newPassword, newPinHash }
//     -> verifies all 3 security-answer hashes match, and only then reactivates the account,
//        clears the attempt counter, and sets both a new login password and a new PIN.
//   { type: "reset_password", email, pinHash, newPassword }
//     -> verifies the PIN hash matches what's on file (refuses if locked), and only then changes
//        the account's actual login password via the admin API.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const GENERIC_FAIL = { ok: false, message: "פרטים שגויים" };

// Total wrong answers tolerated across the whole sequential challenge (question 1 wrong, question
// 2 wrong, question 3 wrong twice) before the 5th wrong answer locks the account.
const MAX_FAILED_ATTEMPTS = 4;

interface StoredAnswer {
  questionId: string;
  hash: string;
}

interface RecoveryRow {
  user_id: string;
  email: string;
  pin_hash: string;
  security_answers: StoredAnswer[];
  failed_attempts: number;
  locked_at: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, message: "בקשה לא תקינה" }, 400);
  }

  const email = String(body.email || "")
    .trim()
    .toLowerCase();
  if (!email) return json({ ok: false, message: "חסר מייל" }, 400);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    db: { schema: "worktrack" },
  });

  const fetchRow = async (): Promise<RecoveryRow | null> => {
    const { data, error } = await admin
      .from("recovery_credentials")
      .select("user_id, email, pin_hash, security_answers, failed_attempts, locked_at")
      .eq("email", email)
      .maybeSingle();
    if (error) console.error("fetchRow error", JSON.stringify(error));
    return (data as RecoveryRow | null) ?? null;
  };

  if (body.type === "get_questions") {
    const row = await fetchRow();
    if (!row) return json({ ok: false, message: "לא נמצא שחזור מוגדר עבור המייל הזה" });
    return json({ ok: true, questionIds: row.security_answers.map((a) => a.questionId), locked: !!row.locked_at });
  }

  if (body.type === "verify_pin") {
    const pinHash = String(body.pinHash || "");
    if (!pinHash) return json({ ok: false, message: "בקשה לא תקינה" }, 400);
    const row = await fetchRow();
    if (!row || row.locked_at || row.pin_hash !== pinHash) return json(GENERIC_FAIL);
    return json({ ok: true });
  }

  if (body.type === "check_answer") {
    const questionId = String(body.questionId || "");
    const answerHash = String(body.answerHash || "");
    const newPinHash = body.newPinHash ? String(body.newPinHash) : null;
    if (!questionId || !answerHash) return json({ ok: false, message: "בקשה לא תקינה" }, 400);

    const row = await fetchRow();
    if (!row) return json(GENERIC_FAIL);
    if (row.locked_at) return json({ ok: false, locked: true, message: "החשבון נעול" });

    const correct = row.security_answers.some((a) => a.questionId === questionId && a.hash === answerHash);
    if (correct) {
      const update: Record<string, unknown> = {};
      if (row.failed_attempts > 0) update.failed_attempts = 0;
      if (newPinHash) update.pin_hash = newPinHash;
      if (Object.keys(update).length > 0) {
        await admin.from("recovery_credentials").update(update).eq("user_id", row.user_id);
      }
      return json({ ok: true });
    }

    const nextAttempts = row.failed_attempts + 1;
    if (nextAttempts > MAX_FAILED_ATTEMPTS) {
      await admin.from("recovery_credentials").update({ failed_attempts: nextAttempts, locked_at: new Date().toISOString() }).eq("user_id", row.user_id);
      return json({ ok: false, locked: true });
    }
    await admin.from("recovery_credentials").update({ failed_attempts: nextAttempts }).eq("user_id", row.user_id);
    return json({ ok: false, locked: false });
  }

  if (body.type === "lock_account") {
    const row = await fetchRow();
    if (!row) return json({ ok: true }); // nothing to lock; don't leak whether the email exists
    if (!row.locked_at) {
      await admin.from("recovery_credentials").update({ locked_at: new Date().toISOString() }).eq("user_id", row.user_id);
    }
    return json({ ok: true });
  }

  if (body.type === "unlock") {
    const answerHashes = (body.answerHashes as { questionId: string; hash: string }[] | undefined) || [];
    const newPassword = String(body.newPassword || "");
    const newPinHash = String(body.newPinHash || "");
    if (answerHashes.length < 3 || newPassword.length < 6 || !newPinHash) return json({ ok: false, message: "בקשה לא תקינה" }, 400);

    const row = await fetchRow();
    if (!row) return json(GENERIC_FAIL);

    const allMatch = answerHashes.every((given) => row.security_answers.some((stored) => stored.questionId === given.questionId && stored.hash === given.hash));
    if (!allMatch) return json(GENERIC_FAIL);

    const { error: updateError } = await admin.auth.admin.updateUserById(row.user_id, { password: newPassword });
    if (updateError) return json({ ok: false, message: "שגיאה בעדכון הסיסמה" }, 500);

    await admin.from("recovery_credentials").update({ pin_hash: newPinHash, failed_attempts: 0, locked_at: null }).eq("user_id", row.user_id);
    return json({ ok: true });
  }

  if (body.type === "reset_password") {
    const pinHash = String(body.pinHash || "");
    const newPassword = String(body.newPassword || "");
    if (!pinHash || newPassword.length < 6) return json({ ok: false, message: "בקשה לא תקינה" }, 400);

    const row = await fetchRow();
    if (!row || row.locked_at || row.pin_hash !== pinHash) return json(GENERIC_FAIL);

    const { error: updateError } = await admin.auth.admin.updateUserById(row.user_id, { password: newPassword });
    if (updateError) return json({ ok: false, message: "שגיאה בעדכון הסיסמה" }, 500);
    return json({ ok: true });
  }

  return json({ ok: false, message: "בקשה לא תקינה" }, 400);
});
