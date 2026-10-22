import { todayLocalISODate } from "@shared/dates";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useOnlineStatus } from "@/lib/offline/online";
import { nextTempId, type EntryDraft } from "@/lib/offline/mutations";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, X } from "lucide-react";
import { z } from "zod";
import { Fragment } from "react";
import { FieldMethods, cleanEntryDetails, fieldMethodDetails, fieldMethodLabel } from "@shared/schema";
import { FieldDetailInputs } from "@/components/FieldDetailInputs";

const formSchema = z.object({
  entries: z.array(
    z.object({
      date: z.string().min(1, "Date is required"),
      location: z.string().min(1, "Location is required"),
      method: z.string().min(1, "Method is required"),
      hours: z.number().min(0.1, "Hours must be greater than 0"),
      details: z.record(z.string(), z.string()),
    }),
  ),
});

type FormValues = z.infer<typeof formSchema>;

const emptyRow = () => ({
  date: todayLocalISODate(),
  location: "",
  method: "",
  hours: 0,
  details: {} as Record<string, string>,
});

export function NewEntryForm({
  mobile = false,
  onDone,
}: { mobile?: boolean; onDone?: () => void } = {}) {
  const { toast } = useToast();
  const online = useOnlineStatus();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { entries: [emptyRow()] },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "entries",
  });

  const createMutation = useMutation<
    unknown,
    Error,
    { tempId: number; draft: EntryDraft }
  >({
    mutationKey: ["entries.create"],
  });

  const handleSubmit = (values: FormValues) => {
    // Each row becomes its own create mutation so that an offline edit or
    // delete on a still-pending row can coalesce 1:1 into the queued create.
    values.entries.forEach((e) => {
      const draft: EntryDraft = {
        date: e.date,
        location: e.location,
        method: e.method,
        hours: Number(e.hours),
        details: cleanEntryDetails(e.method, e.details),
      };
      createMutation.mutate({ tempId: nextTempId(), draft });
    });

    // Reset form + toast immediately — the optimistic cache update has
    // already inserted these rows into the table. If we're offline, the
    // mutation is queued and will sync when the connection returns.
    form.reset({ entries: [emptyRow()] });
    toast({
      title: online ? "Entries added" : "Saved offline",
      description: online
        ? "Your field hours have been saved."
        : "We'll sync these entries when you reconnect.",
    });
    onDone?.();
  };

  const methodOptions = Object.keys(FieldMethods).map((key) => ({
    value: key,
    label: fieldMethodLabel(key),
  }));

  if (mobile) {
    return (
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(handleSubmit)}
          className="space-y-5"
        >
          <FormField
            control={form.control}
            name="entries.0.date"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">Job Date</FormLabel>
                <FormControl>
                  <Input type="date" {...field} className="w-full" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="entries.0.location"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">Job Location</FormLabel>
                <FormControl>
                  <Input placeholder="Enter location" {...field} className="w-full" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="entries.0.method"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">Method</FormLabel>
                {/* Big tap targets instead of a dropdown — one tap on a phone. */}
                <div className="grid grid-cols-3 gap-2" role="radiogroup">
                  {methodOptions.map((option) => {
                    const active = field.value === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => field.onChange(option.value)}
                        className={`h-12 rounded-md border text-base font-medium transition-colors ${
                          active
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-input bg-background text-foreground"
                        }`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="entries.0.details"
            render={({ field }) => (
              <FieldDetailInputs
                method={form.watch("entries.0.method")}
                value={field.value}
                onChange={field.onChange}
                idPrefix="new-0"
                large
              />
            )}
          />
          <FormField
            control={form.control}
            name="entries.0.hours"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">Hours</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.5"
                    placeholder="0.0"
                    {...field}
                    value={field.value || ""}
                    onChange={(e) =>
                      field.onChange(parseFloat(e.target.value) || 0)
                    }
                    className="w-full"
                  />
                </FormControl>
                <div className="flex gap-2">
                  {[4, 8, 10, 12].map((h) => (
                    <button
                      key={h}
                      type="button"
                      onClick={() => field.onChange(h)}
                      className={`h-10 flex-1 rounded-md border text-sm font-medium ${
                        field.value === h
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-input text-muted-foreground"
                      }`}
                    >
                      {h}h
                    </button>
                  ))}
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit" className="w-full h-12 text-base">
            {online ? "Save Entry" : "Save Offline"}
          </Button>
        </form>
      </Form>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-sm p-6 mb-8">
      <h2 className="text-lg font-semibold text-neutral-900 mb-4">
        Log Field Hours
      </h2>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleSubmit)}>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-neutral-200 mb-4">
              <thead>
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">
                    Job Date
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">
                    Job Location
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">
                    Method
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">
                    Hours
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-neutral-200">
                {fields.map((field, index) => (
                  <Fragment key={field.id}>
                  <tr className="new-entry-row">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <FormField
                        control={form.control}
                        name={`entries.${index}.date`}
                        render={({ field }) => (
                          <FormItem>
                            <FormControl>
                              <Input
                                type="date"
                                {...field}
                                className="w-full border-neutral-200 rounded-md focus:ring-primary focus:border-primary sm:text-sm"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <FormField
                        control={form.control}
                        name={`entries.${index}.location`}
                        render={({ field }) => (
                          <FormItem>
                            <FormControl>
                              <Input
                                placeholder="Enter location"
                                {...field}
                                className="w-full border-neutral-200 rounded-md focus:ring-primary focus:border-primary sm:text-sm"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <FormField
                        control={form.control}
                        name={`entries.${index}.method`}
                        render={({ field }) => (
                          <FormItem>
                            <Select
                              onValueChange={field.onChange}
                              defaultValue={field.value}
                            >
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select method" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {methodOptions.map((option) => (
                                  <SelectItem
                                    key={option.value}
                                    value={option.value}
                                  >
                                    {option.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <FormField
                        control={form.control}
                        name={`entries.${index}.hours`}
                        render={({ field }) => (
                          <FormItem>
                            <FormControl>
                              <Input
                                type="number"
                                min="0"
                                step="0.5"
                                placeholder="0.0"
                                {...field}
                                onChange={(e) =>
                                  field.onChange(
                                    parseFloat(e.target.value) || 0,
                                  )
                                }
                                className="w-full border-neutral-200 rounded-md focus:ring-primary focus:border-primary sm:text-sm"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-right text-sm font-medium">
                      <button
                        type="button"
                        onClick={() => {
                          if (fields.length > 1) remove(index);
                        }}
                        className="text-neutral-500 hover:text-status-error focus:outline-none"
                        disabled={fields.length <= 1}
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                  {fieldMethodDetails(form.watch(`entries.${index}.method`)).length > 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 pb-4 pt-0">
                        <FormField
                          control={form.control}
                          name={`entries.${index}.details`}
                          render={({ field }) => (
                            <div className="rounded-md border border-dashed border-neutral-200 p-3 [&_.grid]:grid-cols-2 md:[&_.grid]:grid-cols-4">
                              <FieldDetailInputs
                                method={form.watch(`entries.${index}.method`)}
                                value={field.value}
                                onChange={field.onChange}
                                idPrefix={`new-${index}`}
                              />
                            </div>
                          )}
                        />
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col sm:flex-row sm:justify-between items-start sm:items-center space-y-4 sm:space-y-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => append(emptyRow())}
              className="inline-flex items-center"
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Another Entry
            </Button>

            <Button type="submit" className="inline-flex items-center">
              {online ? "Save Entries" : "Save Offline"}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
