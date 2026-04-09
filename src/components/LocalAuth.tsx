import { FormEvent, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  hasLocalAuthAccount,
  loginLocalAuth,
  resetPasswordWithPin,
  setupLocalAuth,
} from "@/lib/localAuth";

type Mode = "login" | "setup" | "reset";

export const LocalAuth = () => {
  const hasAccount = useMemo(() => hasLocalAuthAccount(), []);
  const [mode, setMode] = useState<Mode>(hasAccount ? "login" : "setup");
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const handleSetup = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 6) return toast.error("הסיסמה חייבת להיות לפחות 6 תווים");
    if (!/^\d{4,8}$/.test(pin)) return toast.error("ה-PIN חייב להיות 4-8 ספרות");
    setLoading(true);
    try {
      await setupLocalAuth(email, password, pin);
      toast.success("המשתמש המקומי נוצר בהצלחה");
      setMode("login");
    } catch (error: any) {
      toast.error(error?.message === "EXISTS" ? "משתמש עם המייל הזה כבר קיים" : "שגיאה ביצירת משתמש מקומי");
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
        toast.success("התחברת בהצלחה");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async (e: FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 6) return toast.error("הסיסמה החדשה חייבת להיות לפחות 6 תווים");
    setLoading(true);
    try {
      const ok = await resetPasswordWithPin(email, pin, newPassword);
      if (!ok) {
        toast.error("מייל או PIN שגויים");
      } else {
        toast.success("הסיסמה עודכנה");
        setPassword(newPassword);
        setMode("login");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background gradient-warm-bg">
      <div className="w-full max-w-md bg-card rounded-3xl p-6 md:p-8 shadow-xl border border-border/50">
        <h1 className="text-3xl font-bold text-gradient-warm mb-1">WorkTrack</h1>
        <p className="text-sm text-muted-foreground mb-6">
          {mode === "setup" ? "יצירת כניסה מקומית" : mode === "login" ? "התחברו עכשיו כדי לעקוב אחרי השעות שלכם." : "איפוס סיסמה עם PIN"}
        </p>

        {mode === "setup" && (
          <form onSubmit={handleSetup} className="space-y-4">
            <div className="space-y-1.5">
              <Label>מייל</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label>סיסמה</Label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label>PIN לשחזור (4-8 ספרות)</Label>
              <Input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} required />
            </div>
            <Button className="w-full rounded-xl h-11" disabled={loading}>
              {loading ? "יוצר..." : "צור משתמש מקומי"}
            </Button>
            {hasAccount && (
              <button
                type="button"
                onClick={() => setMode("login")}
                className="w-full text-center text-sm text-muted-foreground hover:text-primary"
              >
                חזרה להתחברות
              </button>
            )}
          </form>
        )}

        {mode === "login" && (
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1.5">
              <Label>מייל</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label>סיסמה</Label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <Button className="w-full rounded-xl h-11" disabled={loading}>
              {loading ? "מתחבר..." : "התחבר"}
            </Button>
            <button
              type="button"
              onClick={() => setMode("reset")}
              className="w-full text-center text-sm text-muted-foreground hover:text-primary"
            >
              שכחתי סיסמה
            </button>
            <button
              type="button"
              onClick={() => setMode("setup")}
              className="w-full text-center text-sm text-muted-foreground hover:text-primary"
            >
              צור משתמש חדש
            </button>
          </form>
        )}

        {mode === "reset" && (
          <form onSubmit={handleReset} className="space-y-4">
            <div className="space-y-1.5">
              <Label>מייל</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label>PIN</Label>
              <Input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label>סיסמה חדשה</Label>
              <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
            </div>
            <Button className="w-full rounded-xl h-11" disabled={loading}>
              {loading ? "מעדכן..." : "עדכן סיסמה"}
            </Button>
            <button
              type="button"
              onClick={() => setMode("login")}
              className="w-full text-center text-sm text-muted-foreground hover:text-primary"
            >
              חזרה להתחברות
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
