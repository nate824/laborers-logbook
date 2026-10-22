import type { Supervisor } from "@shared/schema";
import { storage } from "./storage";

// Access Limited is one company, so the signer list is shared: every user sees
// every signer and can request verification from any of them. Editing or
// deleting a signer is limited to whoever added it, plus admins, so nobody can
// break a signer a coworker depends on.

export async function canEditSigner(
  signer: Pick<Supervisor, "userId">,
  userId: number,
): Promise<boolean> {
  if (signer.userId === userId) return true;
  const user = await storage.getUser(userId);
  return !!user?.isAdmin;
}

// The signer already using this email (case-insensitive), if it isn't the one
// being edited. One signer per email keeps the shared list free of duplicates.
export async function findDuplicateSigner(
  email: string | undefined,
  excludeId?: number,
): Promise<Supervisor | undefined> {
  if (!email) return undefined;
  const existing = await storage.findSupervisorByEmail(email);
  return existing && existing.id !== excludeId ? existing : undefined;
}

export function duplicateSignerMessage(existing: Supervisor): string {
  return `${existing.name} <${existing.email}> is already on the signer list.`;
}
