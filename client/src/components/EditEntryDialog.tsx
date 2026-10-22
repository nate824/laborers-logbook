import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useOnlineStatus } from "@/lib/offline/online";
import type { EntryDraft } from "@/lib/offline/mutations";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Entry, FieldMethods, cleanEntryDetails, fieldMethodLabel } from "@shared/schema";
import { FieldDetailInputs } from "@/components/FieldDetailInputs";

const formSchema = z.object({
  date: z.string().min(1, "Date is required"),
  location: z.string().min(1, "Location is required"),
  method: z.string().min(1, "Pick on the job or class"),
  hours: z.number().min(0.1, "Hours must be greater than 0"),
  details: z.record(z.string(), z.string()),
});

type FormValues = z.infer<typeof formSchema>;

const methodOptions = Object.keys(FieldMethods).map((key) => ({
  value: key,
  label: fieldMethodLabel(key),
}));

interface EditEntryDialogProps {
  entry: Entry | null;
  open: boolean;
  onClose: () => void;
}

export function EditEntryDialog({
  entry,
  open,
  onClose,
}: EditEntryDialogProps) {
  const { toast } = useToast();
  const online = useOnlineStatus();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { date: "", location: "", method: "", hours: 0, details: {} },
  });

  useEffect(() => {
    if (entry && open) {
      form.reset({
        date: new Date(entry.date).toISOString().split("T")[0],
        location: entry.location,
        method: entry.method,
        hours: entry.hours,
        details: entry.details ?? {},
      });
    }
  }, [entry, open, form]);

  const updateMutation = useMutation<
    unknown,
    Error,
    { id: number; patch: Partial<EntryDraft> }
  >({
    mutationKey: ["entries.update"],
    onError: (err) => {
      toast({
        title: "Could not save changes",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (values: FormValues) => {
    if (!entry) return;
    updateMutation.mutate({
      id: entry.id,
      patch: {
        date: values.date,
        location: values.location,
        method: values.method,
        hours: Number(values.hours),
        details: cleanEntryDetails(values.method, values.details),
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
          <DialogTitle>Edit Work Hours Entry</DialogTitle>
          <DialogDescription>
            Make changes to this entry. Once it's been verified, it can no
            longer be edited.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(handleSubmit)}
            className="space-y-4"
          >
            <FormField
              control={form.control}
              name="date"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Job Date</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="location"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Job Location</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="method"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Type</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select method" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {methodOptions.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="hours"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Hours</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min="0"
                      step="0.5"
                      {...field}
                      onChange={(e) =>
                        field.onChange(parseFloat(e.target.value) || 0)
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="details"
              render={({ field }) => (
                <FieldDetailInputs
                  method={form.watch("method")}
                  value={field.value}
                  onChange={field.onChange}
                  idPrefix="edit"
                />
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit">
                {online ? "Save Changes" : "Save Offline"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
