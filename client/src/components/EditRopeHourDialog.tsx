import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useOnlineStatus } from "@/lib/offline/online";
import type { RopeDraft } from "@/lib/offline/mutations";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RopeHours } from "@shared/schema";

interface EditRopeHourDialogProps {
  ropeHour: RopeHours | null;
  open: boolean;
  onClose: () => void;
}

export function EditRopeHourDialog({
  ropeHour,
  open,
  onClose,
}: EditRopeHourDialogProps) {
  const { toast } = useToast();
  const online = useOnlineStatus();
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

  useEffect(() => {
    if (ropeHour && open) {
      setStartDate(new Date(ropeHour.startDate).toISOString().split("T")[0]);
      setEndDate(new Date(ropeHour.endDate).toISOString().split("T")[0]);
      setLocation(ropeHour.location);
      setSkills(ropeHour.skills);
      setHours(String(ropeHour.hours));
      setEmployer(ropeHour.employer ?? "");
      setWorkDetails(ropeHour.workDetails ?? "");
      setMaxHeight(ropeHour.maxHeight ?? "");
      setProjectNumber(ropeHour.projectNumber ?? "");
      setWorkCode(ropeHour.workCode ?? "");
    }
  }, [ropeHour, open]);

  const updateMutation = useMutation<
    unknown,
    Error,
    { id: number; patch: Partial<RopeDraft> }
  >({
    mutationKey: ["ropeHours.update"],
    onError: (err) => {
      toast({
        title: "Could not save changes",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ropeHour) return;
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

    updateMutation.mutate({
      id: ropeHour.id,
      patch: {
        startDate,
        endDate,
        location,
        skills,
        hours: parseFloat(hours),
        employer: employer || undefined,
        workDetails: workDetails || undefined,
        maxHeight: maxHeight || undefined,
        projectNumber: projectNumber || null,
        workCode: workCode || null,
      },
    });
    toast({
      title: online ? "Entry updated" : "Saved offline",
      description: online
        ? "Your changes have been saved."
        : "We'll sync your edit when you reconnect.",
    });
    onClose();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Rope Hour Entry</DialogTitle>
          <DialogDescription>
            Make changes to this entry. Once it's been verified, it can no
            longer be edited.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="edit-startDate">Start Date</Label>
              <Input
                id="edit-startDate"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor="edit-endDate">End Date</Label>
              <Input
                id="edit-endDate"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                required
              />
            </div>
          </div>

          <div>
            <Label htmlFor="edit-location">Location</Label>
            <Input
              id="edit-location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              required
            />
          </div>

          <div>
            <Label htmlFor="edit-skills">Skills Used</Label>
            <Textarea
              id="edit-skills"
              value={skills}
              onChange={(e) => setSkills(e.target.value)}
              required
            />
          </div>

          <div>
            <Label htmlFor="edit-hours">Hours</Label>
            <Input
              id="edit-hours"
              type="number"
              step="0.1"
              min="0"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="edit-projectNumber">Project number</Label>
              <Input
                id="edit-projectNumber"
                value={projectNumber}
                onChange={(e) => setProjectNumber(e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-workCode">Work code</Label>
              <Input
                id="edit-workCode"
                value={workCode}
                onChange={(e) => setWorkCode(e.target.value)}
                placeholder="Optional"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-employer">Employer (optional)</Label>
            <Input
              id="edit-employer"
              value={employer}
              onChange={(e) => setEmployer(e.target.value)}
              placeholder="e.g. Acme Inc"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-workDetails">Work details (optional)</Label>
            <Textarea
              id="edit-workDetails"
              value={workDetails}
              onChange={(e) => setWorkDetails(e.target.value)}
              placeholder="What the work was — goes in the Work Details column of the exports"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-maxHeight">Max height (optional, IRATA exports)</Label>
            <Input
              id="edit-maxHeight"
              value={maxHeight}
              onChange={(e) => setMaxHeight(e.target.value)}
              placeholder="e.g. 12m / 40ft"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">
              {online ? "Save Changes" : "Save Offline"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
