interface ProgressBarProps {
  worked: number;
  goal: number;
}

export const ProgressBar = ({ worked, goal }: ProgressBarProps) => {
  const percentage = goal > 0 ? Math.min((worked / goal) * 100, 100) : 0;
  const remaining = Math.max(goal - worked, 0);
  const isOverGoal = worked > goal;

  return (
    <div className="bg-card rounded-2xl p-5 shadow-sm border border-border/50 animate-fade-up">
      <div className="flex justify-between items-center mb-3">
        <span className="text-sm font-medium text-foreground">התקדמות חודשית</span>
        <span className={`text-sm font-bold ${isOverGoal ? 'text-success' : 'text-primary'}`}>
          {percentage.toFixed(0)}%
        </span>
      </div>
      
      <div className="h-4 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-1000 ease-out relative overflow-hidden ${
            isOverGoal 
              ? 'bg-gradient-to-r from-success to-accent' 
              : 'bg-gradient-to-r from-primary via-primary-glow to-secondary'
          }`}
          style={{ width: `${percentage}%` }}
        >
          {/* Shimmer effect */}
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent" 
               style={{ animation: 'shimmer 2s infinite', backgroundSize: '200% 100%' }} />
        </div>
      </div>

      <div className="flex justify-between text-xs mt-2">
        <span className="text-muted-foreground font-medium">{worked.toFixed(1)}h הושלמו</span>
        <span className={`font-semibold ${isOverGoal ? 'text-success' : 'text-secondary'}`}>
          {isOverGoal ? `+${(worked - goal).toFixed(1)}h מעל היעד! 🔥` : `${remaining.toFixed(1)}h נותרו`}
        </span>
      </div>
    </div>
  );
};
