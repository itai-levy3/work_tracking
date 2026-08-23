import { useEffect, useRef, useState } from "react";
import { questionTextFor } from "@/lib/recoveryAuth";
import { LH } from "./tokens";

const TIMER_SECONDS = 90;

const FRIENDLY_MESSAGE = "לא נורא. זה קורה לכולם ששוכחים משהו. בוא ננסה שאלה אחרת.";
const SCARY_MESSAGE = "אני חושב שאתה לא מי שאתה טוען שאתה. יש לך דקה וחצי לענות על השאלה או שאני אנעל את החשבון שלך עד לזיהוי הפרטים.";

const shuffle = <T,>(arr: T[]): T[] => {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

const formatSeconds = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export interface ChallengeAttemptResult {
  ok: boolean;
  locked?: boolean;
}

interface Props {
  questionIds: string[];
  fieldStyle: React.CSSProperties;
  onAttempt: (questionId: string, answer: string) => Promise<ChallengeAttemptResult>;
  onLocked: () => void;
  onSuccess: () => void;
}

/**
 * Sequential single-question security challenge: question 1 wrong -> friendly nudge, a different
 * question. Question 2 wrong -> a pointed warning and a 90-second countdown on question 3, which
 * allows up to 2 more wrong tries before the server locks the account. Any correct answer at any
 * point succeeds immediately. The server is the source of truth for the lock threshold — this
 * component only drives the escalating messaging and the countdown UI around it.
 */
export function SecurityChallenge({ questionIds, fieldStyle, onAttempt, onLocked, onSuccess }: Props) {
  const orderRef = useRef(shuffle(questionIds));
  const order = orderRef.current;
  const [stepIndex, setStepIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [message, setMessage] = useState<{ text: string; tone: "friendly" | "scary" | "error" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    if (secondsLeft === null) return;
    if (secondsLeft <= 0) {
      onLocked();
      return;
    }
    const t = setTimeout(() => setSecondsLeft((s) => (s === null ? null : s - 1)), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft]);

  const submit = async () => {
    if (!answer.trim() || busy) return;
    setBusy(true);
    const result = await onAttempt(order[stepIndex], answer);
    setBusy(false);
    setAnswer("");

    if (result.ok) {
      onSuccess();
      return;
    }
    if (result.locked) {
      onLocked();
      return;
    }

    if (stepIndex === 0) {
      setMessage({ text: FRIENDLY_MESSAGE, tone: "friendly" });
      setStepIndex(1);
    } else if (stepIndex === 1) {
      setMessage({ text: SCARY_MESSAGE, tone: "scary" });
      setStepIndex(2);
      setSecondsLeft(TIMER_SECONDS);
    } else {
      setMessage({ text: "תשובה שגויה. עוד ניסיון אחד לפני שהחשבון ננעל.", tone: "error" });
    }
  };

  const messageColors: Record<string, { bg: string; fg: string }> = {
    friendly: { bg: "rgba(118,57,255,0.08)", fg: "#5902e8" },
    scary: { bg: "rgba(220,38,38,0.1)", fg: "#DC2626" },
    error: { bg: "rgba(220,38,38,0.08)", fg: "#DC2626" },
  };

  return (
    <div className="flex flex-col gap-4">
      {message && (
        <div className="rounded-2xl px-4 py-3 text-[13px] font-medium" style={{ background: messageColors[message.tone].bg, color: messageColors[message.tone].fg }}>
          {message.text}
        </div>
      )}

      {secondsLeft !== null && (
        <div className="flex items-center justify-center gap-2 rounded-2xl py-2" style={{ background: "rgba(220,38,38,0.06)" }}>
          <span className="material-symbols-outlined text-[18px]" style={{ color: "#DC2626" }}>timer</span>
          <span className="text-[16px] font-extrabold tabular-nums" style={{ color: "#DC2626" }}>{formatSeconds(secondsLeft)}</span>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label className="text-[12px] font-bold" style={{ color: LH.onSurfaceVariant }}>{questionTextFor(order[stepIndex])}</label>
        <input
          type="text"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void submit()}
          style={fieldStyle}
          autoFocus
        />
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={() => void submit()}
        className="w-full h-12 rounded-2xl font-bold text-white mt-1 disabled:opacity-60"
        style={{ background: "linear-gradient(155deg,#7639FF,#00D2FF)", boxShadow: "0 16px 32px -10px rgba(118,57,255,0.5)" }}
      >
        {busy ? "בודק..." : "המשך"}
      </button>
    </div>
  );
}
