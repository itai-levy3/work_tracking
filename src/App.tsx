import { lazy, Suspense, useEffect, useRef } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { getCurrentUserEmail, initAuthSync, isLocalAuthenticated } from "@/lib/localAuth";
import { getProfileFirstName, getSettings, syncAfterLogin } from "@/lib/localData";
import { pullAllFromSupabase } from "@/lib/supabaseSync";
import { LHLoadingScreen } from "@/pages/design-preview/Shared";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";

// Route-level code splitting: each page (and every heavy library it alone pulls in — jsPDF,
// html2canvas, the AI chat client, etc.) only downloads once the user actually navigates there,
// instead of every route's code shipping in one ~1.5MB bundle before the first screen can render.
const Settings = lazy(() => import("./pages/Settings"));
const DesignPreview = lazy(() => import("./pages/DesignPreview"));
const DesignPreviewSettings = lazy(() => import("./pages/design-preview/Settings"));
const DesignPreviewReports = lazy(() => import("./pages/design-preview/Reports"));
const DesignPreviewSchedule = lazy(() => import("./pages/design-preview/Schedule"));
const DesignPreviewChat = lazy(() => import("./pages/design-preview/Chat"));
const DesignPreviewFood = lazy(() => import("./pages/design-preview/Food"));
const DesignPreviewLogin = lazy(() => import("./pages/design-preview/Login"));

const queryClient = new QueryClient();

const App = () => {
  const syncedEmailRef = useRef<string | null>(null);

  useEffect(() => {
    initAuthSync();
    // isLocalAuthenticated() can still be stale for a moment right after load, until initAuthSync's
    // async session check resolves and fires "local-auth-changed" — so this re-checks on that event
    // too, not just once at mount.
    const onAuthChange = () => {
      if (!isLocalAuthenticated()) {
        syncedEmailRef.current = null;
        return;
      }
      // Dynamically imported so jsPDF + html2canvas (only ever needed for this background archive
      // job and the on-demand PDF exports) never ship in the critical entry bundle every page load
      // waits on — they're heavy libraries with no business being in the first-paint path.
      void import("@/lib/pdfExport").then(({ autoArchiveCompletedMonths }) => autoArchiveCompletedMonths(getSettings(), getProfileFirstName()));

      // Pull-or-push the Supabase sync exactly once per "became authenticated" transition — not
      // on every auth event (e.g. a token refresh also fires "local-auth-changed").
      const email = getCurrentUserEmail();
      if (email && email !== syncedEmailRef.current) {
        syncedEmailRef.current = email;
        pullAllFromSupabase()
          .then((pulled) => pulled && syncAfterLogin(pulled))
          .catch((error) => {
            console.warn("[App] Supabase sync-after-login failed — continuing with local data", error);
          });
      }
    };
    onAuthChange();
    window.addEventListener("local-auth-changed", onAuthChange);
    return () => window.removeEventListener("local-auth-changed", onAuthChange);
  }, []);

  return (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Suspense fallback={<LHLoadingScreen />}>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/design-preview" element={<DesignPreview />} />
            <Route path="/design-preview/settings" element={<DesignPreviewSettings />} />
            <Route path="/design-preview/reports" element={<DesignPreviewReports />} />
            <Route path="/design-preview/schedule" element={<DesignPreviewSchedule />} />
            <Route path="/design-preview/chat" element={<DesignPreviewChat />} />
            <Route path="/design-preview/food" element={<DesignPreviewFood />} />
            <Route path="/design-preview/login" element={<DesignPreviewLogin />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
  );
};

export default App;
