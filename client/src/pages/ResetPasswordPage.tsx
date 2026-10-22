import { useLocation } from "wouter";
import { useEffect } from "react";
import { ResetPasswordForm } from "@/components/ResetPasswordForm";
import { useAuth } from "@/hooks/use-auth";

export default function ResetPasswordPage() {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  // Redirect to profile if already logged in
  useEffect(() => {
    if (!isLoading && user) {
      setLocation("/field-hours");
    }
  }, [user, isLoading, setLocation]);

  return (
    <div className="flex min-h-screen flex-col">
      <main className="flex-1 grid md:grid-cols-2">
        <div className="flex flex-col justify-center px-4 py-12">
          <div className="mx-auto w-full max-w-md">
            <h1 className="text-3xl font-bold mb-2">Reset Your Password</h1>
            <p className="text-muted-foreground mb-8">
              Enter your email address and we'll send you a link to reset your password.
            </p>
            <ResetPasswordForm />
          </div>
        </div>
        <div className="bg-muted hidden md:block">
          <div className="flex h-full flex-col justify-center p-12 bg-gradient-to-b from-primary/20 to-background">
            <div className="space-y-6">
              <h2 className="text-2xl font-bold text-primary">Laborers Logbook</h2>
              <p className="text-lg text-muted-foreground">
                The secure way to track and verify your on-the-job training hours
              </p>
              <ul className="space-y-2 text-muted-foreground">
                <li className="flex items-center">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className="mr-2 h-5 w-5 text-primary"
                  >
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
                      clipRule="evenodd"
                    />
                  </svg>
                  Easily log your training hours
                </li>
                <li className="flex items-center">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className="mr-2 h-5 w-5 text-primary"
                  >
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
                      clipRule="evenodd"
                    />
                  </svg>
                  Get supervisor verification
                </li>
                <li className="flex items-center">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className="mr-2 h-5 w-5 text-primary"
                  >
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
                      clipRule="evenodd"
                    />
                  </svg>
                  Export to PDF for your records
                </li>
              </ul>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}