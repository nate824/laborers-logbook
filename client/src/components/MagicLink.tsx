import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { apiRequest } from "@/lib/queryClient";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { loginFormSchema, type LoginFormValues } from "@/types";
import { useLocation } from "wouter";

export function MagicLink() {
  const [isLoading, setIsLoading] = useState(false);
  const [isSent, setIsSent] = useState(false);
  const [directLink, setDirectLink] = useState<string | null>(null);
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  
  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginFormSchema),
    defaultValues: {
      email: "",
    },
  });
  
  const handleSubmit = async (values: LoginFormValues) => {
    setIsLoading(true);
    
    try {
      const response = await apiRequest("POST", "/api/auth/request-magic-link", values);
      setIsSent(true);
      
      // Check if we got a direct link (for development)
      if (response.loginUrl) {
        setDirectLink(response.loginUrl);
        toast({
          title: "Magic link ready!",
          description: "Email delivery failed, but you can use the direct link below.",
        });
      } else {
        toast({
          title: "Magic link sent!",
          description: "Check your email and click the link to log in.",
        });
      }
    } catch (error) {
      console.error(error);
      toast({
        title: "Error",
        description: "Failed to send magic link. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleDirectLogin = () => {
    if (directLink) {
      window.location.href = directLink;
    }
  };
  
  return (
    <div className="w-full max-w-md bg-white p-8 rounded-lg shadow-md">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-semibold mb-2">Access Limited Logbook</h1>
        <p className="text-muted-foreground">Log in to access your field hours log</p>
      </div>
      
      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email Address</FormLabel>
                <FormControl>
                  <Input 
                    placeholder="your.email@example.com" 
                    type="email" 
                    autoComplete="email"
                    {...field} 
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          
          <Button 
            type="submit" 
            className="w-full"
            disabled={isLoading}
          >
            {isLoading ? "Sending..." : "Send Magic Link"}
          </Button>
        </form>
      </Form>
      
      {isSent && !directLink && (
        <div className="mt-6">
          <div className="bg-muted p-4 rounded-md">
            <p className="text-center text-sm text-muted-foreground">
              Magic link sent! Check your email and click the link to log in.
            </p>
          </div>
        </div>
      )}
      
      {directLink && (
        <div className="mt-6">
          <div className="bg-muted p-4 rounded-md">
            <p className="text-center text-sm text-muted-foreground mb-3">
              Email delivery failed, but you can use this direct link:
            </p>
            <Button 
              onClick={handleDirectLogin} 
              className="w-full"
              variant="secondary"
            >
              Login with Direct Link
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
