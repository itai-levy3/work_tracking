import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { getCurrentUserEmail, isLocalAuthenticated, loginLocalAuth, logoutLocalAuth, setupLocalAuth } from "@/lib/localAuth";
import { getRecoveryQuestionIds, hasRecoverySetup, questionTextFor, resetPasswordWithPin, resetPinWithSecurityAnswers, saveRecoverySetup, SECURITY_QUESTIONS } from "@/lib/recoveryAuth";
import { LH } from "./tokens";
import { globalStyle } from "./Shared";

type Mode = "login" | "setup" | "recovery_setup" | "reset_pw_email" | "reset_pw_verify" | "reset_pin_verify";

const fieldStyle: React.CSSProperties = {
  background: "#F8FAFF",
  border: `1px solid ${LH.surfaceVariant}`,
  borderRadius: 14,
  padding: "12px 16px",
  fontSize: 16,
  color: LH.onSurface,
  width: "100%",
  outline: "none",
  boxShadow: "inset 0 1px 2px rgba(35,50,100,0.04)",
  transition: "border-color .2s, box-shadow .2s",
};

function Field({ label, icon, ...props }: { label: string; icon: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[12px] font-bold" style={{ color: LH.onSurfaceVariant }}>{label}</label>
      <div className="relative">
        <span className="material-symbols-outlined absolute" style={{ right: 14, top: "50%", transform: "translateY(-50%)", fontSize: 18, color: "#7639FF" }}>{icon}</span>
        <input
          {...props}
          className="lh-focus-ring"
          style={{ ...fieldStyle, paddingRight: 42 }}
        />
      </div>
    </div>
  );
}

function SecretField({
  label,
  icon,
  ...props
}: { label: string; icon: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[12px] font-bold" style={{ color: LH.onSurfaceVariant }}>{label}</label>
      <div className="relative">
        <span className="material-symbols-outlined absolute" style={{ right: 14, top: "50%", transform: "translateY(-50%)", fontSize: 18, color: "#7639FF" }}>{icon}</span>
        <input
          {...props}
          type={visible ? "text" : "password"}
          className="lh-focus-ring"
          style={{ ...fieldStyle, paddingRight: 42, paddingLeft: 42 }}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute"
          style={{ left: 14, top: "50%", transform: "translateY(-50%)" }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18, color: LH.onSurfaceVariant }}>
            {visible ? "visibility_off" : "visibility"}
          </span>
        </button>
      </div>
    </div>
  );
}

/** 3 dropdowns to pick 3 different questions out of the 10, each with its own answer field. */
function SecurityQuestionsPicker({
  selectedIds,
  answers,
  onChangeQuestion,
  onChangeAnswer,
}: {
  selectedIds: [string, string, string];
  answers: [string, string, string];
  onChangeQuestion: (index: 0 | 1 | 2, id: string) => void;
  onChangeAnswer: (index: 0 | 1 | 2, value: string) => void;
}) {
  return (
    <>
      {([0, 1, 2] as const).map((i) => (
        <div key={i} className="flex flex-col gap-1.5">
          <label className="text-[12px] font-bold" style={{ color: LH.onSurfaceVariant }}>{`שאלת אבטחה ${i + 1}`}</label>
          <select value={selectedIds[i]} onChange={(e) => onChangeQuestion(i, e.target.value)} style={fieldStyle}>
            {SECURITY_QUESTIONS.filter((q) => q.id === selectedIds[i] || !selectedIds.includes(q.id)).map((q) => (
              <option key={q.id} value={q.id}>{q.text}</option>
            ))}
          </select>
          <input
            type="text"
            placeholder="התשובה שלך"
            value={answers[i]}
            onChange={(e) => onChangeAnswer(i, e.target.value)}
            style={fieldStyle}
            required
          />
        </div>
      ))}
    </>
  );
}

export default function DesignPreviewLogin() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("login");
  const [loading, setLoading] = useState(false);
  // Starts true whenever a cached session might exist, so the plain login form never flashes for
  // an instant before the recovery-setup check redirects or switches mode.
  const [checkingSession, setCheckingSession] = useState(() => isLocalAuthenticated());
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Recovery setup (right after signup, or reconfigured later from Settings using the same UI shape)
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [questionIds, setQuestionIds] = useState<[string, string, string]>([SECURITY_QUESTIONS[0].id, SECURITY_QUESTIONS[1].id, SECURITY_QUESTIONS[2].id]);
  const [questionAnswers, setQuestionAnswers] = useState<[string, string, string]>(["", "", ""]);

  // Forgot password (still remember the PIN) — PIN alone resets the password.
  const [resetPin, setResetPin] = useState("");
  const [resetNewPassword, setResetNewPassword] = useState("");

  // Forgot the PIN too — security-question answers alone reset the PIN.
  const [resetQuestionIds, setResetQuestionIds] = useState<string[]>([]);
  const [resetAnswers, setResetAnswers] = useState<Record<string, string>>({});
  const [resetNewPin, setResetNewPin] = useState("");
  const [resetNewPinConfirm, setResetNewPinConfirm] = useState("");

  const resetAllFields = () => {
    setPassword("");
    setConfirmPassword("");
    setPin("");
    setConfirmPin("");
    setQuestionIds([SECURITY_QUESTIONS[0].id, SECURITY_QUESTIONS[1].id, SECURITY_QUESTIONS[2].id]);
    setQuestionAnswers(["", "", ""]);
    setResetPin("");
    setResetNewPassword("");
    setResetQuestionIds([]);
    setResetAnswers({});
    setResetNewPin("");
    setResetNewPinConfirm("");
  };

  const switchMode = (next: Mode) => {
    resetAllFields();
    setMode(next);
  };

  // A session can exist here (page loaded fresh, browser back, a stale tab) without the mandatory
  // PIN/security-questions step ever having been finished — that must always land back on
  // recovery_setup, never silently let the visitor through to the login form as if signed out.
  useEffect(() => {
    if (!isLocalAuthenticated()) return;
    const currentEmail = getCurrentUserEmail();
    if (currentEmail) setEmail(currentEmail);
    hasRecoverySetup().then((configured) => {
      if (configured) {
        navigate("/design-preview");
        return;
      }
      setMode("recovery_setup");
      setCheckingSession(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Abandons the incomplete signup outright instead of leaving it in limbo — signs out and
  // returns to a clean signup form, which is the only way "back" from this step can behave
  // without ever being able to slip into the app itself.
  const abandonRecoverySetup = async () => {
    await logoutLocalAuth();
    switchMode("setup");
  };

  const handleSetup = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 6) return toast.error("הסיסמה חייבת להיות לפחות 6 תווים");
    if (password !== confirmPassword) return toast.error("הסיסמאות אינן תואמות");
    setLoading(true);
    try {
      const { needsEmailConfirmation } = await setupLocalAuth(email, password);
      if (needsEmailConfirmation) {
        toast.success("נשלח מייל אימות — תלחצו על הקישור במייל כדי להשלים את ההרשמה");
        switchMode("login");
      } else {
        toast.success("החשבון נוצר! עוד שלב אחד — הגדרת שחזור סיסמה");
        setMode("recovery_setup");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("already registered")) {
        // Could be a genuine conflict, or this user's OWN earlier signup that never finished the
        // required PIN/security-questions step (e.g. they closed the tab). The only safe way to
        // tell them apart is to try logging in with the password just typed — if it's really
        // theirs, this succeeds and they simply continue the recovery setup they abandoned.
        const loggedIn = await loginLocalAuth(email, password);
        if (loggedIn) {
          const configured = await hasRecoverySetup();
          if (!configured) {
            toast.success("החשבון כבר קיים — נשאר רק שלב הגדרת שחזור הסיסמה");
            setMode("recovery_setup");
          } else {
            toast.success("התחברת בהצלחה");
            navigate("/design-preview");
          }
        } else {
          toast.error("משתמש עם המייל הזה כבר קיים");
        }
      } else {
        toast.error("שגיאה ביצירת משתמש");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSaveRecoverySetup = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^\d{4,8}$/.test(pin)) return toast.error("ה-PIN חייב להיות 4-8 ספרות");
    if (pin !== confirmPin) return toast.error("ה-PIN ואימות ה-PIN אינם תואמים");
    if (new Set(questionIds).size !== 3) return toast.error("יש לבחור 3 שאלות אבטחה שונות");
    if (questionAnswers.some((a) => !a.trim())) return toast.error("יש למלא תשובה לכל שאלה");
    setLoading(true);
    try {
      await saveRecoverySetup(
        email,
        pin,
        questionIds.map((id, i) => ({ questionId: id, answer: questionAnswers[i] })),
      );
      toast.success("שחזור הסיסמה הוגדר! מתחבר...");
      navigate("/design-preview");
    } catch {
      toast.error("שגיאה בהגדרת שחזור הסיסמה");
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const ok = await loginLocalAuth(email, password);
      if (!ok) {
        toast.error("מייל או סיסמה שגויים");
      } else {
        const configured = await hasRecoverySetup();
        if (!configured) {
          toast.success("נשאר רק שלב הגדרת שחזור הסיסמה");
          setMode("recovery_setup");
        } else {
          toast.success("התחברת בהצלחה");
          navigate("/design-preview");
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResetPwEmailSubmit = (e: FormEvent) => {
    e.preventDefault();
    setMode("reset_pw_verify");
  };

  const handleResetPwVerifySubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (resetNewPassword.length < 6) return toast.error("הסיסמה החדשה חייבת להיות לפחות 6 תווים");
    setLoading(true);
    try {
      const result = await resetPasswordWithPin(email, resetPin, resetNewPassword);
      if (!result.ok) {
        toast.error(result.message || "פרטים שגויים");
        return;
      }
      toast.success("הסיסמה עודכנה! אפשר להתחבר איתה עכשיו");
      switchMode("login");
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPinClick = async () => {
    setLoading(true);
    try {
      const ids = await getRecoveryQuestionIds(email);
      if (!ids) {
        toast.error("לא נמצא שחזור מוגדר עבור המייל הזה");
        return;
      }
      setResetQuestionIds(ids);
      setMode("reset_pin_verify");
    } finally {
      setLoading(false);
    }
  };

  const handleResetPinSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^\d{4,8}$/.test(resetNewPin)) return toast.error("ה-PIN חייב להיות 4-8 ספרות");
    if (resetNewPin !== resetNewPinConfirm) return toast.error("ה-PIN ואימות ה-PIN אינם תואמים");
    if (resetQuestionIds.some((id) => !resetAnswers[id]?.trim())) return toast.error("יש למלא תשובה לכל שאלה");
    setLoading(true);
    try {
      const result = await resetPinWithSecurityAnswers(
        email,
        resetQuestionIds.map((id) => ({ questionId: id, answer: resetAnswers[id] || "" })),
        resetNewPin,
      );
      if (!result.ok) {
        toast.error(result.message || "פרטים שגויים");
        return;
      }
      toast.success("ה-PIN אופס! עכשיו אפשר להשתמש בו כדי לאפס את הסיסמה");
      setResetPin("");
      setResetNewPassword("");
      setMode("reset_pw_verify");
    } finally {
      setLoading(false);
    }
  };

  const setQuestionId = (index: 0 | 1 | 2, id: string) => setQuestionIds((prev) => { const next = [...prev] as typeof prev; next[index] = id; return next; });
  const setQuestionAnswer = (index: 0 | 1 | 2, value: string) => setQuestionAnswers((prev) => { const next = [...prev] as typeof prev; next[index] = value; return next; });

  const subtitle =
    mode === "setup" ? "יצירת חשבון חדש"
    : mode === "login" ? "התחברות לחשבון שלך"
    : mode === "recovery_setup" ? "הגדרת שחזור סיסמה"
    : mode === "reset_pw_email" ? "שחזור סיסמה"
    : mode === "reset_pw_verify" ? "איפוס סיסמה עם PIN"
    : "שכחת גם את ה-PIN?";

  if (checkingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: LH.background }}>
        <div className="w-12 h-12 rounded-full border-2 animate-spin" style={{ borderColor: `${LH.primary}33`, borderTopColor: LH.primary }} />
      </div>
    );
  }

  return (
    <div
      dir="rtl"
      className="min-h-screen w-full flex flex-col items-center justify-center p-6 relative overflow-hidden"
      style={{ background: LH.background, color: LH.onSurface, fontFamily: "'Heebo', system-ui, sans-serif" }}
    >
      <style>{`
        ${globalStyle}
        .lh-focus-ring:focus { border-color: #7639FF !important; box-shadow: 0 0 0 3px rgba(118,57,255,0.15) !important; }
      `}</style>

      <div className="fixed inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 0 }}>
        <div className="absolute -top-[15%] -right-[15%] w-[70%] h-[70%] rounded-full" style={{ background: "#7639FF", opacity: 0.35, filter: "blur(90px)" }} />
        <div className="absolute top-[20%] -left-[25%] w-[70%] h-[70%] rounded-full" style={{ background: "#00D2FF", opacity: 0.32, filter: "blur(90px)" }} />
        <div className="absolute -bottom-[20%] right-[10%] w-[55%] h-[55%] rounded-full" style={{ background: "#19CEA0", opacity: 0.3, filter: "blur(90px)" }} />
        <div className="absolute -bottom-[25%] -left-[15%] w-[60%] h-[60%] rounded-full" style={{ background: "#723AFF", opacity: 0.28, filter: "blur(90px)" }} />
      </div>

      <div
        className="absolute pointer-events-none"
        style={{
          top: "50%", left: "50%", width: 480, height: 620, marginTop: -310, marginLeft: -240,
          background: "radial-gradient(ellipse at center, rgba(118,57,255,0.35), rgba(0,210,255,0.2) 45%, transparent 72%)",
          filter: "blur(50px)", zIndex: 1,
        }}
      />

      <div className="lh-rise w-full max-w-[420px] relative z-10 flex flex-col items-center">
        <img
          src="/logo_trac.png"
          alt="WorkTrack"
          className="w-20 h-20 rounded-[22px] mb-5"
          style={{ boxShadow: "0 16px 32px -8px rgba(118,57,255,0.5), 0 0 0 6px rgba(118,57,255,0.08)", objectFit: "cover" }}
        />
        <h1 className="text-[28px] font-extrabold mb-1" style={{ color: LH.onSurface }}>WorkTrack</h1>
        <p className="text-[14px] mb-8" style={{ color: LH.onSurfaceVariant }}>{subtitle}</p>

        <div
          className="w-full rounded-[28px] p-6 relative overflow-hidden z-10"
          style={{
            background: "rgba(255,255,255,0.6)",
            backdropFilter: "blur(30px)",
            border: "1px solid rgba(255,255,255,0.95)",
            boxShadow: "0 30px 60px -12px rgba(118,57,255,0.28), 0 8px 24px rgba(35,50,100,0.12), inset 0 1px 0 rgba(255,255,255,0.95)",
          }}
        >
          <div className="absolute top-0 inset-x-0 h-1.5" style={{ background: "linear-gradient(90deg,#7639FF,#00D2FF,#19CEA0)" }} />
          <div className="absolute -top-16 -right-16 w-40 h-40 rounded-full blur-2xl pointer-events-none" style={{ background: "rgba(118,57,255,0.18)" }} />
          <div className="absolute -bottom-16 -left-16 w-40 h-40 rounded-full blur-2xl pointer-events-none" style={{ background: "rgba(0,210,255,0.18)" }} />

          {mode === "setup" && (
            <form onSubmit={handleSetup} className="flex flex-col gap-4">
              <Field label="מייל" icon="person" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              <SecretField label="סיסמה" icon="lock" value={password} onChange={(e) => setPassword(e.target.value)} required />
              <SecretField label="אימות סיסמה" icon="lock" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
              <button disabled={loading} className="w-full h-12 rounded-2xl font-bold text-white mt-1" style={{ background: "linear-gradient(155deg,#7639FF,#00D2FF)", boxShadow: "0 16px 32px -10px rgba(118,57,255,0.5)" }}>
                {loading ? "יוצר..." : "יצירת חשבון"}
              </button>
              <button type="button" onClick={() => switchMode("login")} className="text-[13px] font-medium text-center" style={{ color: LH.onSurfaceVariant }}>
                כבר יש לך חשבון? התחבר
              </button>
            </form>
          )}

          {mode === "recovery_setup" && (
            <form onSubmit={handleSaveRecoverySetup} className="flex flex-col gap-4">
              <p className="text-[12.5px] -mt-1" style={{ color: LH.onSurfaceVariant }}>
                אם תשכח/י את הסיסמה, תוכל/י לשחזר אותה עם ה-PIN והתשובות האלה — בלי צורך במייל.
              </p>
              <SecretField label="בחר/י PIN (4-8 ספרות)" icon="pin" inputMode="numeric" maxLength={8} value={pin} onChange={(e) => setPin(e.target.value)} required />
              <SecretField label="אימות PIN" icon="pin" inputMode="numeric" maxLength={8} value={confirmPin} onChange={(e) => setConfirmPin(e.target.value)} required />
              <SecurityQuestionsPicker selectedIds={questionIds} answers={questionAnswers} onChangeQuestion={setQuestionId} onChangeAnswer={setQuestionAnswer} />
              <button disabled={loading} className="w-full h-12 rounded-2xl font-bold text-white mt-1" style={{ background: "linear-gradient(155deg,#7639FF,#00D2FF)", boxShadow: "0 16px 32px -10px rgba(118,57,255,0.5)" }}>
                {loading ? "שומר..." : "שמירה וכניסה"}
              </button>
              <button type="button" onClick={() => void abandonRecoverySetup()} className="flex items-center justify-center gap-1 text-[13px] font-medium" style={{ color: LH.onSurfaceVariant }}>
                <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                חזרה — לא עכשיו
              </button>
            </form>
          )}

          {mode === "login" && (
            <form onSubmit={handleLogin} className="flex flex-col gap-4">
              <Field label="מייל" icon="person" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              <SecretField label="סיסמה" icon="lock" value={password} onChange={(e) => setPassword(e.target.value)} required />
              <button disabled={loading} className="w-full h-12 rounded-2xl font-bold text-white mt-1" style={{ background: "linear-gradient(155deg,#7639FF,#00D2FF)", boxShadow: "0 16px 32px -10px rgba(118,57,255,0.5)" }}>
                {loading ? "מתחבר..." : "התחברות"}
              </button>
              <div className="flex justify-between mt-1">
                <button type="button" onClick={() => switchMode("reset_pw_email")} className="text-[13px] font-medium" style={{ color: LH.onSurfaceVariant }}>שכחתי סיסמה</button>
                <button type="button" onClick={() => switchMode("setup")} className="text-[13px] font-medium" style={{ color: "#7639FF" }}>יצירת חשבון חדש</button>
              </div>
            </form>
          )}

          {mode === "reset_pw_email" && (
            <form onSubmit={handleResetPwEmailSubmit} className="flex flex-col gap-4">
              <Field label="מייל" icon="person" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              <button disabled={loading} className="w-full h-12 rounded-2xl font-bold text-white mt-1" style={{ background: "linear-gradient(155deg,#7639FF,#00D2FF)", boxShadow: "0 16px 32px -10px rgba(118,57,255,0.5)" }}>
                המשך
              </button>
              <button type="button" onClick={() => switchMode("login")} className="text-[13px] font-medium text-center" style={{ color: LH.onSurfaceVariant }}>
                חזרה להתחברות
              </button>
            </form>
          )}

          {mode === "reset_pw_verify" && (
            <form onSubmit={handleResetPwVerifySubmit} className="flex flex-col gap-4">
              <SecretField label="PIN" icon="pin" inputMode="numeric" maxLength={8} value={resetPin} onChange={(e) => setResetPin(e.target.value)} required />
              <SecretField label="סיסמה חדשה" icon="lock" value={resetNewPassword} onChange={(e) => setResetNewPassword(e.target.value)} required />
              <button disabled={loading} className="w-full h-12 rounded-2xl font-bold text-white mt-1" style={{ background: "linear-gradient(155deg,#7639FF,#00D2FF)", boxShadow: "0 16px 32px -10px rgba(118,57,255,0.5)" }}>
                {loading ? "מעדכן..." : "איפוס סיסמה"}
              </button>
              <div className="flex justify-between mt-1">
                <button type="button" onClick={() => switchMode("login")} className="text-[13px] font-medium" style={{ color: LH.onSurfaceVariant }}>
                  חזרה להתחברות
                </button>
                <button type="button" disabled={loading} onClick={handleForgotPinClick} className="text-[13px] font-medium" style={{ color: "#7639FF" }}>
                  שכחתי גם את ה-PIN
                </button>
              </div>
            </form>
          )}

          {mode === "reset_pin_verify" && (
            <form onSubmit={handleResetPinSubmit} className="flex flex-col gap-4">
              <p className="text-[12.5px] -mt-1" style={{ color: LH.onSurfaceVariant }}>ענו נכון על 3 שאלות האבטחה כדי לבחור PIN חדש.</p>
              {resetQuestionIds.map((id) => (
                <div key={id} className="flex flex-col gap-1.5">
                  <label className="text-[12px] font-bold" style={{ color: LH.onSurfaceVariant }}>{questionTextFor(id)}</label>
                  <input
                    type="text"
                    value={resetAnswers[id] || ""}
                    onChange={(e) => setResetAnswers((prev) => ({ ...prev, [id]: e.target.value }))}
                    style={fieldStyle}
                    required
                  />
                </div>
              ))}
              <SecretField label="PIN חדש (4-8 ספרות)" icon="pin" inputMode="numeric" maxLength={8} value={resetNewPin} onChange={(e) => setResetNewPin(e.target.value)} required />
              <SecretField label="אימות PIN" icon="pin" inputMode="numeric" maxLength={8} value={resetNewPinConfirm} onChange={(e) => setResetNewPinConfirm(e.target.value)} required />
              <button disabled={loading} className="w-full h-12 rounded-2xl font-bold text-white mt-1" style={{ background: "linear-gradient(155deg,#7639FF,#00D2FF)", boxShadow: "0 16px 32px -10px rgba(118,57,255,0.5)" }}>
                {loading ? "מעדכן..." : "איפוס PIN"}
              </button>
              <button type="button" onClick={() => switchMode("login")} className="text-[13px] font-medium text-center" style={{ color: LH.onSurfaceVariant }}>
                חזרה להתחברות
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
