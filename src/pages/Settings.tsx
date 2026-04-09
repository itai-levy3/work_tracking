import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { ArrowLeft, Save, Download, RotateCcw, Upload } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import jsPDF from "jspdf";
import { format } from "date-fns";
import { exportLocalBackup, getSettings, getWorkHoursForMonth, importLocalBackup, LocalBackupFile, replaceCurrentUserData, saveSettings, UserSettings, WorkHour } from "@/lib/localData";
import { isLocalAuthenticated } from "@/lib/localAuth";

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
  const [hourlyRate, setHourlyRate] = useState<number>(0);
  const [exportMonth, setExportMonth] = useState(new Date().getMonth());
  const [exportYear, setExportYear] = useState(new Date().getFullYear());
  const [exporting, setExporting] = useState(false);
  const [backupLoading, setBackupLoading] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const restoreInputRef = useRef<HTMLInputElement>(null);
  const importWorkHoursRef = useRef<HTMLInputElement>(null);
  const importSettingsRef = useRef<HTMLInputElement>(null);
  const importProfilesRef = useRef<HTMLInputElement>(null);
  const [workHoursFile, setWorkHoursFile] = useState<File | null>(null);
  const [settingsFile, setSettingsFile] = useState<File | null>(null);
  const [profilesFile, setProfilesFile] = useState<File | null>(null);

  useEffect(() => {
    if (!isLocalAuthenticated()) {
      navigate("/");
      return;
    }
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const data = getSettings();
      if (data) {
        setHoursPerDay(data.hours_per_day as Record<string, number>);
        setWorkDays(data.work_days as Record<string, boolean>);
        setHourlyRate(Number(data.hourly_rate || 0));
      }
    } catch { toast.error("שגיאה בטעינת הגדרות"); } finally { setLoading(false); }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      saveSettings({ work_days: workDays, hours_per_day: hoursPerDay, hourly_rate: hourlyRate });
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
      const startDate = new Date(exportYear, exportMonth, 1);
      const endDate = new Date(exportYear, exportMonth + 1, 0);
      const daysInMonth = endDate.getDate();
      const workHoursData = getWorkHoursForMonth(exportYear, exportMonth);

      const pdf = new jsPDF();
      const monthName = startDate.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });
      pdf.setFontSize(18); pdf.text(`Work Report - ${monthName}`, 20, 20);
      pdf.setFontSize(11);
      let yPos = 35; let totalHours = 0; let daysWorked = 0; let totalEarnings = 0;
      for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(exportYear, exportMonth, day);
        const dateStr = format(date, 'yyyy-MM-dd');
        const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
        const entry = workHoursData?.find(wh => wh.date === dateStr);
        if (entry && (entry.status === 'worked' || !entry.status)) {
          const hours = entry.hours_worked || 0;
          const earnings = hours * hourlyRate;
          totalHours += hours; daysWorked++;
          totalEarnings += earnings;
          let line = `${dateStr} (${dayName}): ${hours.toFixed(2)}h | ${earnings.toFixed(2)} ILS`;
          if (entry.start_time && entry.end_time) line += ` (${entry.start_time} - ${entry.end_time})`;
          pdf.text(line, 20, yPos); yPos += 7;
          if (yPos > 270) { pdf.addPage(); yPos = 20; }
        }
      }
      yPos += 10; if (yPos > 250) { pdf.addPage(); yPos = 20; }
      pdf.setFontSize(14); pdf.text('SUMMARY', 20, yPos); yPos += 10;
      pdf.setFontSize(11);
      pdf.text(`Days Worked: ${daysWorked}`, 20, yPos); yPos += 7;
      pdf.text(`Total Hours: ${totalHours.toFixed(2)}`, 20, yPos); yPos += 7;
      pdf.text(`Hourly Rate: ${hourlyRate.toFixed(2)} ILS`, 20, yPos); yPos += 7;
      pdf.text(`Total Earnings: ${totalEarnings.toFixed(2)} ILS`, 20, yPos);
      pdf.save(`work-report-${exportYear}-${String(exportMonth + 1).padStart(2, '0')}.pdf`);
      toast.success("הדוח יוצא בהצלחה! 📄");
    } catch { toast.error("שגיאה בייצוא"); } finally { setExporting(false); }
  };

  const handleExportBackup = async () => {
    setBackupLoading(true);
    try {
      const backup = exportLocalBackup();

      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `worktrack-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);

      toast.success("קובץ גיבוי נשמר בהצלחה");
    } catch {
      toast.error("שגיאה ביצירת הגיבוי");
    } finally {
      setBackupLoading(false);
    }
  };

  const handleRestoreBackup = async (file: File) => {
    setBackupLoading(true);
    try {
      const content = await file.text();
      const parsed = JSON.parse(content) as Partial<LocalBackupFile>;

      if (!parsed || parsed.version !== 1 || !parsed.user_settings || !Array.isArray(parsed.work_hours)) {
        throw new Error("Invalid backup format");
      }

      importLocalBackup(parsed as LocalBackupFile);

      setWorkDays(parsed.user_settings.work_days as Record<string, boolean>);
      setHoursPerDay(parsed.user_settings.hours_per_day as Record<string, number>);
      toast.success("השחזור הושלם בהצלחה");
    } catch {
      toast.error("קובץ הגיבוי לא תקין או ששחזור נכשל");
    } finally {
      setBackupLoading(false);
      if (restoreInputRef.current) restoreInputRef.current.value = "";
    }
  };

  const parseCsv = (text: string): string[][] => {
    const lines = text.replace(/\r\n/g, "\n").split("\n").filter(Boolean);
    return lines.map((line) => {
      const cells: string[] = [];
      let current = "";
      let inQuotes = false;
      for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuotes && line[i + 1] === '"') {
            current += '"';
            i += 1;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (ch === ";" && !inQuotes) {
          cells.push(current);
          current = "";
        } else {
          current += ch;
        }
      }
      cells.push(current);
      return cells;
    });
  };

  const parseJsonCell = <T,>(value: string, fallback: T): T => {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  };

  const normalizeTime = (value: string) => (value ? value.slice(0, 5) : null);

  const handleImportFromLovableCsv = async () => {
    if (!workHoursFile || !settingsFile || !profilesFile) {
      toast.error("צריך לבחור את שלושת קבצי ה-CSV");
      return;
    }
    setImportLoading(true);
    try {
      const [workText, settingsText, profilesText] = await Promise.all([
        workHoursFile.text(),
        settingsFile.text(),
        profilesFile.text(),
      ]);

      const workRows = parseCsv(workText);
      const settingsRows = parseCsv(settingsText);
      const profilesRows = parseCsv(profilesText);

      const workHeader = workRows[0];
      const settingsHeader = settingsRows[0];
      const profilesHeader = profilesRows[0];

      const idx = (header: string[], name: string) => header.indexOf(name);

      const workUserIdIndex = idx(workHeader, "user_id");
      const dateIndex = idx(workHeader, "date");
      const hoursIndex = idx(workHeader, "hours_worked");
      const startIndex = idx(workHeader, "start_time");
      const endIndex = idx(workHeader, "end_time");
      const statusIndex = idx(workHeader, "status");

      const counts: Record<string, number> = {};
      workRows.slice(1).forEach((row) => {
        const uid = row[workUserIdIndex];
        if (uid) counts[uid] = (counts[uid] || 0) + 1;
      });
      const selectedUserId = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
      if (!selectedUserId) throw new Error("לא נמצא user_id בקובץ שעות");

      const workHours: WorkHour[] = workRows
        .slice(1)
        .filter((row) => row[workUserIdIndex] === selectedUserId)
        .map((row) => ({
          date: row[dateIndex],
          hours_worked: Number(row[hoursIndex] || 0),
          start_time: normalizeTime(row[startIndex] || ""),
          end_time: normalizeTime(row[endIndex] || ""),
          status: row[statusIndex] || "worked",
        }));

      const settingsUserIdIndex = idx(settingsHeader, "user_id");
      const workDaysIndex = idx(settingsHeader, "work_days");
      const hoursPerDayIndex = idx(settingsHeader, "hours_per_day");

      const selectedSettingsRow =
        settingsRows.slice(1).find((row) => row[settingsUserIdIndex] === selectedUserId) ??
        settingsRows[1];
      const importedSettings: UserSettings = selectedSettingsRow
        ? {
            work_days: parseJsonCell<Record<string, boolean>>(selectedSettingsRow[workDaysIndex], workDays),
            hours_per_day: parseJsonCell<Record<string, number>>(selectedSettingsRow[hoursPerDayIndex], hoursPerDay),
            hourly_rate: hourlyRate,
          }
        : { work_days: workDays, hours_per_day: hoursPerDay, hourly_rate: hourlyRate };

      const profileUserIdIndex = idx(profilesHeader, "user_id");
      const firstNameIndex = idx(profilesHeader, "first_name");
      const selectedProfileRow =
        profilesRows.slice(1).find((row) => row[profileUserIdIndex] === selectedUserId) ??
        profilesRows[1];
      const firstName = selectedProfileRow?.[firstNameIndex] || "WorkTrack";

      replaceCurrentUserData({
        settings: importedSettings,
        workHours,
        firstName,
      });
      setWorkDays(importedSettings.work_days);
      setHoursPerDay(importedSettings.hours_per_day);
      setHourlyRate(importedSettings.hourly_rate);
      toast.success(`יובאו ${workHours.length} רשומות מהגיבוי של Lovable`);
    } catch {
      toast.error("שגיאה בייבוא קבצי CSV");
    } finally {
      setImportLoading(false);
    }
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
          <div className="mb-4 p-3 rounded-2xl bg-primary/5 border border-primary/10">
            <Label className="text-xs text-muted-foreground">שכר לשעה (₪)</Label>
            <Input
              type="number"
              step="0.5"
              min="0"
              value={String(hourlyRate)}
              onChange={(e) => setHourlyRate(parseFloat(e.target.value) || 0)}
              className="bg-background border-border rounded-xl mt-1 h-10"
            />
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

        {/* Local backup and restore */}
        <div className="bg-card rounded-3xl p-5 shadow-sm border border-border/50">
          <h2 className="text-lg font-bold mb-2">💾 גיבוי ושחזור מקומי</h2>
          <p className="text-sm text-muted-foreground mb-4">
            שמור קובץ גיבוי על המחשב, ותוכל לשחזר נתונים גם אחרי מחיקת נתוני דפדפן.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Button
              onClick={handleExportBackup}
              disabled={backupLoading}
              className="rounded-2xl bg-gradient-to-r from-primary to-secondary h-11 font-semibold"
            >
              <Download className="mr-2 h-4 w-4" />
              {backupLoading ? "מעבד..." : "ייצא גיבוי JSON"}
            </Button>
            <Button
              variant="outline"
              onClick={() => restoreInputRef.current?.click()}
              disabled={backupLoading}
              className="rounded-2xl h-11 font-semibold"
            >
              <Upload className="mr-2 h-4 w-4" />
              {backupLoading ? "מעבד..." : "שחזר מגיבוי"}
            </Button>
          </div>
          <input
            ref={restoreInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleRestoreBackup(file);
            }}
          />
        </div>

        <div className="bg-card rounded-3xl p-5 shadow-sm border border-border/50">
          <h2 className="text-lg font-bold mb-2">📥 ייבוא מ-Lovable CSV</h2>
          <p className="text-sm text-muted-foreground mb-4">
            בחר את שלושת קבצי ה-CSV שייצאת, והמערכת תייבא את הנתונים למשתמש הנוכחי.
          </p>
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => importWorkHoursRef.current?.click()} className="rounded-xl">
                {workHoursFile ? "✅ work_hours נבחר" : "בחר work_hours CSV"}
              </Button>
              <Button variant="outline" onClick={() => importSettingsRef.current?.click()} className="rounded-xl">
                {settingsFile ? "✅ user_settings נבחר" : "בחר user_settings CSV"}
              </Button>
            </div>
            <Button variant="outline" onClick={() => importProfilesRef.current?.click()} className="rounded-xl w-full">
              {profilesFile ? "✅ profiles נבחר" : "בחר profiles CSV"}
            </Button>
            <Button
              onClick={handleImportFromLovableCsv}
              disabled={importLoading}
              className="w-full rounded-2xl bg-gradient-to-r from-primary to-secondary h-11 font-semibold"
            >
              {importLoading ? "מייבא..." : "ייבא עכשיו ללוקאלי"}
            </Button>
          </div>
          <input
            ref={importWorkHoursRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => setWorkHoursFile(e.target.files?.[0] ?? null)}
          />
          <input
            ref={importSettingsRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => setSettingsFile(e.target.files?.[0] ?? null)}
          />
          <input
            ref={importProfilesRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => setProfilesFile(e.target.files?.[0] ?? null)}
          />
        </div>

        <Button onClick={handleSave} disabled={saving} className="w-full rounded-2xl bg-gradient-to-r from-primary to-secondary h-12 font-semibold text-base shadow-md card-glow-pink">
          <Save className="mr-2 h-4 w-4" /> {saving ? "שומר..." : "שמור הגדרות"}
        </Button>
      </div>
    </div>
  );
}
