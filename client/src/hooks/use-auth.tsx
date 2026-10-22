import { createContext, ReactNode, useContext } from "react";
import { useQuery, useMutation, useIsRestoring } from "@tanstack/react-query";
import { User } from "@shared/schema";
import { getQueryFn, apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// The /api/user response includes an `impersonating` flag when an admin is
// viewing the app as another user.
export type AuthUser = User & { impersonating?: boolean };

type AuthContextType = {
  user: AuthUser | null;
  isLoading: boolean;
  error: Error | null;
  loginMutation: ReturnType<typeof useLoginMutation>;
  logoutMutation: ReturnType<typeof useLogoutMutation>;
  registerMutation: ReturnType<typeof useRegisterMutation>;
};

export type LoginData = {
  email: string;
  password: string;
};

export type RegisterData = {
  email: string;
  password: string;
  name?: string;
  employeeNumber?: string;
};

// Use query hook for getting current user
function useUserQuery() {
  return useQuery<AuthUser | null, Error>({
    queryKey: ["/api/user"],
    queryFn: getQueryFn<AuthUser | null>({ on401: "returnNull" }),
  });
}

// Login mutation
function useLoginMutation() {
  const { toast } = useToast();
  
  return useMutation({
    mutationFn: async (credentials: LoginData) => {
      const res = await apiRequest("POST", "/api/auth/login", credentials);
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Login failed");
      }
      return await res.json();
    },
    onSuccess: async (user: User) => {
      queryClient.setQueryData(["/api/user"], user);
      // Drain anything that was paused while the user was logged out.
      const { resumeAfterAuth } = await import("@/lib/offline/online");
      resumeAfterAuth();
      queryClient.resumePausedMutations().catch(() => {});
      toast({
        title: "Login successful",
        description: `Welcome back, ${user.name || user.email}!`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Login failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

// Register mutation
function useRegisterMutation() {
  const { toast } = useToast();
  
  return useMutation({
    mutationFn: async (userData: RegisterData) => {
      const res = await apiRequest("POST", "/api/auth/register", userData);
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Registration failed");
      }
      return await res.json();
    },
    onSuccess: (user: User) => {
      queryClient.setQueryData(["/api/user"], user);
      toast({
        title: "Registration successful",
        description: `Welcome, ${user.name || user.email}!`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Registration failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

// Logout mutation
function useLogoutMutation() {
  const { toast } = useToast();
  
  return useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/auth/logout", {});
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Logout failed");
      }
      return await res.json();
    },
    onSuccess: () => {
      queryClient.setQueryData(["/api/user"], null);
      toast({
        title: "Logged out successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Logout failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

// Context provider
export const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data: user, error, isLoading: isFetchingUser } = useUserQuery();
  // While PersistQueryClientProvider restores the IndexedDB cache, queries
  // report fetchStatus "idle" with no data, so isLoading is false and user is
  // undefined. Without this, ProtectedRoute treats that moment as "logged
  // out" and a reload of any protected page bounces through /auth.
  const isRestoring = useIsRestoring();
  const isLoading = isRestoring || isFetchingUser;
  const loginMutation = useLoginMutation();
  const registerMutation = useRegisterMutation();
  const logoutMutation = useLogoutMutation();

  return (
    <AuthContext.Provider
      value={{
        user: user || null,
        isLoading,
        error,
        loginMutation,
        logoutMutation,
        registerMutation,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}