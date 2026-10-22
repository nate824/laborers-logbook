import { formatCalendarDate } from "@shared/dates";
import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Entry, Supervisor, fieldMethodLabel, signerMethodLabel } from "@shared/schema";
import { supervisorFormSchema, signerToQualifications, type SupervisorFormValues } from "@/types";
import { Check, UserPlus } from "lucide-react";
import { SignerFormFields } from "@/components/SignerFormFields";
import {
  ChannelPicker,
  SignatureLinkSent,
  type Channel,
  type SignatureRequestResult,
} from "@/components/SignatureLinkSent";

interface SupervisorVerifyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  entry?: Entry | null;
  entries?: Entry[];
}

export function SupervisorVerifyModal({ isOpen, onClose, onSuccess, entry, entries }: SupervisorVerifyModalProps) {
  const isBatchMode = Array.isArray(entries) && entries.length >= 2;
  const [supervisors, setSupervisors] = useState<Supervisor[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  // "" = nothing picked yet, "new" = typing in a new signer, else a signer id.
  const [selectedSupervisor, setSelectedSupervisor] = useState<string>("");
  const [result, setResult] = useState<SignatureRequestResult | null>(null);
  const [channels, setChannels] = useState<Channel[]>(["email", "sms"]);
  const { toast } = useToast();

  const form = useForm<SupervisorFormValues>({
    resolver: zodResolver(supervisorFormSchema),
    defaultValues: {
      name: "",
      email: "",
      phone: "",
      company: "",
      spratNumber: "",
      irataNumber: "",
      qualifications: [],
    },
  });

  useEffect(() => {
    if (isOpen) {
      loadSupervisors();
      setSelectedSupervisor("");
      setResult(null);
      setChannels(["email", "sms"]);
      form.reset();
    }
  }, [isOpen, form]);

  const loadSupervisors = async () => {
    try {
      const response = await fetch("/api/supervisors", { credentials: "include" });
      if (response.ok) {
        const data: Supervisor[] = await response.json();
        setSupervisors(data);
        // Nobody on the shared list yet: go straight to the new-signer form.
        if (data.length === 0) setSelectedSupervisor("new");
      }
    } catch (error) {
      console.error(error);
    }
  };

  const handleSupervisorChange = (value: string) => {
    setSelectedSupervisor(value);
    if (value === "new") {
      form.reset();
    } else if (value) {
      const supervisor = supervisors.find((s) => s.id.toString() === value);
      if (supervisor) {
        form.setValue("name", supervisor.name);
        form.setValue("email", supervisor.email);
        form.setValue("phone", supervisor.phone);
        form.setValue("company", supervisor.company ?? "");
        form.setValue("spratNumber", supervisor.spratNumber ?? "");
        form.setValue("irataNumber", supervisor.irataNumber ?? "");
        form.setValue("qualifications", signerToQualifications(supervisor));
      }
    }
  };

  const handleSubmit = async (values: SupervisorFormValues) => {
    if (!isBatchMode && !entry) return;

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      toast({
        title: "Requires internet",
        description:
          "Connect to the internet to send a verification request to your supervisor.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);

    try {
      let supervisorId: number;

      if (selectedSupervisor && selectedSupervisor !== "new") {
        supervisorId = parseInt(selectedSupervisor);
      } else {
        const payload = {
          ...values,
          spratNumber: values.spratNumber || null,
          irataNumber: values.irataNumber || null,
          company: values.company || null,
          qualifications: values.qualifications,
        };
        const supervisorResponse = await apiRequest("POST", "/api/supervisors", payload);
        if (!supervisorResponse.ok) throw new Error("Failed to create supervisor");
        const newSupervisor = await supervisorResponse.json();
        supervisorId = newSupervisor.id;
      }

      if (isBatchMode) {
        const entryIds = entries!.map((e) => e.id);
        const response = await apiRequest("POST", "/api/batch-verify-request", { entryIds, supervisorId, channels });
        if (!response.ok) {
          const err = await response.json();
          throw new Error(err.message || "Failed to send batch verification request");
        }
        setResult(await response.json());
      } else {
        const response = await apiRequest("POST", `/api/verify-request/${entry!.id}`, { supervisorId, channels });
        setResult(await response.json());
      }
      // The entries show "Awaiting signature" right away, behind the result
      // screen; onSuccess (which closes this modal) waits for Done.
      queryClient.invalidateQueries({ queryKey: ["/api/entries"] });
    } catch (error: any) {
      console.error(error);
      toast({
        title: "Error",
        description: error.message || "Failed to send verification request. Please try again.",
        variant: "destructive",
      });
      setResult(null);
    } finally {
      setIsLoading(false);
    }
  };

  const formatMethod = fieldMethodLabel;
  const chosen = supervisors.find((s) => s.id.toString() === selectedSupervisor);
  const watchedEmail = form.watch("email");
  const watchedPhone = form.watch("phone");

  const renderEntryDetails = () => {
    if (isBatchMode) {
      return (
        <div className="bg-neutral-100 rounded-md p-4 mb-4 space-y-1 max-h-48 overflow-y-auto">
          <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-2">
            {entries!.length} entries selected
          </p>
          {entries!.map((e) => (
            <div key={e.id} className="flex justify-between text-sm">
              <span className="text-neutral-700">{formatCalendarDate(e.date)} — {e.location}</span>
              <span className="font-medium text-neutral-900 ml-4">{formatMethod(e.method)} {e.hours.toFixed(1)} h</span>
            </div>
          ))}
          <div className="border-t border-neutral-300 mt-2 pt-2 flex justify-between text-sm font-semibold">
            <span>Total</span>
            <span>{entries!.reduce((s, e) => s + e.hours, 0).toFixed(1)} h</span>
          </div>
        </div>
      );
    }

    if (!entry) return null;
    return (
      <div className="bg-neutral-100 rounded-md p-4 mb-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-neutral-500">Date:</dt>
          <dd className="text-neutral-900 font-medium">{formatCalendarDate(entry.date)}</dd>
          <dt className="text-neutral-500">Location:</dt>
          <dd className="text-neutral-900 font-medium">{entry.location}</dd>
          <dt className="text-neutral-500">Method:</dt>
          <dd className="text-neutral-900 font-medium">{formatMethod(entry.method)}</dd>
          <dt className="text-neutral-500">Hours:</dt>
          <dd className="text-neutral-900 font-medium">{entry.hours.toFixed(1)}</dd>
        </dl>
      </div>
    );
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          const sent = !!result;
          setResult(null);
          if (sent) onSuccess();
          else onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isBatchMode ? "Batch Supervisor Verification" : "Supervisor Verification"}
          </DialogTitle>
          <DialogDescription>
            {isBatchMode
              ? "Choose a supervisor to send a single sign-off request for all selected entries."
              : "Pick who should verify these hours. They'll get a link by email or text to sign off."}
          </DialogDescription>
        </DialogHeader>

        {renderEntryDetails()}

        {result ? (
          <SignatureLinkSent
            result={result}
            onDone={() => {
              setResult(null);
              onSuccess();
            }}
          />        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
              <div>
                <FormLabel>Who should sign off?</FormLabel>
                <div className="mt-2 space-y-2" role="radiogroup">
                  {supervisors.map((supervisor) => {
                    const value = supervisor.id.toString();
                    const active = selectedSupervisor === value;
                    const quals = signerToQualifications(supervisor);
                    return (
                      <button
                        key={supervisor.id}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => handleSupervisorChange(value)}
                        className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                          active ? "border-primary bg-primary/5" : "border-border hover:bg-muted"
                        }`}
                      >
                        <span
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                            active ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"
                          }`}
                        >
                          {active && <Check className="h-3 w-3" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium text-foreground">{supervisor.name}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {quals.length > 0
                              ? quals.map((q) => `${signerMethodLabel(q.method)} ${q.level.replace("Level ", "")}`).join(" · ")
                              : supervisor.email}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    role="radio"
                    aria-checked={selectedSupervisor === "new"}
                    onClick={() => handleSupervisorChange("new")}
                    className={`flex w-full items-center gap-3 rounded-lg border border-dashed p-3 text-left transition-colors ${
                      selectedSupervisor === "new" ? "border-primary bg-primary/5" : "border-border hover:bg-muted"
                    }`}
                  >
                    <UserPlus className="h-5 w-5 shrink-0 text-primary" />
                    <span className="font-medium text-foreground">New signer</span>
                  </button>
                </div>
              </div>

              {selectedSupervisor === "new" && <SignerFormFields form={form} />}

              {selectedSupervisor && (
                <ChannelPicker
                  value={channels}
                  onChange={setChannels}
                  email={selectedSupervisor === "new" ? watchedEmail : chosen?.email}
                  phone={selectedSupervisor === "new" ? watchedPhone : chosen?.phone}
                />
              )}

              <DialogFooter className="mt-6 gap-2">
                <Button type="button" variant="outline" className="h-11 sm:h-10" onClick={onClose} disabled={isLoading}>
                  Cancel
                </Button>
                <Button type="submit" className="h-11 sm:h-10" disabled={isLoading || !selectedSupervisor || channels.length === 0}>
                  {isLoading
                    ? "Sending..."
                    : isBatchMode
                    ? `Send Batch Request (${entries!.length})`
                    : "Send for Verification"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}
