import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { format } from "date-fns";
import { RotateCcw, Clock, Briefcase, Heart, Palmtree, Flag, XCircle } from "lucide-react";
import { deleteWorkHourByDate, upsertWorkHour, formatHM, fractionMultiplier, DayFraction } from "@/lib/localData";

interface DayInputProps {
  date: Date;
  startTime: string | null;
  endTime: string | null;
  status?: string;
  fraction?: DayFraction;
  paid?: boolean;
  /** Scheduled work hours for this weekday, used to auto-fill sick/vacation hours. */
  dailyTargetHours: number;
  onHoursUpdate: () => void;
}

const fractionLabels: Record<DayFraction, string> = {
  full: "יום מלא",
  three_quarters: "3/4 יום",
  half: "חצי יום",
  quarter: "1/4 יום",
};

const statusConfig: Record<string, { label: string; icon: any; bgClass: string; borderClass: string; emoji: string }> = {
  worked: { label: "עבדתי", icon: Briefcase, bgClass: "bg-card", borderClass: "border-border/50", emoji: "💼" },
  sick: { label: "מחלה", icon: Heart, bgClass: "bg-[hsl(0,80%,55%,0.05)]", borderClass: "border-destructive/20", emoji: "🤒" },
  vacation: { label: "חופשה", icon: Palmtree, bgClass: "bg-[hsl(170,65%,45%,0.05)]", borderClass: "border-accent/20", emoji: "🏖️" },
  holiday: { label: "חג", icon: Flag, bgClass: "bg-[hsl(35,90%,55%,0.05)]", borderClass: "border-secondary/20", emoji: "🎉" },
  not_worked: { label: "לא עבד", icon: XCircle, bgClass: "bg-muted/30", borderClass: "border-border/30", emoji: "⏸️" },
};

export const DayInput = ({ date, startTime, endTime, status = 'worked', fraction, paid, dailyTargetHours, onHoursUpdate }: DayInputProps) => {
  const [start, setStart] = useState(startTime || "");
  const [end, setEnd] = useState(endTime || "");
  const [dayStatus, setDayStatus] = useState(status);
  const [dayFraction, setDayFraction] = useState<DayFraction>(fraction || "full");
  const [isPaid, setIsPaid] = useState(paid !== false);

  const calculateHours = (s: string, e: string) => {
    if (!s || !e) return 0;
    const [sh, sm] = s.split(':').map(Number);
    const [eh, em] = e.split(':').map(Number);
    return ((eh * 60 + em) - (sh * 60 + sm)) / 60;
  };

  const isOff = dayStatus === 'sick' || dayStatus === 'vacation';

  const saveToDatabase = async (
    startValue: string,
    endValue: string,
    statusValue?: string,
    fractionValue?: DayFraction,
    paidValue?: boolean,
  ) => {
    try {
      const dateStr = format(date, 'yyyy-MM-dd');
      const nextStatus = statusValue || dayStatus;
      const nextFraction = fractionValue || dayFraction;
      const nextPaid = paidValue !== undefined ? paidValue : isPaid;
      const nextIsOff = nextStatus === 'sick' || nextStatus === 'vacation';

      const hours = nextIsOff
        ? (nextPaid ? dailyTargetHours * fractionMultiplier(nextFraction) : 0)
        : calculateHours(startValue, endValue);

      upsertWorkHour({
        date: dateStr,
        start_time: nextIsOff ? null : (startValue || null),
        end_time: nextIsOff ? null : (endValue || null),
        hours_worked: hours,
        status: nextStatus,
        fraction: nextIsOff ? nextFraction : undefined,
        paid: nextIsOff ? nextPaid : undefined,
      });
      onHoursUpdate();
    } catch {
      toast.error("שגיאה בשמירה");
    }
  };

  const handleReset = async () => {
    try {
      deleteWorkHourByDate(format(date, 'yyyy-MM-dd'));
      setStart(""); setEnd(""); setDayStatus("worked"); setDayFraction("full"); setIsPaid(true);
      onHoursUpdate();
    } catch {
      toast.error("שגיאה באיפוס");
    }
  };

  const dayName = date.toLocaleDateString('he-IL', { weekday: 'short' });
  const dayNumber = date.getDate();
  const hours = isOff ? (isPaid ? dailyTargetHours * fractionMultiplier(dayFraction) : 0) : calculateHours(start, end);
  const isToday = new Date().toDateString() === date.toDateString();
  const hasData = start || end || dayStatus !== 'worked';
  const config = statusConfig[dayStatus] || statusConfig.worked;

  return (
    <div className={`rounded-2xl p-3 md:p-4 transition-all hover-lift border ${config.borderClass} ${config.bgClass} ${
      isToday ? 'ring-2 ring-primary/30 shadow-md' : 'shadow-sm'
    }`}>
      {/* Top row: Day info + status */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-lg ${
            isToday 
              ? 'bg-gradient-to-br from-primary to-primary-glow text-primary-foreground shadow-sm' 
              : 'bg-muted/50 text-foreground'
          }`}>
            {dayNumber}
          </div>
          <div>
            <span className={`text-xs font-medium ${isToday ? 'text-primary' : 'text-muted-foreground'}`}>
              {dayName}
            </span>
            {isToday && <span className="text-[10px] block text-primary font-semibold">היום</span>}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {hours > 0 && (
            <div className="px-2.5 py-1 rounded-full bg-gradient-to-r from-success/10 to-accent/10 border border-success/20">
              <span className="text-xs font-bold text-success font-mono">{formatHM(hours)}</span>
            </div>
          )}
          {isOff && (
            <span className="text-sm">{config.emoji}</span>
          )}
          <Button 
            variant="ghost" size="icon" onClick={handleReset}
            className="h-7 w-7 rounded-lg text-muted-foreground hover:text-destructive"
            disabled={!hasData}
          >
            <RotateCcw className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Bottom row: Time inputs (or off-day controls) + status */}
      <div className="flex items-center gap-2">
        {!isOff ? (
          <div className="flex items-center gap-1.5 flex-1">
            <Input
              type="time"
              value={start}
              onChange={(e) => { setStart(e.target.value); saveToDatabase(e.target.value, end); }}
              className="h-9 text-xs bg-background border-border/50 rounded-xl flex-1 min-w-0"
            />
            <span className="text-muted-foreground text-xs">→</span>
            <Input
              type="time"
              value={end}
              onChange={(e) => { setEnd(e.target.value); saveToDatabase(start, e.target.value); }}
              className="h-9 text-xs bg-background border-border/50 rounded-xl flex-1 min-w-0"
            />
          </div>
        ) : (
          <div className="flex items-center gap-1.5 flex-1">
            <Select
              value={dayFraction}
              onValueChange={(v) => { const f = v as DayFraction; setDayFraction(f); saveToDatabase(start, end, dayStatus, f); }}
            >
              <SelectTrigger className="h-9 text-xs bg-background border-border/50 rounded-xl flex-1 min-w-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-popover border-border shadow-lg z-50">
                {(Object.entries(fractionLabels) as [DayFraction, string][]).map(([key, label]) => (
                  <SelectItem key={key} value={key} className="text-xs">{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              onClick={() => { const p = !isPaid; setIsPaid(p); saveToDatabase(start, end, dayStatus, dayFraction, p); }}
              className={`h-9 px-3 text-[11px] rounded-xl shrink-0 border ${
                isPaid ? 'bg-success/10 border-success/30 text-success' : 'bg-destructive/10 border-destructive/30 text-destructive'
              }`}
            >
              {isPaid ? 'משולם' : 'לא משולם'}
            </Button>
          </div>
        )}

        <Select value={dayStatus} onValueChange={(v) => { setDayStatus(v); saveToDatabase(start, end, v, dayFraction, isPaid); }}>
          <SelectTrigger className="h-9 w-24 text-[11px] bg-background border-border/50 rounded-xl shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-popover border-border shadow-lg z-50">
            {Object.entries(statusConfig).map(([key, conf]) => (
              <SelectItem key={key} value={key} className="text-xs">
                <span className="flex items-center gap-1.5">
                  <span>{conf.emoji}</span>
                  <span>{conf.label}</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
};
