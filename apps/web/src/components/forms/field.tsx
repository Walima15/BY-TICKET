import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type FieldProps = React.ComponentProps<"input"> & {
  label: string;
  error?: string;
  hint?: string;
  multiline?: boolean;
};

/** Labelled input with hint + inline error, wired up for screen readers. */
export function Field({ label, error, hint, multiline, className, id, ...props }: FieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const describedBy = [hint && `${inputId}-hint`, error && `${inputId}-error`].filter(Boolean).join(" ") || undefined;
  const shared = {
    id: inputId,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy,
  };

  return (
    <div className="space-y-1.5">
      <Label htmlFor={inputId}>{label}</Label>
      {multiline ? (
        <textarea
          {...shared}
          name={props.name}
          defaultValue={props.defaultValue}
          placeholder={props.placeholder}
          required={props.required}
          rows={4}
          className={cn(
            "border-input dark:bg-input/30 focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive w-full rounded-lg border bg-transparent px-2.5 py-2 text-base outline-none focus-visible:ring-3 md:text-sm",
            className,
          )}
        />
      ) : (
        <Input {...props} {...shared} className={cn("h-10", className)} />
      )}
      {hint && !error && (
        <p id={`${inputId}-hint`} className="text-muted-foreground text-xs">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${inputId}-error`} className="text-destructive text-xs">
          {error}
        </p>
      )}
    </div>
  );
}
