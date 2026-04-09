import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { LogOut, Settings, Sun, Moon, Sunrise } from "lucide-react";
import { getProfileFirstName } from "@/lib/localData";

interface DashboardHeaderProps {
  onSettings: () => void;
  onSignOut: () => void;
}

export const DashboardHeader = ({ onSettings, onSignOut }: DashboardHeaderProps) => {
  const [firstName, setFirstName] = useState("");

  useEffect(() => {
    setFirstName(getProfileFirstName());
  }, []);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return { text: "בוקר טוב", icon: Sunrise, emoji: "☀️" };
    if (hour < 17) return { text: "צהריים טובים", icon: Sun, emoji: "🌤️" };
    if (hour < 21) return { text: "ערב טוב", icon: Moon, emoji: "🌅" };
    return { text: "לילה טוב", icon: Moon, emoji: "🌙" };
  };

  const greeting = getGreeting();
  const todayLabel = new Intl.DateTimeFormat("he-IL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());

  return (
    <header className="animate-fade-up">
      <div className="flex justify-between items-start">
        <div className="text-left">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-2xl">{greeting.emoji}</span>
            <span className="text-sm font-medium text-muted-foreground">{greeting.text}</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-gradient-warm">
            {firstName ? `${firstName}!` : 'WorkTrack'}
          </h1>
          <p className="mt-1 text-xl md:text-2xl font-extrabold text-gradient-warm leading-tight">
            {todayLabel}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={onSettings}
            className="rounded-2xl bg-card hover:bg-primary/10 transition-all hover-lift shadow-sm h-11 w-11"
          >
            <Settings className="h-5 w-5 text-muted-foreground" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onSignOut}
            className="rounded-2xl bg-card hover:bg-destructive/10 transition-all hover-lift shadow-sm h-11 w-11"
          >
            <LogOut className="h-5 w-5 text-muted-foreground" />
          </Button>
        </div>
      </div>
    </header>
  );
};
