import * as React from "react"
import { FIELD_CLASS } from "@/lib/fieldStyle"
import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn("h-7 w-full min-w-0 px-2 py-0", FIELD_CLASS, className)}
      {...props}
    />
  )
}

export { Input }
