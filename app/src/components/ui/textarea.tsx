import * as React from "react"
import { FIELD_CLASS } from "@/lib/fieldStyle"
import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn("flex field-sizing-content min-h-14 w-full px-2 py-1.5", FIELD_CLASS, className)}
      {...props}
    />
  )
}

export { Textarea }
