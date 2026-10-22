import { UseFormReturn, useFieldArray } from "react-hook-form";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SupervisorFormValues } from "@/types";
import { SIGNER_METHODS, signerMethodLabel, CERTIFICATION_LEVELS } from "@shared/schema";
import { Plus, Trash2 } from "lucide-react";

interface SignerFormFieldsProps {
  form: UseFormReturn<SupervisorFormValues>;
}

export function SignerFormFields({ form }: SignerFormFieldsProps) {
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "qualifications",
  });


  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name <span className="text-red-500">*</span></FormLabel>
              <FormControl><Input {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="phone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Phone Number <span className="text-red-500">*</span></FormLabel>
              <FormControl><Input type="tel" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <FormField
        control={form.control}
        name="email"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Email <span className="text-red-500">*</span></FormLabel>
            <FormControl><Input type="email" {...field} /></FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField
          control={form.control}
          name="spratNumber"
          render={({ field }) => (
            <FormItem>
              <FormLabel>SPRAT #</FormLabel>
              <FormControl><Input {...field} value={field.value ?? ""} /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="irataNumber"
          render={({ field }) => (
            <FormItem>
              <FormLabel>IRATA #</FormLabel>
              <FormControl><Input {...field} value={field.value ?? ""} /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <FormLabel className="text-sm font-medium">Qualifications</FormLabel>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="flex items-center gap-1"
            onClick={() => append({ method: "", level: "" } as never)}
          >
            <Plus className="h-4 w-4" />
            Add
          </Button>
        </div>

        {fields.length === 0 ? (
          <p className="text-sm text-neutral-500">
            No qualifications added. Add the methods and levels this signer can verify.
          </p>
        ) : (
          <div className="space-y-3">
            {fields.map((qualField, index) => (
              <div key={qualField.id} className="flex items-end gap-2">
                <FormField
                  control={form.control}
                  name={`qualifications.${index}.method`}
                  render={({ field }) => (
                    <FormItem className="flex-1">
                      <FormLabel className="text-xs text-neutral-500">Method</FormLabel>
                      <Select value={field.value || undefined} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select method" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {Object.keys(SIGNER_METHODS).map((m) => (
                            <SelectItem key={m} value={m}>
                              {signerMethodLabel(m)}
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
                  name={`qualifications.${index}.level`}
                  render={({ field }) => (
                    <FormItem className="flex-1">
                      <FormLabel className="text-xs text-neutral-500">Level (LVL)</FormLabel>
                      <Select value={field.value || undefined} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select level" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {CERTIFICATION_LEVELS.map((lvl) => (
                            <SelectItem key={lvl} value={lvl}>
                              {lvl}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-red-600 hover:text-red-700 hover:bg-red-50 mb-1"
                  onClick={() => remove(index)}
                  aria-label="Remove qualification"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
