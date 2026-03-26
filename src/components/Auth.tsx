import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";

export const Auth = () => {
  const [mode, setMode] = useState<"login" | "signup" | "forgot">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) { toast.error("הסיסמאות לא תואמות"); return; }
    if (newPassword.length < 6) { toast.error("הסיסמא חייבת להיות לפחות 6 תווים"); return; }
    setLoading(true);
    try {
      const response = await supabase.functions.invoke("reset-password", { body: { email, newPassword } });
      if (response.error) throw new Error(response.error.message || "שגיאה");
      const data = response.data;
      if (data?.error) {
        toast.error(data.error === "No account found with this email" ? "לא נמצא חשבון עם מייל זה" : data.error);
        return;
      }
      toast.success("הסיסמא עודכנה! ניתן להתחבר 🎉");
      setMode("login"); setPassword(newPassword); setNewPassword(""); setConfirmPassword("");
    } catch (error: any) {
      toast.error(error.message || "שגיאה בשחזור");
    } finally { setLoading(false); }
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("!ברוך הבא 👋");
      } else {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { data: { first_name: firstName, last_name: lastName }, emailRedirectTo: `${window.location.origin}/` }
        });
        if (error) throw error;
        toast.success("!החשבון נוצר בהצלחה 🎉");
      }
    } catch (error: any) {
      toast.error(error.message || "שגיאה בהתחברות");
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background gradient-warm-bg relative overflow-hidden">
      <div className="absolute -top-20 -left-20 w-80 h-80 bg-primary/10 rounded-full blur-3xl animate-float" />
      <div className="absolute -bottom-20 -right-20 w-64 h-64 bg-secondary/15 rounded-full blur-3xl animate-float" style={{ animationDelay: '3s' }} />
      <div className="absolute top-1/2 left-1/2 w-72 h-72 bg-accent/8 rounded-full blur-3xl animate-float" style={{ animationDelay: '1.5s' }} />
      
      <div className="w-full max-w-md relative z-10 animate-fade-up">
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center shadow-lg card-glow-pink overflow-hidden">
            <img src="/logo_trac.png" alt="WorkTrack logo" className="h-12 w-12 object-contain scale-150" />
          </div>
          <h1 className="text-4xl font-bold text-gradient-warm">WorkTrack</h1>
        </div>

        <div className="bg-card rounded-3xl p-6 md:p-8 shadow-xl border border-border/50">
          <h2 className="text-xl font-bold text-foreground mb-1">
            {mode === "login" ? "👋 ברוך הבא" : mode === "signup" ? "🚀 צור חשבון" : "🔑 שחזור סיסמא"}
          </h2>
          <p className="text-sm text-muted-foreground mb-6">
            {mode === "login" ? "התחברו עכשיו כדי לעקוב אחרי השעות שלכם." : mode === "signup" ? "התחל לעקוב אחרי שעות העבודה שלך" : "הזן מייל וסיסמא חדשה"}
          </p>

          {mode === "forgot" ? (
            <form onSubmit={handleResetPassword} className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">אימייל</Label>
                <Input type="email" placeholder="you@example.com" value={email}
                  onChange={(e) => setEmail(e.target.value)} required disabled={loading}
                  className="bg-background border-border rounded-xl h-11" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">סיסמא חדשה</Label>
                <Input type="password" placeholder="••••••••" value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)} required disabled={loading} minLength={6}
                  className="bg-background border-border rounded-xl h-11" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">אימות סיסמא</Label>
                <Input type="password" placeholder="••••••••" value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)} required disabled={loading} minLength={6}
                  className="bg-background border-border rounded-xl h-11" />
              </div>
              <Button type="submit" className="w-full rounded-xl bg-gradient-to-r from-primary to-primary-glow hover:opacity-90 h-12 font-semibold text-base" disabled={loading}>
                {loading ? "מעדכן..." : "עדכן סיסמא"}
              </Button>
              <button type="button" onClick={() => setMode("login")}
                className="w-full text-center text-sm text-muted-foreground hover:text-primary transition-colors flex items-center justify-center gap-1">
                <ArrowLeft className="h-3 w-3" /> חזרה להתחברות
              </button>
            </form>
          ) : (
            <form onSubmit={handleAuth} className="space-y-4">
              {mode === "signup" && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium text-muted-foreground">שם פרטי</Label>
                    <Input type="text" placeholder="ליאור" value={firstName}
                      onChange={(e) => setFirstName(e.target.value)} required disabled={loading}
                      className="bg-background border-border rounded-xl h-11" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium text-muted-foreground">שם משפחה</Label>
                    <Input type="text" placeholder="כהן" value={lastName}
                      onChange={(e) => setLastName(e.target.value)} required disabled={loading}
                      className="bg-background border-border rounded-xl h-11" />
                  </div>
                </div>
              )}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">אימייל</Label>
                <Input type="email" placeholder="you@example.com" value={email}
                  onChange={(e) => setEmail(e.target.value)} required disabled={loading}
                  className="bg-background border-border rounded-xl h-11" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">סיסמא</Label>
                <Input type="password" placeholder="••••••••" value={password}
                  onChange={(e) => setPassword(e.target.value)} required disabled={loading} minLength={6}
                  className="bg-background border-border rounded-xl h-11" />
              </div>
              <Button type="submit" className="w-full rounded-xl bg-gradient-to-r from-primary to-secondary hover:opacity-90 h-12 font-semibold text-base shadow-md" disabled={loading}>
                {loading ? "מעבד..." : mode === "login" ? "התחבר" : "צור חשבון"}
              </Button>
              {mode === "login" && (
                <button type="button" onClick={() => setMode("forgot")}
                  className="w-full text-center text-xs text-muted-foreground hover:text-primary transition-colors">
                  שכחתי סיסמא
                </button>
              )}
              <button type="button" onClick={() => setMode(mode === "login" ? "signup" : "login")}
                className="w-full text-center text-sm text-muted-foreground hover:text-primary transition-colors font-medium">
                {mode === "login" ? "אין לך חשבון? הירשם" : "כבר יש לך חשבון? התחבר"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
