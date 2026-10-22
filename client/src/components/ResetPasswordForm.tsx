import { useState } from "react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2 } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

// Form validation schema
const resetSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
});

type ResetFormValues = z.infer<typeof resetSchema>;

export function ResetPasswordForm() {
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string>("");

  const form = useForm<ResetFormValues>({
    resolver: zodResolver(resetSchema),
    defaultValues: {
      email: "",
    },
  });

  const resetMutation = useMutation({
    mutationFn: async (data: ResetFormValues) => {
      const res = await apiRequest("POST", "/api/auth/reset-password", data);
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to send reset link");
      }
      return await res.json();
    },
    onSuccess: () => {
      setStatus("success");
      form.reset();
    },
    onError: (error: Error) => {
      setStatus("error");
      setErrorMessage(error.message || "An error occurred. Please try again.");
    },
  });

  const onSubmit = (values: ResetFormValues) => {
    setStatus("idle");
    resetMutation.mutate(values);
  };

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle>Reset Password</CardTitle>
        <CardDescription>
          Enter your email and we'll send you a link to reset your password.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
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

            {status === "success" && (
              <Alert variant="default" className="bg-green-50 text-green-800 border-green-200">
                <AlertDescription>
                  If your email exists in our system, we've sent you instructions to reset your password.
                </AlertDescription>
              </Alert>
            )}

            {status === "error" && (
              <Alert variant="destructive">
                <AlertDescription>{errorMessage}</AlertDescription>
              </Alert>
            )}

            <Button 
              type="submit" 
              disabled={resetMutation.isPending} 
              className="w-full"
            >
              {resetMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sending Reset Link
                </>
              ) : (
                "Send Reset Link"
              )}
            </Button>
          </form>
        </Form>
      </CardContent>
      <CardFooter className="flex justify-center">
        <Button variant="link" className="px-0" onClick={() => window.location.href = "/auth"}>
          Back to Login
        </Button>
      </CardFooter>
    </Card>
  );
}