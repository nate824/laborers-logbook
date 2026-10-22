import { useQuery } from "@tanstack/react-query";
import { ProfileHeader } from "@/components/ProfileHeader";
import { CertificationsCard } from "@/components/CertificationsCard";
import type { User } from "@shared/schema";

// Cert wallet. Expiry reminders surface on the Status page.
export default function CertsPage() {
  const { data: user } = useQuery<User>({ queryKey: ["/api/user"] });
  if (!user) return null;
  return (
    <div className="min-h-screen bg-background">
      <ProfileHeader user={user} />
      <main className="mx-auto max-w-3xl px-4 pt-4 pb-mobile-nav md:py-8">
        <CertificationsCard defaultExpanded />
        <p className="mt-3 px-1 text-xs text-muted-foreground">
          Suggested expiry dates use typical renewal intervals. Always copy the date printed on your card.
        </p>
      </main>
    </div>
  );
}
