import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import { User } from "@shared/schema";
import { useAuth } from "@/hooks/use-auth";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Search, Shield, UserPlus, Users } from "lucide-react";
import { useLocation } from "wouter";
import { AdminViewToggle } from "@/components/admin/AdminViewToggle";
import { UserDetailPanel } from "@/components/admin/UserDetailPanel";
import { AddUserDialog } from "@/components/admin/AddUserDialog";

export default function AdminPage() {
  const { user, isLoading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  // Redirect non-admins away.
  useEffect(() => {
    if (!authLoading && user && !user.isAdmin) {
      setLocation("/status");
    }
  }, [user, authLoading, setLocation]);

  const { data: users, isLoading: usersLoading } = useQuery<User[]>({
    queryKey: ["/api/admin/users"],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!user?.isAdmin,
  });

  // Default the selection to the first user once loaded.
  useEffect(() => {
    if (selectedUserId === null && users && users.length > 0) {
      setSelectedUserId(users[0].id);
    }
  }, [users, selectedUserId]);

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  if (!user?.isAdmin) return null;

  const filtered = users?.filter(
    (u) =>
      u.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.employeeNumber?.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  return (
    <div className="min-h-screen bg-neutral-100">
      <header className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold text-neutral-900 flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            Admin
          </h1>
          <AdminViewToggle />
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6">
          {/* User list */}
          <aside className="bg-white rounded-lg shadow-sm p-4 h-fit">
            <Button
              size="sm"
              className="w-full mb-3"
              onClick={() => setAddOpen(true)}
            >
              <UserPlus className="h-4 w-4 mr-2" />
              Add user
            </Button>
            <div className="flex items-center gap-2 mb-3">
              <Search className="h-4 w-4 text-neutral-400" />
              <Input
                placeholder="Search users…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="h-9"
              />
            </div>
            {usersLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : !filtered || filtered.length === 0 ? (
              <p className="text-sm text-neutral-500 py-4 text-center">No users found.</p>
            ) : (
              <div className="space-y-1 max-h-[70vh] overflow-y-auto">
                {filtered.map((u) => {
                  const active = u.id === selectedUserId;
                  return (
                    <button
                      key={u.id}
                      onClick={() => setSelectedUserId(u.id)}
                      className={`w-full text-left rounded-md px-3 py-2 transition-colors ${
                        active ? "bg-primary/10 ring-1 ring-primary/30" : "hover:bg-neutral-50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-neutral-900 truncate">
                          {u.name || u.email}
                        </span>
                        {u.isAdmin && (
                          <Shield className="h-3.5 w-3.5 text-primary shrink-0" />
                        )}
                      </div>
                      <p className="text-xs text-neutral-500 truncate">{u.email}</p>
                    </button>
                  );
                })}
              </div>
            )}
            <div className="mt-3 pt-3 border-t text-xs text-neutral-400 flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" />
              {users?.length ?? 0} total
            </div>
          </aside>

          {/* Detail */}
          <section className="bg-white rounded-lg shadow-sm p-6 min-h-[400px]">
            {selectedUserId ? (
              <UserDetailPanel
                key={selectedUserId}
                userId={selectedUserId}
                currentAdminId={user.id}
                onDeleted={() => setSelectedUserId(null)}
              />
            ) : (
              <div className="flex items-center justify-center h-64 text-neutral-400 text-sm">
                Select a user to view their details.
              </div>
            )}
          </section>
        </div>
      </main>

      <AddUserDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={(id) => setSelectedUserId(id)}
      />
    </div>
  );
}
