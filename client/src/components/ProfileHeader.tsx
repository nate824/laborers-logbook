import { apiRequest, queryClient } from "@/lib/queryClient";
import { User } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import {
  FileSpreadsheet,
  ClipboardList,
  Cable,
  Settings,
  UserCheck,
  LogOut,
  Sun,
  Moon,
  Monitor,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useIsMobile } from "@/hooks/use-mobile";
import { useTheme } from "@/hooks/use-theme";
import { ConnectivityChip } from "@/components/ConnectivityChip";
import { ThemeToggle } from "@/components/ThemeToggle";
import { AdminViewToggle } from "@/components/admin/AdminViewToggle";
import { useOnlineStatus } from "@/lib/offline/online";

interface ProfileHeaderProps {
  user: Partial<User>;
  // Pages with an export (Field / Rope Hours) pass this; the header shows an
  // Export button (desktop) / menu item (mobile) that calls it.
  onExport?: () => void;
}

export function ProfileHeader({ user, onExport }: ProfileHeaderProps) {
  const { toast } = useToast();
  const [location, setLocation] = useLocation();
  const online = useOnlineStatus();
  const isMobile = useIsMobile();
  const { theme, setTheme } = useTheme();

  const handleLogout = async () => {
    try {
      await apiRequest("POST", "/api/auth/logout");
      queryClient.clear();
      // Wipe the offline API cache so the next user can't see prior data.
      if (typeof caches !== "undefined") {
        try {
          const keys = await caches.keys();
          await Promise.all(
            keys
              .filter((k) => k.startsWith("ojt-api-"))
              .map((k) => caches.delete(k)),
          );
        } catch {
          /* ignore */
        }
      }
      setLocation("/");
    } catch (error) {
      console.error(error);
      toast({
        title: "Error",
        description: "Failed to log out. Please try again.",
        variant: "destructive",
      });
    }
  };

  const requireOnline = (action: string): boolean => {
    if (!online) {
      toast({
        title: "Requires internet",
        description: `${action} is unavailable while offline. Reconnect and try again.`,
        variant: "destructive",
      });
      return false;
    }
    return true;
  };

  const handleAdminClick = () => {
    if (!requireOnline("Admin")) return;
    setLocation("/admin");
  };

  const navItems = [
    { path: "/field-hours", label: "Field Hours", short: "Field", icon: ClipboardList },
    { path: "/rope-hours", label: "Rope Hours", short: "Rope", icon: Cable },
    { path: "/signers", label: "Signers", short: "Signers", icon: UserCheck },
  ];

  const initials =
    (user.name || user.email || "?")
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]!.toUpperCase())
      .join("") || "?";

  if (isMobile) {
    return (
      <>
        <header className="sticky top-0 z-30 bg-card/95 backdrop-blur border-b border-border pt-safe">
          <div className="h-14 px-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#024985] text-[10px] font-bold tracking-tight text-white">
                ACL
              </span>
              <span className="truncate text-base font-semibold text-foreground">
                {navItems.find((n) => n.path === location)?.label ?? "Logbook"}
              </span>
              <ConnectivityChip />
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary"
                  aria-label="Account menu"
                >
                  {initials}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel className="font-normal">
                  <div className="font-semibold text-foreground">
                    {user.name || "New User"}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">{user.email}</div>
                  {user.employeeNumber && (
                    <div className="text-xs text-muted-foreground">
                      Employee #: {user.employeeNumber}
                    </div>
                  )}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {onExport && (
                  <DropdownMenuItem className="py-3" onSelect={onExport}>
                    <FileSpreadsheet className="mr-2 h-4 w-4" />
                    Export hours
                  </DropdownMenuItem>
                )}
                {user.isAdmin && (
                  <DropdownMenuItem className="py-3" onSelect={handleAdminClick}>
                    <Settings className="mr-2 h-4 w-4" />
                    Admin
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                  Theme
                </DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={theme}
                  onValueChange={(v) => setTheme(v as typeof theme)}
                >
                  <DropdownMenuRadioItem value="light" className="py-2.5">
                    <Sun className="mr-2 h-4 w-4" /> Light
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="dark" className="py-2.5">
                    <Moon className="mr-2 h-4 w-4" /> Dark
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="system" className="py-2.5">
                    <Monitor className="mr-2 h-4 w-4" /> System
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="py-3 text-primary focus:text-primary"
                  onSelect={handleLogout}
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Bottom tab bar — thumb-reachable navigation on phones. */}
        <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 backdrop-blur pb-safe">
          <div className="grid grid-cols-3">
            {navItems.map(({ path, short, icon: Icon }) => {
              const active = location === path;
              return (
                <button
                  key={path}
                  type="button"
                  onClick={() => setLocation(path)}
                  aria-current={active ? "page" : undefined}
                  className={`flex h-16 flex-col items-center justify-center gap-1 text-xs font-medium ${
                    active ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  <Icon className={`h-6 w-6 ${active ? "stroke-[2.25]" : ""}`} />
                  {short}
                </button>
              );
            })}
          </div>
        </nav>
      </>
    );
  }

  return (
    <>
      <header className="bg-card shadow-sm border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-foreground">
              Access Limited Logbook
            </h1>
            <ConnectivityChip />
          </div>

          <div className="flex items-center space-x-3">
            <AdminViewToggle />
            <span className="text-sm text-muted-foreground hidden sm:inline">
              {user.email}
            </span>
            <ThemeToggle />
            <button
              onClick={handleLogout}
              className="text-sm text-primary hover:text-primary/80 focus:outline-none"
            >
              Logout
            </button>
          </div>
        </div>

        {/* Navigation */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex space-x-8 overflow-x-auto">
            {navItems.map(({ path, label, icon: Icon }) => (
              <button
                key={path}
                onClick={() => setLocation(path)}
                className={`py-2 px-1 border-b-2 font-medium text-sm whitespace-nowrap ${
                  location === path
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4" />
                  {label}
                </div>
              </button>
            ))}
            {user.isAdmin && (
              <button
                onClick={handleAdminClick}
                className={`py-2 px-1 border-b-2 font-medium text-sm whitespace-nowrap ${
                  location === "/admin"
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                } ${!online ? "opacity-60" : ""}`}
                title={online ? "Admin" : "Admin requires internet"}
              >
                <div className="flex items-center gap-2">
                  <Settings className="h-4 w-4" />
                  Admin
                </div>
              </button>
            )}
          </nav>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white rounded-lg shadow-sm p-6 mb-8">
          <div className="sm:flex sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-neutral-900">
                {user.name || "New User"}
              </h2>
              {user.employeeNumber && (
                <p className="text-sm text-neutral-500">
                  Employee #: {user.employeeNumber}
                </p>
              )}
            </div>

            {onExport && (
              <div className="mt-4 sm:mt-0">
                <Button variant="outline" onClick={onExport} className="inline-flex items-center">
                  <FileSpreadsheet className="mr-2 h-4 w-4" />
                  Export hours
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
