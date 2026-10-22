import { useState } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Shield, Plus, X, Mail, Check, Loader2, User, Phone, Calendar, Building2 } from "lucide-react";

// Form validation schema
const identityFormSchema = z.object({
  fullName: z.string().min(2, "Full name must be at least 2 characters"),
  dateOfBirth: z.string().min(1, "Date of birth is required"),
  phoneNumber: z.string().min(10, "Phone number must be at least 10 digits"),
  employeeIds: z.array(z.object({
    employeeId: z.string().min(1, "Employee ID is required"),
    company: z.string().min(1, "Company name is required"),
  })).min(1, "At least one employee ID is required"),
});

type IdentityFormValues = z.infer<typeof identityFormSchema>;

type CreationStep = 'form' | 'creating' | 'success';

interface IdentityCreationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function IdentityCreationModal({ isOpen, onClose, onSuccess }: IdentityCreationModalProps) {
  const [currentStep, setCurrentStep] = useState<CreationStep>('form');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string>("");
  const { toast } = useToast();

  const form = useForm<IdentityFormValues>({
    resolver: zodResolver(identityFormSchema),
    defaultValues: {
      fullName: "",
      dateOfBirth: "",
      phoneNumber: "",
      employeeIds: [
        { employeeId: "", company: "" }
      ],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "employeeIds",
  });

  const addEmployeeId = () => {
    append({ employeeId: "", company: "" });
  };

  const removeEmployeeId = (index: number) => {
    if (fields.length > 1) {
      remove(index);
    }
  };

  const handleSubmit = async (values: IdentityFormValues) => {
    setIsSubmitting(true);
    setError("");

    try {
      setCurrentStep('creating');

      // Create crypto identity
      const response = await apiRequest("POST", "/api/crypto/identity", {
        personalInfo: {
          fullName: values.fullName,
          dateOfBirth: values.dateOfBirth,
          phoneNumber: values.phoneNumber,
        },
        employeeIds: values.employeeIds, // Send full objects with both employeeId and company
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to create crypto identity");
      }

      setCurrentStep('success');
      toast({
        title: "Identity Created",
        description: "Your cryptographic identity has been successfully created.",
      });

      setTimeout(() => {
        onSuccess();
        handleClose();
      }, 2000);

    } catch (error) {
      console.error('Identity creation error:', error);
      setError(error instanceof Error ? error.message : "Failed to create identity");
      setCurrentStep('form');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      setCurrentStep('form');
      setError("");
      form.reset();
      onClose();
    }
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 'form':
        return (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
              {/* Personal Information Section */}
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4" />
                  <h4 className="text-sm font-medium">Personal Information</h4>
                </div>
                
                <div className="grid gap-4">
                  <FormField
                    control={form.control}
                    name="fullName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Full Legal Name</FormLabel>
                        <FormControl>
                          <Input 
                            placeholder="Enter your full legal name"
                            data-testid="input-fullname"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="dateOfBirth"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Date of Birth</FormLabel>
                        <FormControl>
                          <Input 
                            type="date"
                            data-testid="input-dateofbirth"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="phoneNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Phone Number</FormLabel>
                        <FormControl>
                          <Input 
                            type="tel"
                            placeholder="(555) 123-4567"
                            data-testid="input-phone"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              <Separator />

              {/* Employee IDs Section */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4" />
                    <h4 className="text-sm font-medium">Employee Information</h4>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addEmployeeId}
                    className="flex items-center gap-1"
                    data-testid="button-add-employee-id"
                  >
                    <Plus className="h-3 w-3" />
                    Add Employee ID
                  </Button>
                </div>

                <div className="space-y-3">
                  {fields.map((field, index) => (
                    <Card key={field.id} className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="grid grid-cols-2 gap-3 flex-1">
                          <FormField
                            control={form.control}
                            name={`employeeIds.${index}.employeeId`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Employee ID</FormLabel>
                                <FormControl>
                                  <Input 
                                    placeholder="E12345"
                                    data-testid={`input-employee-id-${index}`}
                                    {...field}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          
                          <FormField
                            control={form.control}
                            name={`employeeIds.${index}.company`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Company</FormLabel>
                                <FormControl>
                                  <Input 
                                    placeholder="Company Name"
                                    data-testid={`input-company-${index}`}
                                    {...field}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>

                        {fields.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeEmployeeId(index)}
                            className="ml-2 text-red-500 hover:text-red-700"
                            data-testid={`button-remove-employee-id-${index}`}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </Card>
                  ))}
                </div>
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {/* Submit Button */}
              <div className="flex justify-end gap-3 pt-4">
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={handleClose}
                  data-testid="button-cancel"
                >
                  Cancel
                </Button>
                <Button 
                  type="submit"
                  disabled={isSubmitting}
                  data-testid="button-create-identity"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Creating Identity...
                    </>
                  ) : (
                    <>
                      <Shield className="h-4 w-4 mr-2" />
                      Create Identity
                    </>
                  )}
                </Button>
              </div>
            </form>
          </Form>
        );

      case 'creating':
        return (
          <div className="text-center py-8">
            <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-primary/10 mb-4">
              <Loader2 className="h-8 w-8 text-primary animate-spin" />
            </div>
            <h3 className="text-lg font-medium">Creating Your Cryptographic Identity</h3>
            <p className="text-sm text-muted-foreground mt-2">
              Generating secure keys and digital certificates...
            </p>
          </div>
        );

      case 'success':
        return (
          <div className="text-center py-8">
            <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-green-100 mb-4">
              <Check className="h-8 w-8 text-green-600" />
            </div>
            <h3 className="text-lg font-medium">Identity Created Successfully!</h3>
            <p className="text-sm text-muted-foreground mt-2">
              Your digital identity is now ready for secure verification.
            </p>
          </div>
        );

      default:
        return null;
    }
  };

  const getStepTitle = () => {
    switch (currentStep) {
      case 'form':
        return 'Create Your Digital Identity';
      case 'creating':
        return 'Creating Identity';
      case 'success':
        return 'Identity Created';
      default:
        return 'Create Digital Identity';
    }
  };

  const getStepDescription = () => {
    switch (currentStep) {
      case 'form':
        return 'This information will be used to create your secure cryptographic identity for verified training hours.';
      case 'creating':
        return 'Please wait while we create your secure digital identity...';
      case 'success':
        return 'Your identity has been created and is ready for use.';
      default:
        return '';
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-identity-creation">
        <DialogHeader className="text-center">
          <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-primary/10 mb-4">
            <Shield className="h-6 w-6 text-primary" />
          </div>
          <DialogTitle data-testid="text-dialog-title">{getStepTitle()}</DialogTitle>
          <DialogDescription data-testid="text-dialog-description">
            {getStepDescription()}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-6">
          {renderStepContent()}
        </div>
      </DialogContent>
    </Dialog>
  );
}