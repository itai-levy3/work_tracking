import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { askAiAssistant } from "@/lib/aiAssistant";
import { LH } from "./tokens";

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

/** Floating chat button + dialog: answers questions about the user's own hours/vacation/pay data
 * via the ai-assistant Netlify function (which alone holds the OpenAI key server-side). */
export const AiAssistant = () => {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const send = async () => {
    const question = input.trim();
    if (!question || loading) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", text: question }]);
    setLoading(true);
    try {
      const answer = await askAiAssistant(question);
      setMessages((prev) => [...prev, { role: "assistant", text: answer }]);
    } catch (e) {
      setMessages((prev) => [...prev, { role: "assistant", text: e instanceof Error ? e.message : "שגיאה בשירות ה-AI" }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="עוזר AI"
        className="fixed z-40 flex items-center justify-center rounded-full shadow-lg"
        style={{
          bottom: 92,
          left: 16,
          width: 52,
          height: 52,
          background: `linear-gradient(135deg, ${LH.secondary}, ${LH.tertiaryContainer})`,
          color: "#fff",
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 26 }}>
          smart_toy
        </span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-w-md p-0 overflow-hidden"
          style={{ background: LH.background, fontFamily: "'Heebo', system-ui, sans-serif", maxHeight: "80vh" }}
          dir="rtl"
        >
          <DialogHeader className="p-4 pb-2">
            <DialogTitle style={{ color: LH.onSurface }}>עוזר AI אישי</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col" style={{ height: "60vh" }}>
            <div className="flex-1 overflow-y-auto px-4 flex flex-col gap-3">
              {messages.length === 0 && (
                <p className="text-[12px]" style={{ color: LH.onSurfaceVariant }}>
                  שאל/י אותי משהו על השעות, ימי החופשה/מחלה או השכר שלך — למשל "כמה ימי חופשה נשארו לי השנה?" או "כמה שעות עשיתי החודש?".
                </p>
              )}
              {messages.map((m, i) => (
                <div
                  key={i}
                  className="rounded-2xl px-3 py-2 text-[13px] max-w-[85%]"
                  style={{
                    alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                    background: m.role === "user" ? LH.secondary : LH.surfaceContainerLow,
                    color: m.role === "user" ? "#fff" : LH.onSurface,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {m.text}
                </div>
              ))}
              {loading && (
                <div className="text-[12px]" style={{ color: LH.onSurfaceVariant }}>
                  חושב/ת…
                </div>
              )}
            </div>
            <div className="flex gap-2 p-4 pt-3 border-t" style={{ borderColor: LH.surfaceVariant }}>
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void send();
                }}
                placeholder="הקלד/י שאלה..."
                className="flex-1 h-11 rounded-xl px-3 text-[14px] outline-none"
                style={{ background: LH.surfaceContainerLow, color: LH.onSurface }}
              />
              <button
                onClick={() => void send()}
                disabled={loading}
                className="h-11 px-4 rounded-xl font-bold text-white disabled:opacity-50"
                style={{ background: LH.primary }}
              >
                שליחה
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
