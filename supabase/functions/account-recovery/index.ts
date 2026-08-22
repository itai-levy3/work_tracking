// Deno Edge Function — the ONLY place the service_role key is used. It never reaches the
// browser. Recovery is a two-tier chain:
//   - Forgot password (still remember the PIN) -> PIN alone resets the password.
//   - Forgot the PIN too -> the 3 security-question answers alone reset the PIN (not the
//     password) — the user then uses that new PIN to reset the password as usual.
// All hashing happens client-side (see src/lib/recoveryAuth.ts) — this function only ever sees
// hashes, never the raw PIN/answers/password in a form it could log or leak.
//
// Actions:
//   { type: "get_questions", email }
//     -> which 3 security-question ids this account chose (needed so the client knows which
//        questions to show — reveals nothing secret).
//   { type: "reset_password", email, pinHash, newPassword }
//     -> verifies the PIN hash matches what's on file, and only then changes the account's
//        actual login password via the admin API.
//   { type: "reset_pin", email, answerHashes, newPinHash }
//     -> verifies all 3 security-answer hashes match what's on file, and only then replaces the
//        stored pin_hash (does not touch the login password at all).
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

interface StoredAnswer {
  questionId: string;
  hash: string;
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

  if (body.type === "get_questions") {
    const { data } = await admin.from("recovery_credentials").select("security_answers").eq("email", email).maybeSingle();
    if (!data) return json({ ok: false, message: "לא נמצא שחזור מוגדר עבור המייל הזה" });
    const answers = data.security_answers as StoredAnswer[];
    return json({ ok: true, questionIds: answers.map((a) => a.questionId) });
  }

  if (body.type === "reset_password") {
    const pinHash = String(body.pinHash || "");
    const newPassword = String(body.newPassword || "");
    if (!pinHash || newPassword.length < 6) return json({ ok: false, message: "בקשה לא תקינה" }, 400);

    const { data } = await admin.from("recovery_credentials").select("user_id, pin_hash").eq("email", email).maybeSingle();
    if (!data || data.pin_hash !== pinHash) return json({ ok: false, message: "פרטים שגויים" });

    const { error: updateError } = await admin.auth.admin.updateUserById(data.user_id, { password: newPassword });
    if (updateError) return json({ ok: false, message: "שגיאה בעדכון הסיסמה" }, 500);
    return json({ ok: true });
  }

  if (body.type === "reset_pin") {
    const answerHashes = (body.answerHashes as { questionId: string; hash: string }[] | undefined) || [];
    const newPinHash = String(body.newPinHash || "");
    if (answerHashes.length < 3 || !newPinHash) return json({ ok: false, message: "בקשה לא תקינה" }, 400);

    const { data } = await admin.from("recovery_credentials").select("user_id, security_answers").eq("email", email).maybeSingle();
    if (!data) return json({ ok: false, message: "פרטים שגויים" });

    const storedAnswers = data.security_answers as StoredAnswer[];
    const allMatch = answerHashes.every((given) => storedAnswers.some((stored) => stored.questionId === given.questionId && stored.hash === given.hash));
    if (!allMatch) return json({ ok: false, message: "פרטים שגויים" });

    const { error: updateError } = await admin.from("recovery_credentials").update({ pin_hash: newPinHash }).eq("user_id", data.user_id);
    if (updateError) return json({ ok: false, message: "שגיאה בעדכון ה-PIN" }, 500);
    return json({ ok: true });
  }

  return json({ ok: false, message: "בקשה לא תקינה" }, 400);
});
