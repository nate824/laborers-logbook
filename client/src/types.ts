import { z } from "zod";
import {
  FieldMethods,
  type FieldMethod,
  supervisorQualificationSchema,
  type Supervisor,
  type SupervisorQualification,
} from "@shared/schema";

// Entry form validation schema
export const entryFormSchema = z.object({
  date: z.date(),
  location: z.string().min(1, "Location is required"),
  method: z.enum(Object.keys(FieldMethods) as [FieldMethod, ...FieldMethod[]]),
  hours: z.number().min(0.1, "Hours must be greater than 0"),
});

export type EntryFormValues = z.infer<typeof entryFormSchema>;

// Signer / Supervisor form validation schema
export const supervisorFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email address"),
  phone: z.string().min(1, "Phone number is required"),
  spratNumber: z.string().optional(),
  irataNumber: z.string().optional(),
  company: z.string().optional(),
  qualifications: z.array(supervisorQualificationSchema),
});

export type SupervisorFormValues = z.infer<typeof supervisorFormSchema>;

// Build the qualifications list for a saved signer, falling back to the
// legacy single ndtMethod/certificationLevel fields when present.
export function signerToQualifications(signer: Supervisor): SupervisorQualification[] {
  if (Array.isArray(signer.qualifications) && signer.qualifications.length > 0) {
    return signer.qualifications;
  }
  if (signer.ndtMethod && signer.certificationLevel) {
    return [
      {
        method: signer.ndtMethod,
        level: signer.certificationLevel,
      } as SupervisorQualification,
    ];
  }
  return [];
}

// Authentication form validation schemas
export const loginFormSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

export type LoginFormValues = z.infer<typeof loginFormSchema>;

export const registerFormSchema = loginFormSchema.extend({
  name: z.string().min(2, "Name must be at least 2 characters"),
  employeeNumber: z.string().optional(),
});

export type RegisterFormValues = z.infer<typeof registerFormSchema>;

// Verification form validation schema
export const verificationFormSchema = z.object({
  verifierName: z.string().min(1, "Name is required"),
});

export type VerificationFormValues = z.infer<typeof verificationFormSchema>;
