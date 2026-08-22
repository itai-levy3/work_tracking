// Netlify serverless function — the ONLY place OPENAI_KEY is read. It's a server-side Netlify
// environment variable (no VITE_ prefix), so it is never bundled into the client and never
// reaches the browser. The client (src/lib/aiAssistant.ts) sends its own already-loaded local
// data as `context`; this function just forwards it to OpenAI alongside the question.
interface NetlifyEvent {
  httpMethod: string;
  body: string | null;
}

interface NetlifyResponse {
  statusCode: number;
  headers?: Record<string, string>;
  body: string;
}

const json = (statusCode: number, body: unknown): NetlifyResponse => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const SYSTEM_PROMPT = `את/ה עוזר/ת אישי/ת בתוך אפליקציית WorkTrack למעקב שעות עבודה, ימי חופשה/מחלה ושכר.
ענה/י תמיד בעברית, בקצרה ובבהירות, ורק על סמך נתוני ה-JSON שסופקו לך על המשתמש הזה.
אם המידע הדרוש לתשובה חסר בנתונים שסופקו, אמור/י זאת בפירוש במקום לנחש.`;

export const handler = async (event: NetlifyEvent): Promise<NetlifyResponse> => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method Not Allowed" });

  const apiKey = process.env.OPENAI_KEY;
  if (!apiKey) return json(500, { error: "שירות ה-AI לא מוגדר בשרת" });

  let body: { question?: string; context?: unknown };
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "בקשה לא תקינה" });
  }

  const question = String(body.question || "").trim();
  if (!question) return json(400, { error: "חסרה שאלה" });

  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.3,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `נתוני המשתמש (JSON):\n${JSON.stringify(body.context ?? {})}\n\nשאלה: ${question}` },
        ],
      }),
    });

    if (!resp.ok) {
      return json(502, { error: "שגיאה בפנייה לשירות ה-AI" });
    }

    const data = (await resp.json()) as { choices?: { message?: { content?: string } }[] };
    const answer = data.choices?.[0]?.message?.content?.trim() || "לא התקבלה תשובה";
    return json(200, { answer });
  } catch {
    return json(502, { error: "שגיאת תקשורת עם שירות ה-AI" });
  }
};
