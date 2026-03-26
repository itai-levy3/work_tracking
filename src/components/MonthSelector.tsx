import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Calendar } from "lucide-react";

interface MonthSelectorProps {
  currentMonth: Date;
  onMonthChange: (date: Date) => void;
}

export const MonthSelector = ({ currentMonth, onMonthChange }: MonthSelectorProps) => {
  const handlePrevMonth = () => {
    const newDate = new Date(currentMonth);
    newDate.setMonth(newDate.getMonth() - 1);
    onMonthChange(newDate);
  };

  const handleNextMonth = () => {
    const newDate = new Date(currentMonth);
    newDate.setMonth(newDate.getMonth() + 1);
    onMonthChange(newDate);
  };

  const monthYear = currentMonth.toLocaleDateString('he-IL', {
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="flex items-center justify-between bg-card rounded-2xl px-4 py-3 shadow-sm border border-border/50 animate-fade-up">
      <Button
        size="icon"
        variant="ghost"
        onClick={handlePrevMonth}
        className="rounded-xl h-10 w-10 hover:bg-primary/10 transition-all"
      >
        <ChevronLeft className="h-5 w-5" />
      </Button>
      <div className="flex items-center gap-2">
        <Calendar className="h-4 w-4 text-primary" />
        <h2 className="text-lg font-semibold text-foreground">
          {monthYear}
        </h2>
      </div>
      <Button
        size="icon"
        variant="ghost"
        onClick={handleNextMonth}
        className="rounded-xl h-10 w-10 hover:bg-primary/10 transition-all"
      >
        <ChevronRight className="h-5 w-5" />
      </Button>
    </div>
  );
};
