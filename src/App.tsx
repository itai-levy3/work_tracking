import { useEffect, useRef } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { getCurrentUserEmail, initAuthSync, isLocalAuthenticated } from "@/lib/localAuth";
import { getProfileFirstName, getSettings, syncAfterLogin } from "@/lib/localData";
import { autoArchiveCompletedMonths } from "@/lib/pdfExport";
import { pullAllFromSupabase } from "@/lib/supabaseSync";
import Index from "./pages/Index";
import Settings from "./pages/Settings";
import NotFound from "./pages/NotFound";
import DesignPreview from "./pages/DesignPreview";
import DesignPreviewSettings from "./pages/design-preview/Settings";
import DesignPreviewReports from "./pages/design-preview/Reports";
import DesignPreviewSchedule from "./pages/design-preview/Schedule";
import DesignPreviewChat from "./pages/design-preview/Chat";
import DesignPreviewFood from "./pages/design-preview/Food";
import DesignPreviewLogin from "./pages/design-preview/Login";

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
      void autoArchiveCompletedMonths(getSettings(), getProfileFirstName());

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
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
  );
};

export default App;
