import { formatCalendarDate } from "@shared/dates";
import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useToast } from "@/hooks/use-toast";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { verificationFormSchema, type VerificationFormValues } from "@/types";
import { Entry, entryDetailsSummary, fieldMethodLabel } from "@shared/schema";

export default function BatchVerifyPage() {
  const { token } = useParams();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isVerifying, setIsVerifying] = useState(false);
  const [attested, setAttested] = useState(false);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: [`/api/batch-verify/${token}`],
    enabled: !!token,
    retry: 1,
  });

  const form = useForm<VerificationFormValues>({
    resolver: zodResolver(verificationFormSchema),
    defaultValues: { verifierName: "" },
  });

  const handleSubmit = async (values: VerificationFormValues) => {
    setIsVerifying(true);
    try {
      const response = await fetch(`/api/batch-verify/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supervisorName: values.verifierName, attestation: attested }),
        credentials: "include",
      });

      const responseData = await response.json();
      if (!response.ok) throw new Error(responseData.message || "Verification failed");

      toast({
        title: "Verification successful",
        description: "All selected entries have been verified. Thank you!",
      });

      setLocation(`/success?token=${token}`);
    } catch (error) {
      toast({
        title: "Verification failed",
        description: error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
    } finally {
      setIsVerifying(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4 py-8">
        <div className="w-full max-w-lg p-8 text-center">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4"></div>
          <p>Loading verification details...</p>
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4 py-8">
        <div className="w-full max-w-lg bg-white p-8 rounded-lg shadow-md text-center">
          <h1 className="text-2xl font-semibold mb-2">Verification Failed</h1>
          <p className="text-neutral-500">
            {error instanceof Error
              ? error.message
              : "These entries may have already been verified or the link is invalid."}
          </p>
        </div>
      </div>
    );
  }

  const { entries, user } = data as { entries: Entry[]; user: any };
  const formatMethod = fieldMethodLabel;
  const totalHours = entries.reduce((sum: number, e: Entry) => sum + e.hours, 0);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-8 bg-neutral-50">
      <div className="w-full max-w-lg bg-white p-8 rounded-lg shadow-md">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold mb-2">Batch Work Hours Verification</h1>
          <p className="text-neutral-500">
            Please review and verify the following work-hours entries for{" "}
            <span className="font-medium text-neutral-800">{user.name || user.email}</span>
            {user.employeeNumber && ` (Employee #: ${user.employeeNumber})`}.
          </p>
        </div>

        <div className="bg-neutral-100 rounded-md overflow-hidden mb-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-neutral-200 text-left">
                <th className="px-4 py-2 font-medium text-neutral-700">Date</th>
                <th className="px-4 py-2 font-medium text-neutral-700">Location</th>
                <th className="px-4 py-2 font-medium text-neutral-700">Method</th>
                <th className="px-4 py-2 font-medium text-neutral-700 text-right">Hours</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry: Entry) => (
                <tr key={entry.id} className="border-t border-neutral-200">
                  <td className="px-4 py-2 text-neutral-900">{formatCalendarDate(entry.date)}</td>
                  <td className="px-4 py-2 text-neutral-900">{entry.location}</td>
                  <td className="px-4 py-2 text-neutral-900">
                    {formatMethod(entry.method)}
                    {entryDetailsSummary(entry.method, entry.details) && (
                      <div className="text-xs text-neutral-500">{entryDetailsSummary(entry.method, entry.details)}</div>
                    )}
                  </td>
                  <td className="px-4 py-2 text-neutral-900 text-right">{entry.hours.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-neutral-300 bg-neutral-100">
                <td colSpan={3} className="px-4 py-2 font-semibold text-neutral-900">Total</td>
                <td className="px-4 py-2 font-semibold text-neutral-900 text-right">{totalHours.toFixed(1)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="verifierName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Your name (foreman / supervisor)</FormLabel>
                  <FormControl>
                    <Input placeholder="Enter your full name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <label className="flex items-start gap-2 text-sm text-neutral-700">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded border-neutral-300"
                checked={attested}
                onChange={(e) => setAttested(e.target.checked)}
              />
              <span>
                I confirm that these hours are true and correct, that the
                details above are accurate to the best of my knowledge, and
                that I am authorized to verify them.
              </span>
            </label>

            <Button
              type="submit"
              className="w-full"
              disabled={isVerifying || !attested}
              variant="secondary"
            >
              {isVerifying ? "Verifying..." : `Verify All ${entries.length} Entries`}
            </Button>
          </form>
        </Form>
      </div>
    </div>
  );
}
