import { useState } from "react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { resumeAfterAuth } from "@/lib/offline/online";
import { Loader2 } from "lucide-react";

// Form validation schemas
const loginSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

const registerSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().optional(),
  employeeNumber: z.string().optional(),
});

type LoginFormValues = z.infer<typeof loginSchema>;
type RegisterFormValues = z.infer<typeof registerSchema>;

// Hand the signed-in user to the query cache. AuthPage watches ["/api/user"]
// and redirects (honoring ?next=) as soon as it holds a user.
//
// Don't do a full page reload here: the query cache is persisted to IndexedDB,
// so a reload restores the "not logged in" answer cached while the login page
// was open. It's still fresh (staleTime), so ProtectedRoute bounces straight
// back to /auth.
function completeSignIn(user: unknown) {
  // Drop any other cached data (e.g. a previous user's entries) so pages
  // refetch for this session.
  queryClient.removeQueries({
    predicate: (q) => q.queryKey[0] !== "/api/user",
  });
  queryClient.setQueryData(["/api/user"], user);
  resumeAfterAuth();
  queryClient.resumePausedMutations().catch(() => {});
}

export function AuthForm() {
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState<"login" | "register">("login");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loginForm = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const registerForm = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      email: "",
      password: "",
      name: "",
      employeeNumber: "",
    },
  });

  const handleLogin = async (values: LoginFormValues) => {
    setLoading(true);
    setError(null);
    
    try {
      // Make a normal fetch request instead of using apiRequest to get proper response access
      const response = await fetch("/api/auth/login", {
        method: "POST", 
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
        credentials: "include"
      });
      
      // Check for error response
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Login failed");
      }
      
      completeSignIn(await response.json());
    } catch (err) {
      console.error("Login error:", err);
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (values: RegisterFormValues) => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await apiRequest("POST", "/api/auth/register", values);
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || "Registration failed");
      }
      
      completeSignIn(await response.json());
    } catch (err) {
      console.error("Registration error:", err);
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Tabs 
      defaultValue="login" 
      value={activeTab} 
      onValueChange={(value) => setActiveTab(value as "login" | "register")}
      className="w-full max-w-md"
    >
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="login">Login</TabsTrigger>
        <TabsTrigger value="register">Register</TabsTrigger>
      </TabsList>
      
      <TabsContent value="login">
        <Form {...loginForm}>
          <form onSubmit={loginForm.handleSubmit(handleLogin)} className="space-y-4">
            <FormField
              control={loginForm.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input 
                      placeholder="your.email@example.com" 
                      {...field} 
                      autoComplete="email"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={loginForm.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <Input 
                      type="password" 
                      placeholder="********" 
                      {...field} 
                      autoComplete="current-password"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            
            <div className="space-y-2">
              <Button 
                type="submit" 
                disabled={loading} 
                className="w-full"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Logging in...
                  </>
                ) : (
                  "Log in"
                )}
              </Button>
              
              <Button 
                variant="link" 
                type="button"
                className="w-full text-center"
                onClick={() => setLocation("/reset-password")}
              >
                Forgot password?
              </Button>
            </div>
          </form>
        </Form>
      </TabsContent>
      
      <TabsContent value="register">
        <Form {...registerForm}>
          <form onSubmit={registerForm.handleSubmit(handleRegister)} className="space-y-4">
            <FormField
              control={registerForm.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input 
                      placeholder="your.email@example.com" 
                      {...field} 
                      autoComplete="email"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={registerForm.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <Input 
                      type="password" 
                      placeholder="********" 
                      {...field} 
                      autoComplete="new-password"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={registerForm.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Full Name (Optional)</FormLabel>
                  <FormControl>
                    <Input 
                      placeholder="John Doe" 
                      {...field} 
                      autoComplete="name"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={registerForm.control}
              name="employeeNumber"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Employee Number (Optional)</FormLabel>
                  <FormControl>
                    <Input 
                      placeholder="EMP123456" 
                      {...field} 
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            
            <Button 
              type="submit" 
              disabled={loading} 
              className="w-full"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Registering...
                </>
              ) : (
                "Register"
              )}
            </Button>
          </form>
        </Form>
      </TabsContent>
    </Tabs>
  );
}