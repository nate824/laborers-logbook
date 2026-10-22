import { formatCalendarDate } from "@shared/dates";
import { Fragment, useState, useEffect } from "react";
import { fieldMethodDetails, fieldMethodLabel } from "@shared/schema";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useToast } from "@/hooks/use-toast";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { verificationFormSchema, type VerificationFormValues } from "@/types";

export default function VerifyPage() {
  const { token } = useParams();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isVerifying, setIsVerifying] = useState(false);
  const [attested, setAttested] = useState(false);
  
  // Log token for debugging
  console.log("Verification token:", token);
  
  const form = useForm<VerificationFormValues>({
    resolver: zodResolver(verificationFormSchema),
    defaultValues: {
      verifierName: "",
    },
  });
  
  // Query verification details
  const { data, isLoading, isError, error } = useQuery({
    queryKey: [`/api/verify/${token}`],
    enabled: !!token,
    retry: 1,
  });
  
  const handleSubmit = async (values: VerificationFormValues) => {
    setIsVerifying(true);
    
    try {
      // Extract supervisorName for verification
      const { verifierName: supervisorName } = values;
      
      console.log("Sending verification to API:", token, supervisorName);
      
      const response = await fetch(`/api/verify/${token}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ supervisorName, attestation: attested }),
        credentials: "include"
      });
      
      const responseData = await response.json();
      console.log("Verification response:", responseData);
      
      if (!response.ok) {
        throw new Error(responseData.message || "Verification failed");
      }
      
      // Determine verification type for success message
      const verificationType = data && data.type === 'rope_hour' ? 'rope' : 'field';
      
      // Show success message and redirect to success page
      toast({
        title: "Verification successful",
        description: `Thank you for verifying these ${verificationType} hours.`,
      });
      
      // Redirect to success page with data
      setLocation(`/success?token=${token}`);
    } catch (error) {
      console.error("Verification error:", error);
      toast({
        title: "Verification failed",
        description: error instanceof Error ? error.message : "An error occurred during verification",
        variant: "destructive",
      });
    } finally {
      setIsVerifying(false);
    }
  };
  
  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4 py-8">
        <div className="w-full max-w-md p-8 text-center">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4"></div>
          <p>Loading verification details...</p>
        </div>
      </div>
    );
  }
  
  if (isError || !data) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4 py-8">
        <div className="w-full max-w-md bg-white p-8 rounded-lg shadow-md text-center">
          <h1 className="text-2xl font-semibold mb-2">Verification Failed</h1>
          <p className="text-neutral-500">
            {error instanceof Error ? error.message : "This entry may have already been verified or the link is invalid."}
          </p>
        </div>
      </div>
    );
  }
  
  // Type guard to ensure data has the expected structure
  if (!data || !('user' in data) || (!('entry' in data) && !('ropeHour' in data))) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4 py-8">
        <div className="w-full max-w-md bg-white p-8 rounded-lg shadow-md text-center">
          <h1 className="text-2xl font-semibold mb-2">Invalid Data Format</h1>
          <p className="text-neutral-500">
            The verification data appears to be in an invalid format. Please try again or contact support.
          </p>
        </div>
      </div>
    );
  }
  
  const { user, type } = data as { user: any; type: string; entry?: any; ropeHour?: any };
  const item = data.entry || data.ropeHour;
  const isRopeHour = type === 'rope_hour';
  
  // Format method for display (only for field-hours entries)
  let displayMethod = '';
  if (!isRopeHour && item.method) {
    displayMethod = fieldMethodLabel(item.method);
  }
  
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-md bg-white p-8 rounded-lg shadow-md">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold mb-2">
            {isRopeHour ? 'Rope Hours Verification' : 'Field Hours Verification'}
          </h1>
          <p className="text-neutral-500">
            Please verify the {isRopeHour ? 'rope' : 'field'} hours for the technician
          </p>
        </div>
        
        <div className="bg-neutral-100 rounded-md p-4 mb-6">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-neutral-500">Technician:</dt>
            <dd className="text-neutral-900 font-medium">{user.name}</dd>
            <dt className="text-neutral-500">Employee #:</dt>
            <dd className="text-neutral-900 font-medium">{user.employeeNumber}</dd>
            
            {isRopeHour ? (
              <>
                <dt className="text-neutral-500">Date Range:</dt>
                <dd className="text-neutral-900 font-medium">
                  {formatCalendarDate(item.startDate)} - {formatCalendarDate(item.endDate)}
                </dd>
                <dt className="text-neutral-500">Skills:</dt>
                <dd className="text-neutral-900 font-medium">{item.skills}</dd>
                {item.projectNumber && (
                  <>
                    <dt className="text-neutral-500">Project #:</dt>
                    <dd className="text-neutral-900 font-medium">{item.projectNumber}</dd>
                  </>
                )}
                {item.workCode && (
                  <>
                    <dt className="text-neutral-500">Work Code:</dt>
                    <dd className="text-neutral-900 font-medium">{item.workCode}</dd>
                  </>
                )}
              </>
            ) : (
              <>
                <dt className="text-neutral-500">Date:</dt>
                <dd className="text-neutral-900 font-medium">
                  {formatCalendarDate(item.date)}
                </dd>
                <dt className="text-neutral-500">Method:</dt>
                <dd className="text-neutral-900 font-medium">{displayMethod}</dd>
                {fieldMethodDetails(item.method)
                  .filter((d) => item.details?.[d.key])
                  .map((d) => (
                    <Fragment key={d.key}>
                      <dt className="text-neutral-500">{d.label}:</dt>
                      <dd className="text-neutral-900 font-medium">{item.details[d.key].split(",").join(" / ")}</dd>
                    </Fragment>
                  ))}
              </>
            )}
            
            <dt className="text-neutral-500">Location:</dt>
            <dd className="text-neutral-900 font-medium">{item.location}</dd>
            <dt className="text-neutral-500">Hours:</dt>
            <dd className="text-neutral-900 font-medium">{item.hours.toFixed(1)}</dd>
          </dl>
        </div>
        
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="verifierName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Your Name (Supervisor)</FormLabel>
                  <FormControl>
                    <Input 
                      placeholder="Enter your full name" 
                      {...field} 
                    />
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
              {isVerifying ? "Verifying..." : "Verify Hours"}
            </Button>
          </form>
        </Form>
      </div>
    </div>
  );
}
