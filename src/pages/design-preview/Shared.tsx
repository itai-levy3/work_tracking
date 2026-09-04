import { Link } from "react-router-dom";
import { getProfileFirstName } from "@/lib/localData";
import { LH } from "./tokens";

export const globalStyle = `
  .material-symbols-outlined {
    font-family: 'Material Symbols Outlined';
    font-weight: normal;
    font-style: normal;
    font-size: 24px;
    line-height: 1;
    letter-spacing: normal;
    text-transform: none;
    display: inline-block;
    white-space: nowrap;
    word-wrap: normal;
    direction: ltr;
    -webkit-font-feature-settings: 'liga';
    -webkit-font-smoothing: antialiased;
  }
  .tabular-nums { font-variant-numeric: tabular-nums; }
  .lh-rise { animation: lh-rise .7s cubic-bezier(.16,1,.3,1) both; }
  @keyframes lh-rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
`;

const loadingStyle = `
  @keyframes lh-loading-fill { 0% { width: 4%; } 55% { width: 68%; } 100% { width: 92%; } }
  .lh-loading-bar { width: 4%; animation: lh-loading-fill 1.8s cubic-bezier(.2,.8,.3,1) forwards; }
  @keyframes lh-loading-pulse { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.06); opacity: 0.85; } }
  .lh-loading-badge { animation: lh-loading-pulse 1.6s ease-in-out infinite; }
`;

/** Full-screen branded loading state — a progress bar that reads as "actually going somewhere"
 * instead of a bare spinner, shown while a page's own data (settings/entries/auth check) loads. */
export function LHLoadingScreen() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6" style={{ background: LH.background }}>
      <style>{loadingStyle}</style>
      <div
        className="lh-loading-badge w-16 h-16 rounded-2xl flex items-center justify-center"
        style={{ background: "linear-gradient(155deg,#7639FF,#00D2FF)", boxShadow: "0 20px 45px -12px rgba(118,57,255,0.5)" }}
      >
        <span className="material-symbols-outlined text-white" style={{ fontSize: 30 }}>bolt</span>
      </div>
      <div className="w-48 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(35,50,100,0.08)" }}>
        <div className="lh-loading-bar h-full rounded-full" style={{ background: "linear-gradient(90deg,#7639FF,#00D2FF)" }} />
      </div>
      <span className="text-[11.5px] font-bold tracking-[0.1em] uppercase" style={{ color: "#8892b0" }}>טוען נתונים...</span>
    </div>
  );
}

export function LHHeader() {
  return (
    <header className="fixed top-0 inset-x-0 z-50 bg-[#F8FAFF]/70 backdrop-blur-2xl" style={{ paddingTop: "env(safe-area-inset-top,0px)" }}>
      <div className="h-20 px-6 flex items-center justify-between max-w-[440px] mx-auto">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: LH.primary, boxShadow: `0 10px 20px -6px ${LH.primary}4D` }}>
            <span className="material-symbols-outlined text-white text-[20px]">person</span>
          </div>
          <span className="text-[17px] leading-6 font-bold" style={{ color: LH.onSurface }}>שלום, {getProfileFirstName()}</span>
        </div>
        <button className="w-11 h-11 flex items-center justify-center rounded-full hover:bg-[#f0edf1] transition-colors duration-300">
          <span className="material-symbols-outlined text-[24px]" style={{ color: LH.onSurfaceVariant }}>notifications</span>
        </button>
      </div>
    </header>
  );
}

const navItems = [
  { path: "/design-preview/settings", icon: "settings" },
  { path: "/design-preview/reports", icon: "analytics" },
  { path: "/design-preview", icon: "home" },
  { path: "/design-preview/schedule", icon: "calendar_today" },
  { path: "/design-preview/food", icon: "restaurant" },
  { path: "/design-preview/chat", icon: "smart_toy" },
] as const;

/** `foodEnabled` controls whether the food-tracking icon shows at all — it's only ever visible
 * once the user has turned that feature on (in Settings or via the food page's own onboarding). */
export function LHBottomNav({ active, foodEnabled = true }: { active: "settings" | "reports" | "home" | "schedule" | "food" | "chat"; foodEnabled?: boolean }) {
  const items = navItems.filter((item) => item.icon !== "restaurant" || foodEnabled);
  return (
    <nav className="fixed bottom-4 inset-x-4 z-50 mx-4 mb-2 max-w-[420px] mx-auto" style={{ paddingBottom: "env(safe-area-inset-bottom,0px)" }}>
      <div className="bg-white/80 backdrop-blur-2xl rounded-full h-[72px] px-3 flex items-center justify-between border border-white/60" style={{ boxShadow: "0 16px 45px rgba(35,50,100,0.07)" }}>
        {items.map((item) => {
          const key = item.path.split("/").pop() || "home";
          const isActive = key === active || (active === "home" && item.icon === "home" && key === "design-preview");
          const isHome = item.icon === "home";
          if (isHome) {
            return (
              <Link
                key={item.path}
                to={item.path}
                className="flex flex-col items-center justify-center w-14 h-14 rounded-[18px] transition-all duration-300 bg-white border border-white shrink-0"
                style={{ transform: "translateY(-14px)", boxShadow: active === "home" ? "0 12px 32px rgba(118,57,255,0.15)" : "0 8px 20px rgba(0,1,20,0.15)" }}
              >
                <span
                  className="material-symbols-outlined"
                  style={
                    active === "home"
                      ? {
                          fontSize: 28,
                          fontVariationSettings: "'FILL' 1",
                          background: "linear-gradient(to bottom right,#7639FF,#00D2FF,#19CEA0)",
                          WebkitBackgroundClip: "text",
                          backgroundClip: "text",
                          color: "transparent",
                        }
                      : { fontSize: 28, color: LH.onSurfaceVariant }
                  }
                >
                  home
                </span>
              </Link>
            );
          }
          return (
            <Link
              key={item.path}
              to={item.path}
              className="flex flex-col items-center justify-center w-11 h-11 rounded-full transition-all duration-300 shrink-0"
              style={
                isActive
                  ? { background: `${LH.primary}1A`, color: LH.primary, transform: "scale(1.05)", boxShadow: "0 12px 24px rgba(0,0,0,0.12)" }
                  : { color: LH.onSurfaceVariant }
              }
            >
              <span className="material-symbols-outlined text-[21px]">{item.icon}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
