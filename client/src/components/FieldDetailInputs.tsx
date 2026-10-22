import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fieldMethodDetails, type EntryDetails } from "@shared/schema";

// The method-specific columns from the ACL paper logbook (Drilling Log,
// Nozzleman Log …), driven by FIELD_METHOD_DETAILS. All optional. Choice
// fields render as tap-to-circle buttons like the printed "Dry  Wet".
export function FieldDetailInputs({
  method,
  value,
  onChange,
  idPrefix,
  large = false,
}: {
  method: string;
  value: EntryDetails | undefined;
  onChange: (next: EntryDetails) => void;
  idPrefix: string;
  large?: boolean;
}) {
  const specs = fieldMethodDetails(method);
  if (specs.length === 0) return null;
  const details = value ?? {};
  const set = (key: string, v: string) => onChange({ ...details, [key]: v });

  return (
    <fieldset className="space-y-3">
      <legend className={`mb-2 font-medium text-foreground ${large ? "text-base" : "text-sm"}`}>
        {method === "CLASSROOM" ? "Class" : "Job"} details <span className="font-normal text-muted-foreground">(optional)</span>
      </legend>
      <div className="grid grid-cols-2 gap-3">
        {specs.map((spec) => {
          const id = `${idPrefix}-${spec.key}`;
          const current = details[spec.key] ?? "";
          if (spec.input === "choice") {
            const picked = current ? current.split(",") : [];
            const toggle = (opt: string) => {
              const next = spec.multiple
                ? picked.includes(opt)
                  ? picked.filter((p) => p !== opt)
                  : spec.options!.filter((o) => o === opt || picked.includes(o))
                : picked.includes(opt)
                ? []
                : [opt];
              set(spec.key, next.join(","));
            };
            return (
              <div key={spec.key} className="space-y-1">
                <Label className="text-xs text-muted-foreground">{spec.label}</Label>
                <div className="flex gap-2" role="group" aria-label={spec.label}>
                  {spec.options!.map((opt) => {
                    const active = picked.includes(opt);
                    return (
                      <button
                        key={opt}
                        type="button"
                        aria-pressed={active}
                        onClick={() => toggle(opt)}
                        className={`h-10 flex-1 rounded-full border text-sm font-medium transition-colors ${
                          active
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-input bg-background text-muted-foreground"
                        }`}
                      >
                        {opt}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          }
          return (
            <div key={spec.key} className="space-y-1">
              <Label htmlFor={id} className="text-xs text-muted-foreground">
                {spec.label}
              </Label>
              <Input
                id={id}
                type={spec.input === "date" ? "date" : "text"}
                inputMode={spec.input === "number" ? "decimal" : undefined}
                placeholder={spec.placeholder}
                value={current}
                onChange={(e) => set(spec.key, e.target.value)}
                className="h-10"
              />
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
