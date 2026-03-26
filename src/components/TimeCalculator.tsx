import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Timer, Clock } from "lucide-react";

interface TimeCalculatorProps {
  totalWorked: number;
  monthlyGoal: number;
  hoursPerDay: Record<string, number>;
  workDays: any;
  currentMonth: Date;
}

export const TimeCalculator = ({
  totalWorked,
  monthlyGoal,
  hoursPerDay,
  workDays,
  currentMonth,
}: TimeCalculatorProps) => {
  const [startTime, setStartTime] = useState("");
  const [result, setResult] = useState<string | null>(null);

  const calculateFinishTime = (time: string) => {
    if (!time) { setResult(null); return; }
    const today = new Date();
    const dayName = today.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
    const workDaysSettings = workDays as Record<string, boolean>;
    
    if (!workDaysSettings[dayName]) {
      setResult("היום הוא לא יום עבודה 🏖️");
      return;
    }
    
    const requiredHoursToday = hoursPerDay[dayName] || 0;
    if (requiredHoursToday === 0) {
      setResult("היום הוא לא יום עבודה 🏖️");
      return;
    }

    const [startHour, startMin] = time.split(':').map(Number);
    const startDate = new Date(today);
    startDate.setHours(startHour, startMin, 0, 0);
    
    const finishDate = new Date(startDate.getTime() + requiredHoursToday * 60 * 60 * 1000);
    const hh = String(finishDate.getHours()).padStart(2, '0');
    const mm = String(finishDate.getMinutes()).padStart(2, '0');

    setResult(`סיום ב-${hh}:${mm} (${requiredHoursToday} שעות נדרשות)`);
  };

  const getTodayRequiredHours = () => {
    const today = new Date();
    const dayName = today.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
    const workDaysSettings = workDays as Record<string, boolean>;
    if (!workDaysSettings[dayName]) return 0;
    return hoursPerDay[dayName] || 0;
  };

  const todayHours = getTodayRequiredHours();

  return (
    <div className="bg-gradient-to-br from-[hsl(340,75%,55%,0.05)] to-[hsl(35,90%,55%,0.05)] bg-card rounded-2xl p-5 shadow-sm border border-border/50 animate-fade-up">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center">
          <Timer className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h3 className="font-semibold text-foreground">טיימר יומי ⏱️</h3>
          <p className="text-xs text-muted-foreground">
            {todayHours > 0 ? `${todayHours} שעות נדרשות היום` : 'היום יום חופש! 🎉'}
          </p>
        </div>
      </div>
      
      <div className="space-y-3">
        <div>
          <Label htmlFor="start-time" className="text-xs font-medium text-muted-foreground">שעת התחלה</Label>
          <Input
            id="start-time"
            type="time"
            value={startTime}
            onChange={(e) => {
              setStartTime(e.target.value);
              calculateFinishTime(e.target.value);
            }}
            className="bg-background border-border rounded-xl mt-1 h-11"
          />
        </div>

        {result && (
          <div className="p-3 rounded-xl bg-gradient-to-r from-success/10 to-accent/10 border border-success/20 animate-scale-in">
            <p className="text-sm text-success font-semibold">{result}</p>
          </div>
        )}
      </div>
    </div>
  );
};
