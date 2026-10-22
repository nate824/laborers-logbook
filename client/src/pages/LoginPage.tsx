import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { MagicLink } from "@/components/MagicLink";
import { useToast } from "@/hooks/use-toast";

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [token, setToken] = useState<string | null>(null);
  
  useEffect(() => {
    // Check for token in URL
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get('token');
    if (urlToken) {
      setToken(urlToken);
    }
  }, []);
  
  // Verify magic link token if present
  const { isLoading } = useQuery({
    queryKey: [token ? `/api/auth/verify-magic-link?token=${token}` : null],
    enabled: !!token,
    onSuccess: (data) => {
      toast({
        title: "Login successful!",
        description: "Redirecting to your profile...",
      });
      
      // Redirect to profile page
      setTimeout(() => {
        setLocation("/field-hours");
      }, 1000);
    },
    onError: (error) => {
      toast({
        title: "Login failed",
        description: error instanceof Error ? error.message : "Invalid or expired token",
        variant: "destructive",
      });
      
      // Clear token to show login form
      setToken(null);
    },
  });
  
  // Check if user is already logged in
  const { isLoading: isCheckingAuth } = useQuery({
    queryKey: ["/api/user"],
    onSuccess: () => {
      // User is already logged in, redirect to profile
      setLocation("/field-hours");
    },
    onError: () => {
      // Not authenticated, do nothing (show login form)
    },
  });
  
  if (isLoading || isCheckingAuth) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4 py-8">
        <div className="w-full max-w-md p-8 flex flex-col items-center">
          <h2 className="text-xl mb-4">Authenticating...</h2>
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full"></div>
        </div>
      </div>
    );
  }
  
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-8">
      <MagicLink />
    </div>
  );
}
