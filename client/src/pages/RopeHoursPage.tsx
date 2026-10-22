import { formatCalendarDate } from "@shared/dates";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ExportHoursDialog } from "@/components/ExportHoursDialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLocation } from "wouter";
import { format } from "date-fns";
import { Calendar, Clock, MapPin, Cable, User, Pencil, Upload, FileText, Trash2, CloudOff, AlertTriangle, RefreshCw, ChevronDown, ChevronRight, CheckCircle2, MoreVertical, Send, FileSpreadsheet } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { RopeHours } from "@shared/schema";
import { ProfileHeader } from "@/components/ProfileHeader";
import { SignatureLinkSentDialog, type SignatureRequestResult } from "@/components/SignatureLinkSent";
import { EditRopeHourDialog } from "@/components/EditRopeHourDialog";
import { ImportLogDialog } from "@/components/ImportLogDialog";
import { ImportedLogGroups } from "@/components/ImportedLogGroups";
import { SourceDocumentLink } from "@/components/SourceDocumentLink";
import { VerificationProofModal } from "@/components/VerificationProofModal";
import { useOnlineStatus } from "@/lib/offline/online";
import { useIsMobile } from "@/hooks/use-mobile";
import { MobileLogDrawer } from "@/components/MobileLogDrawer";
import {
  isPendingSync,
  getSyncFailure,
  nextTempId,
  retryFailedRope,
  discardFailedRope,
  type RopeDraft,
} from "@/lib/offline/mutations";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export default function RopeHoursPage() {
  const [proofEntry, setProofEntry] = useState<RopeHours | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [location, setLocation] = useState("");
  const [skills, setSkills] = useState("");
  const [hours, setHours] = useState("");
  const [employer, setEmployer] = useState("");
  const [workDetails, setWorkDetails] = useState("");
  const [maxHeight, setMaxHeight] = useState("");
  const [projectNumber, setProjectNumber] = useState("");
  const [workCode, setWorkCode] = useState("");
  const [editingRopeHour, setEditingRopeHour] = useState<RopeHours | null>(null);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  // Rope Hours History is collapsed by default — the list can get long. The
  // Total Verified Hours card above always stays visible.
  const [historyOpen, setHistoryOpen] = useState(false);
  // Mobile: deletes confirm through one page-level dialog opened from the ⋮ menu.
  const [deleteTarget, setDeleteTarget] = useState<RopeHours | null>(null);
  const { toast } = useToast();
  const online = useOnlineStatus();
  const isMobile = useIsMobile();
  const [, navigate] = useLocation();

  const createMutation = useMutation<
    unknown,
    Error,
    { tempId: number; draft: RopeDraft }
  >({
    mutationKey: ["ropeHours.create"],
  });

  const deleteMutation = useMutation<unknown, Error, number>({
    mutationKey: ["ropeHours.delete"],
    onError: (err) => {
      toast({
        title: "Could not remove entry",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  // Query user data
  const { data: user, isLoading: isLoadingUser } = useQuery({
    queryKey: ["/api/user"]
  });

  // Fetch rope hours
  const { data: ropeHours = [], isLoading } = useQuery<RopeHours[]>({
    queryKey: ["/api/rope-hours"],
    enabled: !!user
  });

  // Fetch supervisors
  const { data: supervisors = [] } = useQuery<any[]>({
    queryKey: ["/api/supervisors"],
    enabled: !!user
  });

  const handleSubmit = (e: React.FormEvent, onDone?: () => void) => {
    e.preventDefault();

    if (!startDate || !endDate || !location || !skills || !hours) {
      toast({
        title: "Error",
        description: "Please fill in all fields",
        variant: "destructive",
      });
      return;
    }

    if (new Date(startDate) >= new Date(endDate)) {
      toast({
        title: "Error",
        description: "End date must be after start date",
        variant: "destructive",
      });
      return;
    }

    createMutation.mutate({
      tempId: nextTempId(),
      draft: {
        startDate,
        endDate,
        location,
        skills,
        hours: parseFloat(hours),
        ...(employer ? { employer } : {}),
        ...(workDetails ? { workDetails } : {}),
        ...(maxHeight ? { maxHeight } : {}),
        ...(projectNumber ? { projectNumber } : {}),
        ...(workCode ? { workCode } : {}),
      },
    });

    // Optimistic UI inserts the row immediately — reset the form right away
    // so the user can keep logging.
    setStartDate("");
    setEndDate("");
    setLocation("");
    setSkills("");
    setHours("");
    setEmployer("");
    setWorkDetails("");
    setMaxHeight("");
    setProjectNumber("");
    setWorkCode("");

    toast({
      title: online ? "Rope hours logged" : "Saved offline",
      description: online
        ? "Your rope hours have been saved."
        : "We'll sync this entry when you reconnect.",
    });
    onDone?.();
  };

  const handleDeleteRopeHour = (ropeHourId: number) => {
    deleteMutation.mutate(ropeHourId);
    toast({
      title:
        ropeHourId < 0
          ? "Removed pending entry"
          : online
          ? "Entry removed"
          : "Removed offline",
      description:
        ropeHourId < 0
          ? "The unsynced entry was discarded."
          : online
          ? "The rope-hours entry has been deleted."
          : "We'll sync this deletion when you reconnect.",
    });
  };

  const handleRetryRope = (entry: RopeHours) => {
    retryFailedRope(entry);
    toast({ title: "Retrying…", description: "Sending this entry again." });
  };

  const handleDiscardRope = (entry: RopeHours) => {
    discardFailedRope(entry);
    toast({
      title: "Entry discarded",
      description: "The failed entry has been removed.",
    });
  };

  const renderDeleteButton = (entry: RopeHours, warnVerified: boolean) => (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-red-600 hover:text-red-700 hover:bg-red-50"
          aria-label="Delete rope hours entry"
          title="Delete entry"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this entry?</AlertDialogTitle>
          <AlertDialogDescription>
            {warnVerified ? "This entry has already been verified. " : ""}
            This will permanently delete the rope-hours entry from{" "}
            {formatCalendarDate(entry.startDate, "medium")} –{" "}
            {formatCalendarDate(entry.endDate, "medium")} at {entry.location}.
            This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => handleDeleteRopeHour(entry.id)}
            className="bg-red-600 hover:bg-red-700"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  const [signatureResult, setSignatureResult] = useState<SignatureRequestResult | null>(null);

  const handleVerifyRequest = async (ropeHourId: number, supervisorId: number) => {
    if (!online) {
      toast({
        title: "Requires internet",
        description: "Connect to request verification from a supervisor.",
        variant: "destructive",
      });
      return;
    }
    try {
      const res = await apiRequest("POST", `/api/verify-request-rope/${ropeHourId}`, {
        supervisorId,
        channels: ["email", "sms"],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/rope-hours"] });
      // Show what went out and offer to text the link from this phone.
      setSignatureResult(await res.json());
    } catch (error) {
      console.error("Error sending verification request:", error);
      toast({
        title: "Error",
        description: "Failed to send verification request. Please try again.",
        variant: "destructive",
      });
    }
  };

  const calculateTotalHours = () => {
    return ropeHours.reduce((total: number, entry: RopeHours) => {
      return entry.verified ? total + entry.hours : total;
    }, 0);
  };

  const renderRopeForm = (onDone?: () => void) => (
    <form onSubmit={(e) => handleSubmit(e, onDone)} className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="startDate">Start Date</Label>
          <Input
            id="startDate"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            required
          />
        </div>
        <div>
          <Label htmlFor="endDate">End Date</Label>
          <Input
            id="endDate"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            required
          />
        </div>
      </div>

      <div>
        <Label htmlFor="location">Location</Label>
        <Input
          id="location"
          placeholder="Enter work location"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          required
        />
      </div>

      <div>
        <Label htmlFor="skills">Skills Used</Label>
        <Textarea
          id="skills"
          placeholder="Describe the skills and techniques used during this rope hours session"
          value={skills}
          onChange={(e) => setSkills(e.target.value)}
          required
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {[
            "Aid Climbing",
            "Anchorage Systems",
            "Ascent",
            "Descent",
            "Deviation",
            "Dual Main Systems",
            "Hauling",
            "Lowering",
            "Re-anchor",
            "Retrievable Rope Systems",
            "Rope to Rope Transfer",
            "Tension Rope Systems",
          ].map((skill) => {
            const tokens = skills
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
            const alreadyAdded = tokens.some(
              (t) => t.toLowerCase() === skill.toLowerCase(),
            );
            return (
              <Button
                key={skill}
                type="button"
                size="sm"
                variant={alreadyAdded ? "secondary" : "outline"}
                disabled={alreadyAdded}
                className="h-7 text-xs"
                onClick={() => {
                  setSkills((prev) => {
                    const trimmed = prev.trim();
                    if (!trimmed) return skill;
                    return trimmed.endsWith(",")
                      ? `${trimmed} ${skill}`
                      : `${trimmed}, ${skill}`;
                  });
                }}
              >
                {skill}
              </Button>
            );
          })}
        </div>
      </div>

      <div>
        <Label htmlFor="hours">Hours</Label>
        <Input
          id="hours"
          type="number"
          step="0.1"
          min="0"
          placeholder="Enter hours worked"
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="projectNumber">Project number</Label>
          <Input
            id="projectNumber"
            value={projectNumber}
            onChange={(e) => setProjectNumber(e.target.value)}
            placeholder="Optional"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="workCode">Work code</Label>
          <Input
            id="workCode"
            value={workCode}
            onChange={(e) => setWorkCode(e.target.value)}
            placeholder="Optional"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="employer">Employer (optional)</Label>
        <Input
          id="employer"
          value={employer}
          onChange={(e) => setEmployer(e.target.value)}
          placeholder="e.g. Acme Inc"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="workDetails">Work details (optional)</Label>
        <Textarea
          id="workDetails"
          value={workDetails}
          onChange={(e) => setWorkDetails(e.target.value)}
          placeholder="What the work was — goes in the Work Details column of the exports"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="maxHeight">Max height (optional, IRATA exports)</Label>
        <Input
          id="maxHeight"
          value={maxHeight}
          onChange={(e) => setMaxHeight(e.target.value)}
          placeholder="e.g. 12m / 40ft"
        />
      </div>

      <Button type="submit" className={onDone ? "w-full h-12 text-base" : ""}>
        {online ? "Log Rope Hours" : "Log Offline"}
      </Button>
    </form>
  );


  const renderMobileRopeCard = (entry: RopeHours) => {
    const isImported = !!entry.importedAt;
    const e = entry as RopeHours & { _pendingSync?: boolean; _syncFailed?: string | null };
    const pending = isPendingSync(e);
    const failed = getSyncFailure(e);
    const requested = !!entry.verificationRequestedAt;
    const canEdit = !isImported && (pending || !!failed || (!entry.verified && !requested));
    const tone = failed
      ? "border-red-200 bg-red-50/60 dark:border-red-900 dark:bg-red-950/30"
      : pending
      ? "border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/30"
      : entry.verified
      ? "border-green-200 bg-green-50/60 dark:border-green-900 dark:bg-green-950/30"
      : "border-border bg-card";

    const status = failed ? (
      <span className="inline-flex items-center gap-1.5 text-sm text-red-700" title={failed}>
        <AlertTriangle className="h-4 w-4" /> Sync failed
      </span>
    ) : pending ? (
      <span className="inline-flex items-center gap-1.5 text-sm text-amber-700">
        <CloudOff className="h-4 w-4" /> Waiting to sync
      </span>
    ) : isImported ? (
      <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
        <FileText className="h-4 w-4" /> Imported from signed log
      </span>
    ) : entry.verified ? (
      <button
        type="button"
        onClick={() => setProofEntry(entry)}
        className="inline-flex min-w-0 items-center gap-1.5 text-left text-sm text-green-700"
      >
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        <span className="truncate">Verified by {entry.verifiedBy}</span>
      </button>
    ) : requested ? (
      <span className="inline-flex items-center gap-1.5 text-sm text-amber-700">
        <Clock className="h-4 w-4" /> Awaiting signature
      </span>
    ) : (
      <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
        <Clock className="h-4 w-4" /> Not yet verified
      </span>
    );

    return (
      <div
        key={entry.id}
        className={`rounded-xl border p-4 shadow-sm transition-colors ${tone}`}
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-base font-semibold text-foreground">
              {formatCalendarDate(entry.startDate, { month: "short", day: "numeric" })} –{" "}
              {formatCalendarDate(entry.endDate, "medium")}
            </div>
            <div className="mt-0.5 flex items-center gap-1 text-sm text-muted-foreground">
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{entry.location}</span>
            </div>
          </div>
          <div className="shrink-0 text-2xl font-bold leading-none tabular-nums text-foreground">
            {entry.hours.toFixed(1)}
            <span className="ml-0.5 text-sm font-medium text-muted-foreground">h</span>
          </div>
        </div>

        {entry.skills && (
          <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{entry.skills}</p>
        )}

        <div className="mt-3 flex items-center gap-2">
          <div className="min-w-0 flex-1">{status}</div>
          {isImported && (
            <SourceDocumentLink recordType="rope" recordId={entry.id} />
          )}
          <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0" aria-label="Entry actions">
                  <MoreVertical className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {failed && (
                  <DropdownMenuItem className="py-3" disabled={!online} onSelect={() => handleRetryRope(entry)}>
                    <RefreshCw className="mr-2 h-4 w-4" /> Retry sync
                  </DropdownMenuItem>
                )}
                {canEdit && (
                  <DropdownMenuItem className="py-3" onSelect={() => setEditingRopeHour(entry)}>
                    <Pencil className="mr-2 h-4 w-4" /> Edit
                  </DropdownMenuItem>
                )}
                {entry.verified && (
                  <DropdownMenuItem className="py-3" onSelect={() => setProofEntry(entry)}>
                    <CheckCircle2 className="mr-2 h-4 w-4" /> View verification
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  className="py-3 text-red-600 focus:text-red-700"
                  onSelect={() => (failed ? handleDiscardRope(entry) : setDeleteTarget(entry))}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {failed ? "Discard" : isImported ? "Remove" : "Delete"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
        </div>

        {!isImported && !entry.verified && !pending && !failed && (
          supervisors.length > 0 ? (
            <Select
              disabled={!online}
              onValueChange={(value) => handleVerifyRequest(entry.id, parseInt(value))}
            >
              <SelectTrigger
                className={`mt-3 h-11 w-full justify-center gap-2 text-base ${
                  requested ? "" : "border-primary/40 text-primary"
                }`}
              >
                <Send className="h-4 w-4" />
                <SelectValue
                  placeholder={
                    !online
                      ? "Verification needs internet"
                      : requested
                      ? "Resend verification request"
                      : "Request verification"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {supervisors.map((supervisor: any) => (
                  <SelectItem key={supervisor.id} value={supervisor.id.toString()} className="py-3">
                    {supervisor.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Button
              type="button"
              variant="outline"
              className="mt-3 h-11 w-full text-base"
              onClick={() => {
                toast({
                  title: "Add a signer first",
                  description: "Add a supervisor on the Signers page, then request verification.",
                });
                navigate("/signers");
              }}
            >
              <Send className="mr-2 h-4 w-4" /> Request verification
            </Button>
          )
        )}
      </div>
    );
  };

  const openImport = () => {
    if (!online) {
      toast({
        title: "Requires internet",
        description: "Importing a signed log uses AI and storage that needs a connection.",
        variant: "destructive",
      });
      return;
    }
    setIsImportDialogOpen(true);
  };

  if (isLoadingUser) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full"></div>
      </div>
    );
  }

  if (!user) {
    return null; // Protected route will handle redirect
  }

  return (
    <div className="min-h-screen bg-neutral-100">
      <ProfileHeader user={user} onExport={() => setExportOpen(true)} />
      <SignatureLinkSentDialog result={signatureResult} onClose={() => setSignatureResult(null)} />
      
      {isMobile ? (
        <main className="px-4 pt-4 pb-mobile-nav space-y-4">
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-end justify-between gap-4">
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Verified rope hours
                </div>
                <div className="text-4xl font-bold tabular-nums text-green-600">
                  {calculateTotalHours().toFixed(1)}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Logged
                </div>
                <div className="text-2xl font-semibold tabular-nums text-foreground">
                  {ropeHours.reduce((t, r) => t + r.hours, 0).toFixed(1)}
                </div>
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <div className="min-w-0 flex-1">
              <MobileLogDrawer
                buttonLabel="Log Rope Hours"
                title="Log New Rope Hours"
                description="Record your rope access hours with date range and skills used"
                icon={<Cable className="h-5 w-5" />}
              >
                {(close) => renderRopeForm(close)}
              </MobileLogDrawer>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={openImport}
              disabled={!online}
              className="h-16 w-[4.25rem] shrink-0 flex-col gap-1 rounded-xl px-0 text-xs"
              aria-label="Import from signed log"
            >
              <Upload className="h-5 w-5" />
              Import
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setExportOpen(true)}
              className="h-16 w-[4.25rem] shrink-0 flex-col gap-1 rounded-xl px-0 text-xs"
              aria-label="Export hours"
            >
              <FileSpreadsheet className="h-5 w-5" />
              Export
            </Button>
          </div>

          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground">
                History{" "}
                <span className="text-sm font-normal text-muted-foreground">({ropeHours.length})</span>
              </h2>
            </div>
            {isLoading ? (
              <div className="py-8 text-center text-muted-foreground">Loading rope hours...</div>
            ) : ropeHours.length === 0 ? (
              <div className="rounded-xl border-2 border-dashed border-border p-8 text-center text-muted-foreground">
                <Cable className="mx-auto mb-2 h-8 w-8 opacity-50" />
                No rope hours yet. Tap <span className="font-medium">Log Rope Hours</span> to add your first session.
              </div>
            ) : (
              <div className="space-y-3">{ropeHours.map(renderMobileRopeCard)}</div>
            )}
          </section>

        </main>
      ) : (
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Cable className="h-8 w-8 text-primary" />
            <h1 className="text-3xl font-bold">Rope Hours Tracking</h1>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (!online) {
                  toast({
                    title: "Requires internet",
                    description:
                      "Importing a signed log uses AI and storage that needs a connection.",
                    variant: "destructive",
                  });
                  return;
                }
                setIsImportDialogOpen(true);
              }}
              disabled={!online}
              title={online ? "Import a signed log" : "Import requires internet"}
            >
              <Upload className="h-4 w-4 mr-2" />
              Import from signed log
            </Button>
          </div>
        </div>

      {/* Total Hours Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Total Verified Hours
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold text-green-600">
            {calculateTotalHours().toFixed(1)} hours
          </div>
        </CardContent>
      </Card>

      {/* Log New Rope Hours Form */}
      {isMobile ? (
        <div className="my-6">
          <MobileLogDrawer
            buttonLabel="Log Rope Hours"
            title="Log New Rope Hours"
            description="Record your rope access training hours with date range and skills used"
            icon={<Cable className="h-5 w-5" />}
          >
            {(close) => renderRopeForm(close)}
          </MobileLogDrawer>
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Log New Rope Hours</CardTitle>
            <CardDescription>
              Record your rope access training hours with date range and skills used
            </CardDescription>
          </CardHeader>
          <CardContent>{renderRopeForm()}</CardContent>
        </Card>
      )}
      {historyOpen && (
        <ImportedLogGroups
          records={ropeHours as RopeHours[]}
          recordType="rope"
        />
      )}

      {/* Rope Hours History */}
      <Card>
        <CardHeader>
          <button
            type="button"
            onClick={() => setHistoryOpen((o) => !o)}
            className="flex items-center gap-2 text-left"
            aria-expanded={historyOpen}
          >
            {historyOpen ? (
              <ChevronDown className="h-5 w-5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-5 w-5 text-muted-foreground" />
            )}
            <CardTitle>
              Rope Hours History
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                ({ropeHours.length})
              </span>
            </CardTitle>
          </button>
          {historyOpen && (
            <CardDescription className="mt-1">
              Your logged rope hours and verification status
            </CardDescription>
          )}
        </CardHeader>
        {historyOpen && (
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8">Loading rope hours...</div>
          ) : ropeHours.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              No rope hours logged yet
            </div>
          ) : (
            <div className="space-y-4">
              {ropeHours.map((entry: RopeHours) => {
                const isImported = !!entry.importedAt;
                const e = entry as RopeHours & { _pendingSync?: boolean; _syncFailed?: string | null };
                const pending = isPendingSync(e);
                const failed = getSyncFailure(e);
                return (
                <div
                  key={entry.id}
                  className={`p-4 border rounded-lg ${
                    failed
                      ? "border-red-200 bg-red-50/60"
                      : pending
                      ? "border-amber-200 bg-amber-50/60"
                      : isImported
                      ? "border-neutral-200 bg-neutral-50 text-neutral-600"
                      : entry.verified
                      ? "border-green-200 bg-green-50"
                      : "border-gray-200"
                  }`}
                >
                  <div className="flex justify-between items-start">
                    <div className="flex gap-3 items-start">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-gray-500" />
                        <span className="font-medium">
                          {formatCalendarDate(entry.startDate, "medium")} - {formatCalendarDate(entry.endDate, "medium")}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <MapPin className="h-4 w-4 text-gray-500" />
                        <span>{entry.location}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-gray-500" />
                        <span>{entry.hours} hours</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <Cable className="h-4 w-4 text-gray-500 mt-1" />
                        <div>
                          <span className="font-medium">Skills: </span>
                          <span className="text-gray-700">{entry.skills}</span>
                        </div>
                      </div>
                      {isImported ? (
                        <div className="flex items-center gap-2 flex-wrap">
                          <FileText className="h-4 w-4 text-neutral-500" />
                          <span className="text-neutral-600 text-sm">
                            Imported from signed log
                            {entry.importedAt
                              ? ` on ${format(new Date(entry.importedAt), "MMM dd, yyyy")}`
                              : ""}
                          </span>
                          <SourceDocumentLink
                            recordType="rope"
                            recordId={entry.id}
                          />
                        </div>
                      ) : entry.verified ? (
                        <button
                          type="button"
                          onClick={() => setProofEntry(entry)}
                          className="flex items-center gap-2 text-green-600 hover:text-green-700 hover:underline"
                          title="View verification record"
                        >
                          <User className="h-4 w-4 text-green-600" />
                          <span>
                            Verified by {entry.verifiedBy} on{" "}
                            {entry.verifiedAt ? format(new Date(entry.verifiedAt), "MMM dd, yyyy") : "N/A"}
                          </span>
                        </button>
                      ) : null}
                    </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {failed ? (
                        <>
                          <span
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-800 text-xs"
                            title={failed}
                          >
                            <AlertTriangle className="h-3 w-3" />
                            Sync failed
                          </span>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs h-7 px-2"
                            onClick={() => handleRetryRope(entry)}
                            disabled={!online}
                          >
                            <RefreshCw className="h-3 w-3 mr-1" />
                            Retry
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-xs h-7 px-2"
                            onClick={() => setEditingRopeHour(entry)}
                            aria-label="Edit entry"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-xs h-7 px-2 text-red-600 hover:text-red-700 hover:bg-red-50"
                            onClick={() => handleDiscardRope(entry)}
                            aria-label="Discard failed entry"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      ) : pending ? (
                        <>
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-xs">
                            <CloudOff className="h-3 w-3" />
                            Pending sync
                          </span>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-xs h-7 px-2"
                            onClick={() => setEditingRopeHour(entry)}
                            aria-label="Edit entry"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          {renderDeleteButton(entry, false)}
                        </>
                      ) : isImported ? (
                        <>
                          <span className="px-2 py-1 bg-neutral-200 text-neutral-700 rounded text-sm">
                            Imported
                          </span>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                aria-label="Remove imported rope hours entry"
                                title="Remove imported entry"
                              >
                                <Trash2 className="h-4 w-4 mr-1" />
                                Remove
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>
                                  Remove this imported entry?
                                </AlertDialogTitle>
                                <AlertDialogDescription>
                                  This will delete the imported rope-hours
                                  entry from{" "}
                                  {formatCalendarDate(entry.startDate, "medium")}{" "}
                                  – {formatCalendarDate(entry.endDate, "medium")}{" "}
                                  at {entry.location}. If no other entries
                                  reference the uploaded log, the original
                                  file will also be removed from storage. This
                                  cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => handleDeleteRopeHour(entry.id)}
                                  className="bg-red-600 hover:bg-red-700"
                                >
                                  Remove
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </>
                      ) : entry.verified ? (
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-1 bg-green-100 text-green-800 rounded text-sm">
                            Verified
                          </span>
                          {renderDeleteButton(entry, true)}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 flex-wrap justify-end">
                          <span className="px-2 py-1 bg-yellow-100 text-yellow-800 rounded text-sm">
                            Pending
                          </span>
                          {!entry.verificationRequestedAt && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => setEditingRopeHour(entry)}
                              aria-label="Edit entry"
                              title="Edit entry"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          )}
                          {supervisors.length > 0 ? (
                            <Select
                              disabled={!online}
                              onValueChange={(value) => handleVerifyRequest(entry.id, parseInt(value))}
                            >
                              <SelectTrigger
                                className="w-full sm:w-48"
                                title={online ? "" : "Verification requires internet"}
                              >
                                <SelectValue placeholder={online ? "Request Verification" : "Verify (online only)"} />
                              </SelectTrigger>
                              <SelectContent>
                                {supervisors.map((supervisor: any) => (
                                  <SelectItem key={supervisor.id} value={supervisor.id.toString()}>
                                    {supervisor.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                toast({
                                  title: "Add a signer first",
                                  description:
                                    "Add a supervisor on the Signers page, then request verification.",
                                });
                                navigate("/signers");
                              }}
                              title="Add a signer to request verification"
                            >
                              Request Verification
                            </Button>
                          )}
                          {renderDeleteButton(entry, false)}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </CardContent>
        )}
      </Card>
      </main>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this entry?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.verified ? "This entry has already been verified. " : ""}
              This will permanently delete the rope-hours entry
              {deleteTarget
                ? ` from ${formatCalendarDate(deleteTarget.startDate, "medium")} – ${formatCalendarDate(deleteTarget.endDate, "medium")} at ${deleteTarget.location}`
                : ""}
              . This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="h-11">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="h-11 bg-red-600 hover:bg-red-700"
              onClick={() => deleteTarget && handleDeleteRopeHour(deleteTarget.id)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ImportLogDialog
        open={isImportDialogOpen}
        onClose={() => setIsImportDialogOpen(false)}
        type="rope"
      />

      <EditRopeHourDialog
        ropeHour={editingRopeHour}
        open={!!editingRopeHour}
        onClose={() => setEditingRopeHour(null)}
      />

      <ExportHoursDialog
        kind="rope"
        open={exportOpen}
        onOpenChange={setExportOpen}
        ropeHours={ropeHours as RopeHours[]}
        user={user}
      />

      {proofEntry && (
        <VerificationProofModal
          open={!!proofEntry}
          onOpenChange={(open) => !open && setProofEntry(null)}
          title="Rope hours verification"
          record={proofEntry}
          summaryRows={[
            {
              label: "Date range",
              value: `${formatCalendarDate(proofEntry.startDate, "medium")} – ${formatCalendarDate(proofEntry.endDate, "medium")}`,
            },
            { label: "Location", value: proofEntry.location },
            { label: "Skills", value: proofEntry.skills },
            { label: "Hours", value: proofEntry.hours.toFixed(1) },
          ]}
        />
      )}
    </div>
  );
}