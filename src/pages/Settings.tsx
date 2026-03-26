import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { ArrowLeft, Save, Download, RotateCcw } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import jsPDF from "jspdf";
import { format } from "date-fns";

const daysOfWeek = [
  { key: "monday", label: "יום שני", emoji: "📅" },
  { key: "tuesday", label: "יום שלישי", emoji: "📅" },
  { key: "wednesday", label: "יום רביעי", emoji: "📅" },
  { key: "thursday", label: "יום חמישי", emoji: "📅" },
  { key: "friday", label: "יום שישי", emoji: "📅" },
  { key: "saturday", label: "שבת", emoji: "🕯️" },
  { key: "sunday", label: "יום ראשון", emoji: "☀️" },
];

export default function Settings() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hoursPerDay, setHoursPerDay] = useState<Record<string, number>>({
    monday: 8, tuesday: 8, wednesday: 8, thursday: 8, friday: 8, saturday: 0, sunday: 0,
  });
  const [workDays, setWorkDays] = useState<Record<string, boolean>>({
    monday: true, tuesday: true, wednesday: true, thursday: true, friday: true, saturday: false, sunday: false,
  });
  const [exportMonth, setExportMonth] = useState(new Date().getMonth());
  const [exportYear, setExportYear] = useState(new Date().getFullYear());
  const [exporting, setExporting] = useState(false);

  useEffect(() => { loadSettings(); }, []);

  const loadSettings = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data, error } = await supabase.from("user_settings").select("*").eq("user_id", user.id).single();
      if (error) throw error;
      if (data) {
        setHoursPerDay(data.hours_per_day as Record<string, number>);
        setWorkDays(data.work_days as Record<string, boolean>);
      }
    } catch { toast.error("שגיאה בטעינת הגדרות"); } finally { setLoading(false); }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { error } = await supabase.from("user_settings").update({ work_days: workDays, hours_per_day: hoursPerDay }).eq("user_id", user.id);
      if (error) throw error;
      toast.success("ההגדרות נשמרו! ✅");
      navigate("/");
    } catch { toast.error("שגיאה בשמירה"); } finally { setSaving(false); }
  };

  const handleResetSchedule = () => {
    setHoursPerDay({ monday: 8, tuesday: 8, wednesday: 8, thursday: 8, friday: 8, saturday: 0, sunday: 0 });
    setWorkDays({ monday: true, tuesday: true, wednesday: true, thursday: true, friday: true, saturday: false, sunday: false });
    toast.success("לוח הזמנים אופס");
  };

  const handleExportReport = async () => {
    setExporting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const startDate = new Date(exportYear, exportMonth, 1);
      const endDate = new Date(exportYear, exportMonth + 1, 0);
      const daysInMonth = endDate.getDate();
      const { data: workHoursData } = await supabase.from("work_hours").select("*")
        .eq("user_id", user.id).gte("date", format(startDate, 'yyyy-MM-dd'))
        .lte("date", format(endDate, 'yyyy-MM-dd')).order("date");

      const pdf = new jsPDF();
      const monthName = startDate.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });
      pdf.setFontSize(18); pdf.text(`Work Report - ${monthName}`, 20, 20);
      pdf.setFontSize(11);
      let yPos = 35; let totalHours = 0; let daysWorked = 0;
      for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(exportYear, exportMonth, day);
        const dateStr = format(date, 'yyyy-MM-dd');
        const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
        const entry = workHoursData?.find(wh => wh.date === dateStr);
        if (entry && (entry.status === 'worked' || !entry.status)) {
          const hours = entry.hours_worked || 0;
          totalHours += hours; daysWorked++;
          let line = `${dateStr} (${dayName}): ${hours.toFixed(2)}h`;
          if (entry.start_time && entry.end_time) line += ` (${entry.start_time} - ${entry.end_time})`;
          pdf.text(line, 20, yPos); yPos += 7;
          if (yPos > 270) { pdf.addPage(); yPos = 20; }
        }
      }
      yPos += 10; if (yPos > 250) { pdf.addPage(); yPos = 20; }
      pdf.setFontSize(14); pdf.text('SUMMARY', 20, yPos); yPos += 10;
      pdf.setFontSize(11);
      pdf.text(`Days Worked: ${daysWorked}`, 20, yPos); yPos += 7;
      pdf.text(`Total Hours: ${totalHours.toFixed(2)}`, 20, yPos);
      pdf.save(`work-report-${exportYear}-${String(exportMonth + 1).padStart(2, '0')}.pdf`);
      toast.success("הדוח יוצא בהצלחה! 📄");
    } catch { toast.error("שגיאה בייצוא"); } finally { setExporting(false); }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-12 h-12 rounded-full border-3 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background gradient-warm-bg">
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 right-1/4 w-80 h-80 bg-primary/5 rounded-full blur-3xl animate-float" />
      </div>

      <div className="relative z-10 max-w-xl mx-auto p-4 md:p-6 space-y-4 animate-fade-up">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/")} className="rounded-2xl bg-card shadow-sm border border-border/50 h-11 w-11">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold text-gradient-warm">⚙️ הגדרות</h1>
        </div>

        {/* Work Schedule */}
        <div className="bg-card rounded-3xl p-5 shadow-sm border border-border/50">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold flex items-center gap-2">📋 לוח עבודה</h2>
            <Button variant="ghost" size="sm" onClick={handleResetSchedule} className="text-xs gap-1 text-muted-foreground rounded-xl">
              <RotateCcw className="h-3 w-3" /> איפוס
            </Button>
          </div>
          <div className="space-y-2">
            {daysOfWeek.map(({ key, label, emoji }) => (
              <div key={key} className={`flex items-center justify-between gap-3 p-3 rounded-2xl transition-colors ${
                workDays[key] ? 'bg-primary/5 border border-primary/10' : 'bg-muted/30 border border-transparent'
              }`}>
                <div className="flex items-center gap-3 flex-1">
                  <Switch id={key} checked={workDays[key]} onCheckedChange={() => setWorkDays(prev => ({ ...prev, [key]: !prev[key] }))} />
                  <Label htmlFor={key} className="cursor-pointer text-sm font-medium">{emoji} {label}</Label>
                </div>
                <div className="flex items-center gap-1.5">
                  <Input type="number" step="0.5" min="0" max="24" value={hoursPerDay[key]}
                    onChange={(e) => setHoursPerDay(prev => ({ ...prev, [key]: parseFloat(e.target.value) || 0 }))}
                    className="w-16 text-center text-sm bg-background border-border rounded-xl h-9" disabled={!workDays[key]} />
                  <span className="text-xs text-muted-foreground">h</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Summary */}
        <div className="bg-gradient-to-r from-primary/5 to-secondary/5 bg-card rounded-3xl p-5 shadow-sm border border-border/50">
          <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider mb-3">📊 סיכום שבועי</h3>
          <div className="flex gap-8">
            <div>
              <span className="text-3xl font-bold text-primary">{Object.values(workDays).filter(Boolean).length}</span>
              <span className="text-xs text-muted-foreground ml-1">ימים/שבוע</span>
            </div>
            <div>
              <span className="text-3xl font-bold text-secondary">
                {Object.entries(workDays).filter(([_, v]) => v).reduce((s, [d]) => s + (hoursPerDay[d] || 0), 0).toFixed(1)}
              </span>
              <span className="text-xs text-muted-foreground ml-1">שעות/שבוע</span>
            </div>
          </div>
        </div>

        {/* Export */}
        <div className="bg-card rounded-3xl p-5 shadow-sm border border-border/50">
          <h2 className="text-lg font-bold mb-4">📤 ייצוא דוח</h2>
          <div className="flex gap-3 mb-4">
            <div className="flex-1">
              <Label className="text-xs text-muted-foreground">חודש</Label>
              <Select value={String(exportMonth)} onValueChange={(v) => setExportMonth(Number(v))}>
                <SelectTrigger className="bg-background border-border rounded-xl mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-popover border-border shadow-lg z-50">
                  {Array.from({ length: 12 }, (_, i) => (
                    <SelectItem key={i} value={String(i)}>
                      {new Date(2000, i, 1).toLocaleDateString('he-IL', { month: 'long' })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1">
              <Label className="text-xs text-muted-foreground">שנה</Label>
              <Input type="number" value={String(exportYear)} onChange={(e) => setExportYear(Number(e.target.value.replace(/[^0-9]/g, "")) || new Date().getFullYear())}
                className="bg-background border-border rounded-xl mt-1" />
            </div>
          </div>
          <Button onClick={handleExportReport} disabled={exporting} className="w-full rounded-2xl bg-gradient-to-r from-accent to-success text-accent-foreground h-12 font-semibold">
            <Download className="mr-2 h-4 w-4" /> {exporting ? "מייצא..." : "ייצא דוח PDF"}
          </Button>
        </div>

        <Button onClick={handleSave} disabled={saving} className="w-full rounded-2xl bg-gradient-to-r from-primary to-secondary h-12 font-semibold text-base shadow-md card-glow-pink">
          <Save className="mr-2 h-4 w-4" /> {saving ? "שומר..." : "שמור הגדרות"}
        </Button>
      </div>
    </div>
  );
}
