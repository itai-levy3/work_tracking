import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { registerSW } from "virtual:pwa-register";

// autoUpdate mode reloads the page as soon as it finds a new service worker — but the browser
// only actually CHECKS for one on a fresh navigation. An installed PWA that's just switched back
// to (not truly closed and relaunched) never triggers that check on its own, so it can keep
// running yesterday's JS — with yesterday's payroll math — indefinitely. Force that check
// whenever the app becomes visible again, and periodically while it stays open, so a stale build
// gets replaced within a minute or two of really being used instead of silently lingering.
registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    if (!registration) return;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void registration.update();
    });
    setInterval(() => void registration.update(), 5 * 60 * 1000);
  },
});

createRoot(document.getElementById("root")!).render(<App />);
