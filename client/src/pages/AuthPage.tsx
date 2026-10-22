import { useEffect } from "react";
import { useLocation } from "wouter";
import { AuthForm } from "@/components/AuthForm";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import { BookOpen } from "lucide-react";

export default function AuthPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  // Check if user is already logged in
  const { data: user, isLoading } = useQuery({
    queryKey: ["/api/user"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    retry: false,
  });
  
  // Redirect to appropriate page if already logged in. Honors ?next= for
  // OAuth flows that bounce through login (same-origin paths only).
  useEffect(() => {
    if (user && !isLoading) {
      const params = new URLSearchParams(window.location.search);
      const next = params.get("next");
      if (next && next.startsWith("/") && !next.startsWith("//")) {
        window.location.replace(next);
        return;
      }
      if ((user as any).isAdmin) {
        setLocation("/admin");
      } else {
        setLocation("/status");
      }
    }
  }, [user, isLoading, setLocation]);
  
  // Show loading state while checking authentication
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full"></div>
      </div>
    );
  }
  
  return (
    <div className="flex min-h-screen bg-background relative">
      <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
        {/* The how-to deck as a PDF (client/public), for people trying the demo. */}
        <a
          href="/logbook-guide.pdf"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-10 items-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-medium text-foreground shadow-sm hover:bg-muted"
        >
          <BookOpen className="h-4 w-4 text-primary" />
          How-to guide (PDF)
        </a>
        <ThemeToggle />
      </div>
      {/* Form side */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-4">
        <AuthForm />
      </div>
      
      {/* Hero side */}
      <div className="hidden lg:flex lg:w-1/2 bg-primary relative items-center justify-center">
        <div className="absolute inset-0 bg-black opacity-20"></div>
        <div className="z-10 text-center p-8">
          <h2 className="text-3xl font-bold text-white mb-4">
            Laborers Logbook
          </h2>
          <p className="text-white text-lg mb-6">
            Your own record as a union laborer: hours signed off by your foreman, health coverage, the out-of-work list and your certs.
          </p>
          <ul className="text-white text-left space-y-3 max-w-md mx-auto">
            <li className="flex items-center">
              <span className="mr-2 bg-white/20 p-1 rounded-full">✓</span>
              Daily work and class hours, by employer
            </li>
            <li className="flex items-center">
              <span className="mr-2 bg-white/20 p-1 rounded-full">✓</span>
              Foreman sign-off by text or email
            </li>
            <li className="flex items-center">
              <span className="mr-2 bg-white/20 p-1 rounded-full">✓</span>
              Health coverage and hour bank estimate, checked against the fund
            </li>
            <li className="flex items-center">
              <span className="mr-2 bg-white/20 p-1 rounded-full">✓</span>
              Re-register reminders, apprenticeship progress, cert expiry
            </li>
          </ul>
          <p className="mt-6 text-sm text-white/80">Unofficial. Not affiliated with LiUNA or any local.</p>
        </div>
      </div>
    </div>
  );
}