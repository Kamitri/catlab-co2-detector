/**
 * Shared look of input fields: filled background without border at rest, white with
 * primary border when focused. Used by Input, Textarea, and SelectTrigger.
 */
export const FIELD_CLASS =
  "rounded-md border border-transparent bg-field text-[13px] text-foreground transition-[background-color,border-color,box-shadow] outline-none hover:bg-field-hover placeholder:text-muted-foreground focus-visible:border-primary focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-primary/15 aria-invalid:border-destructive aria-invalid:bg-background aria-invalid:ring-2 aria-invalid:ring-destructive/15 disabled:cursor-not-allowed disabled:opacity-50"

/**
 * Field look for wrapper around unstyled input, such as number field with unit.
 * Same as FIELD_CLASS with focus-within and data-invalid; written out because Tailwind generates only literal classes.
 */
export const FIELD_WRAPPER_CLASS =
  "rounded-md border border-transparent bg-field text-[13px] text-foreground transition-[background-color,border-color,box-shadow] outline-none hover:bg-field-hover focus-within:border-primary focus-within:bg-background focus-within:ring-2 focus-within:ring-primary/15 data-[invalid=true]:border-destructive data-[invalid=true]:bg-background data-[invalid=true]:ring-2 data-[invalid=true]:ring-destructive/15"
