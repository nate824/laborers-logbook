import { Switch, Route } from "wouter";
import { queryClient } from "@/lib/queryClient";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/use-auth";
import { ThemeProvider } from "@/hooks/use-theme";
import { createIDBPersister } from "@/lib/offline";
import { InstallPrompt } from "@/components/InstallPrompt";
import { UpdatePrompt } from "@/components/UpdatePrompt";
import { useAuth } from "@/hooks/use-auth";
import NotFound from "@/pages/not-found";
import AuthPage from "@/pages/AuthPage";
import ProfilePage from "@/pages/ProfilePage";
import RopeHoursPage from "@/pages/RopeHoursPage";
import SignersPage from "@/pages/SignersPage";
import VerifyPage from "@/pages/VerifyPage";
import BatchVerifyPage from "@/pages/BatchVerifyPage";
import PublicProfilePage from "@/pages/PublicProfilePage";
import { ImpersonationBanner } from "@/components/admin/ImpersonationBanner";
import SuccessPage from "@/pages/SuccessPage";
import ResetPasswordPage from "@/pages/ResetPasswordPage";
import NewPasswordPage from "@/pages/NewPasswordPage";
import AdminPage from "@/pages/AdminPage";
import SkillzPage from "@/pages/SkillzPage";
import { ProtectedRoute } from "@/lib/protected-route";

const persister = createIDBPersister();

function Router() {
  return (
    <Switch>
      <Route path="/" component={AuthPage} />
      <Route path="/auth" component={AuthPage} />
      <Route path="/field-hours">
        <ProtectedRoute>
          <ProfilePage />
        </ProtectedRoute>
      </Route>
      <Route path="/rope-hours">
        <ProtectedRoute>
          <RopeHoursPage />
        </ProtectedRoute>
      </Route>
      <Route path="/signers">
        <ProtectedRoute>
          <SignersPage />
        </ProtectedRoute>
      </Route>
      <Route path="/admin">
        <ProtectedRoute>
          <AdminPage />
        </ProtectedRoute>
      </Route>
      <Route path="/p/:token" component={PublicProfilePage} />
      <Route path="/verify/:token" component={VerifyPage} />
      <Route path="/batch-verify/:token" component={BatchVerifyPage} />
      <Route path="/success" component={SuccessPage} />
      <Route path="/skillz" component={SkillzPage} />
      <Route path="/reset-password" component={ResetPasswordPage} />
      <Route path="/reset-password/:token" component={NewPasswordPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
        buster: "acl-v1",
        dehydrateOptions: {
          shouldDehydrateMutation: () => true,
        },
      }}
      onSuccess={() => {
        // Replay any mutations that were queued while offline.
        queryClient.resumePausedMutations().catch(() => {
          /* ignore */
        });
      }}
    >
      <ThemeProvider>
        <AuthProvider>
          <TooltipProvider>
            <Toaster />
            <ImpersonationBanner />
            <Router />
            <AuthedPrompts />
          </TooltipProvider>
        </AuthProvider>
      </ThemeProvider>
    </PersistQueryClientProvider>
  );
}

// Only show the install prompt after the user has signed in — we don't
// want it appearing on the auth screen for visitors. The update toast
// is fine to show anywhere.
function AuthedPrompts() {
  const { user } = useAuth();
  return (
    <>
      {user ? <InstallPrompt /> : null}
      <UpdatePrompt />
    </>
  );
}

export default App;
