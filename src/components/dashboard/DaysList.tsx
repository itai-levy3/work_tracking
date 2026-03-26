import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { DayInput } from "../DayInput";
import { format } from "date-fns";

interface WorkHour {
  date: string;
  hours_worked: number;
  start_time: string | null;
  end_time: string | null;
  status?: string;
}

interface DaysListProps {
  days: Date[];
  workHours: WorkHour[];
  onHoursUpdate: () => void;
  onClearMonth: () => void;
  currentMonth: Date;
}

export const DaysList = ({ days, workHours, onHoursUpdate, onClearMonth, currentMonth }: DaysListProps) => {
  const getTimesForDay = (date: Date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    const entry = workHours.find(wh => wh.date === dateStr);
    return {
      startTime: entry?.start_time || null,
      endTime: entry?.end_time || null,
      status: entry?.status || 'worked',
    };
  };

  return (
    <div className="animate-fade-up" style={{ animationDelay: '0.3s' }}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
          📋 לוח ימים
        </h3>
        <span className="text-xs text-muted-foreground">
          {workHours.filter(wh => (wh.status === 'worked' || !wh.status) && Number(wh.hours_worked) > 0).length} ימים מלאים
        </span>
      </div>

      <div className="grid gap-2">
        {days.map((day, index) => {
          const { startTime, endTime, status } = getTimesForDay(day);
          const dateKey = format(day, 'yyyy-MM-dd');
          return (
            <DayInput
              key={dateKey}
              date={day}
              startTime={startTime}
              endTime={endTime}
              status={status}
              onHoursUpdate={onHoursUpdate}
            />
          );
        })}
      </div>
      
      <div className="mt-4">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button 
              variant="destructive" 
              className="w-full rounded-2xl h-12"
              disabled={workHours.length === 0}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              מחק את כל נתוני החודש
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent className="bg-popover border-border">
            <AlertDialogHeader>
              <AlertDialogTitle>בטוח למחוק?</AlertDialogTitle>
              <AlertDialogDescription>
                פעולה זו תמחק לצמיתות את כל שעות העבודה של {currentMonth.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' })}. 
                לא ניתן לבטל פעולה זו.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>ביטול</AlertDialogCancel>
              <AlertDialogAction onClick={onClearMonth} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                מחק הכל
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
};
