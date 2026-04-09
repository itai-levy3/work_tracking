import { useState, useEffect } from "react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { DashboardHeader } from "./dashboard/DashboardHeader";
import { StatsCards } from "./dashboard/StatsCards";
import { MonthSelector } from "./MonthSelector";
import { ProgressBar } from "./ProgressBar";
import { TimeCalculator } from "./TimeCalculator";
import { DaysList } from "./dashboard/DaysList";
import { clearMonthWorkHours, getSettings, getWorkHoursForMonth, WorkHour } from "@/lib/localData";
import { logoutLocalAuth } from "@/lib/localAuth";

export const Dashboard = () => {
  const navigate = useNavigate();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [workHours, setWorkHours] = useState<WorkHour[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadData(); }, [currentMonth]);

  const loadData = async () => {
    try {
      const settingsData = getSettings();
      const hoursData = getWorkHoursForMonth(currentMonth.getFullYear(), currentMonth.getMonth());
      setSettings(settingsData);
      setWorkHours(hoursData || []);
    } catch {
      toast.error("שגיאה בטעינת נתונים");
    } finally {
      setLoading(false);
    }
  };

  const handleClearMonth = async () => {
    try {
      clearMonthWorkHours(currentMonth.getFullYear(), currentMonth.getMonth());
      toast.success("הנתונים נמחקו בהצלחה");
      loadData();
    } catch {
      toast.error("שגיאה במחיקת נתונים");
    }
  };

  const handleSignOut = () => {
    logoutLocalAuth();
    toast.success("התנתקת בהצלחה");
  };

  const calculateMonthlyGoal = () => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    let totalHours = 0;
    const workDaysSettings = settings?.work_days as Record<string, boolean>;
    const hoursPerDaySettings = settings?.hours_per_day as Record<string, number>;
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      const dayName = date.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
      if (workDaysSettings && workDaysSettings[dayName]) {
        totalHours += hoursPerDaySettings?.[dayName] || 0;
      }
    }
    return totalHours;
  };

  const getDaysInMonth = () => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const days: Date[] = [];
    for (let day = 1; day <= daysInMonth; day++) days.push(new Date(year, month, day));
    return days;
  };

  const totalWorked = workHours.reduce((sum, wh) => {
    if (wh.status === 'worked' || !wh.status) return sum + Number(wh.hours_worked || 0);
    return sum;
  }, 0);

  const daysWorkedCount = workHours.filter(wh => 
    (wh.status === 'worked' || !wh.status) && Number(wh.hours_worked || 0) > 0
  ).length;

  const monthlyGoal = calculateMonthlyGoal();
  const days = getDaysInMonth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4 animate-fade-up">
          <div className="w-14 h-14 rounded-full border-3 border-primary border-t-transparent animate-spin" />
          <p className="text-muted-foreground text-sm font-medium">טוען את הנתונים שלך...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background gradient-warm-bg">
      {/* Ambient blobs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-20 -left-20 w-80 h-80 bg-primary/8 rounded-full blur-3xl animate-float" />
        <div className="absolute top-1/2 -right-20 w-64 h-64 bg-secondary/10 rounded-full blur-3xl animate-float" style={{ animationDelay: '2s' }} />
        <div className="absolute -bottom-20 left-1/3 w-72 h-72 bg-accent/8 rounded-full blur-3xl animate-float" style={{ animationDelay: '4s' }} />
      </div>

      <div className="relative z-10 max-w-xl mx-auto p-4 md:p-6 pb-20 space-y-4">
        <DashboardHeader onSettings={() => navigate("/settings")} onSignOut={handleSignOut} />
        <MonthSelector currentMonth={currentMonth} onMonthChange={setCurrentMonth} />
        <StatsCards totalWorked={totalWorked} monthlyGoal={monthlyGoal} daysWorked={daysWorkedCount} workHours={workHours} />
        <ProgressBar worked={totalWorked} goal={monthlyGoal} />
        {settings && (
          <TimeCalculator
            totalWorked={totalWorked} monthlyGoal={monthlyGoal}
            hoursPerDay={settings.hours_per_day as Record<string, number>}
            workDays={settings.work_days} currentMonth={currentMonth}
          />
        )}
        <DaysList days={days} workHours={workHours} onHoursUpdate={loadData} onClearMonth={handleClearMonth} currentMonth={currentMonth} />
      </div>
    </div>
  );
};
