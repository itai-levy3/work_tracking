import { Clock, Target, CalendarDays, TrendingUp, Award } from "lucide-react";

interface StatsCardsProps {
  totalWorked: number;
  monthlyGoal: number;
  daysWorked: number;
  workHours: { date: string; hours_worked: number; status?: string }[];
}

export const StatsCards = ({ totalWorked, monthlyGoal, daysWorked, workHours }: StatsCardsProps) => {
  const avgHours = daysWorked > 0 ? totalWorked / daysWorked : 0;
  const percentage = monthlyGoal > 0 ? Math.min((totalWorked / monthlyGoal) * 100, 100) : 0;

  const topStats = [
    {
      label: "יעד חודשי",
      value: monthlyGoal.toFixed(0),
      suffix: "h",
      icon: Target,
      bg: "from-[hsl(35,90%,55%,0.15)] to-[hsl(25,85%,50%,0.08)]",
      iconColor: "text-secondary",
    },
    {
      label: "ימי עבודה",
      value: String(daysWorked),
      suffix: "",
      icon: CalendarDays,
      bg: "from-[hsl(170,65%,45%,0.15)] to-[hsl(160,60%,40%,0.08)]",
      iconColor: "text-accent",
    },
  ];

  const bottomStats = [
    {
      label: "ממוצע יומי",
      value: avgHours.toFixed(1),
      suffix: "h",
      icon: TrendingUp,
      bg: "from-[hsl(210,80%,55%,0.15)] to-[hsl(230,75%,55%,0.08)]",
      iconColor: "text-info",
    },
    {
      label: "התקדמות",
      value: percentage.toFixed(0),
      suffix: "%",
      icon: Award,
      bg: "from-[hsl(340,75%,55%,0.15)] to-[hsl(320,70%,60%,0.08)]",
      iconColor: "text-primary",
    },
  ];

  const CircleStat = ({ stat, delay }: { stat: typeof topStats[0]; delay: number }) => (
    <div
      className={`w-[9.5rem] h-[9.5rem] rounded-full bg-gradient-to-br ${stat.bg} bg-card border border-border/50 flex flex-col items-center justify-center hover-lift transition-all animate-fade-up`}
      style={{ animationDelay: `${delay}s` }}
    >
      <p className="text-3xl font-bold text-foreground leading-none">
        {stat.value}
        {stat.suffix && <span className="text-sm font-normal text-muted-foreground ml-0.5">{stat.suffix}</span>}
      </p>
      <p className="text-xs text-muted-foreground mt-1.5 font-medium">{stat.label}</p>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Top two circles */}
      <div className="flex justify-center gap-4">
        {topStats.map((stat, i) => (
          <CircleStat key={stat.label} stat={stat} delay={i * 0.1} />
        ))}
      </div>

      {/* Hero hours - big centered */}
      <div className="flex flex-col items-center justify-center py-2">
        <div className="flex items-center gap-2 mb-1">
          <Clock className="h-5 w-5 text-primary animate-pulse" />
          <span className="text-xs font-medium text-muted-foreground tracking-wide">שעות עבודה</span>
        </div>
        <p
          className="text-7xl font-black text-transparent bg-clip-text bg-gradient-to-br from-primary via-[hsl(340,80%,55%)] to-secondary leading-none tracking-tight"
          style={{
            textShadow: '0 4px 24px hsl(340 75% 55% / 0.3), 0 2px 8px hsl(25 85% 50% / 0.2)',
          }}
        >
          {totalWorked.toFixed(1)}
          <span className="text-2xl font-bold ml-1">h</span>
        </p>
      </div>

      {/* Bottom two circles */}
      <div className="flex justify-center gap-4">
        {bottomStats.map((stat, i) => (
          <CircleStat key={stat.label} stat={stat} delay={(i + 2) * 0.1} />
        ))}
      </div>

      {/* Achievement */}
      {percentage >= 100 && (
        <div className="flex items-center gap-3 bg-gradient-to-r from-[hsl(145,65%,42%,0.1)] to-[hsl(170,65%,45%,0.05)] rounded-full p-4 border border-success/20 animate-scale-in">
          <div className="w-10 h-10 rounded-full bg-success/15 flex items-center justify-center">
            <Award className="h-5 w-5 text-success" />
          </div>
          <div>
            <p className="font-semibold text-success text-sm">יעד הושג! 🎉</p>
            <p className="text-xs text-muted-foreground">עברת את היעד ב-{(totalWorked - monthlyGoal).toFixed(1)} שעות</p>
          </div>
        </div>
      )}
    </div>
  );
};
