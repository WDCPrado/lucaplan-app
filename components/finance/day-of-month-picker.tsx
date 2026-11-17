"use client"

import { useState } from "react"
import { CalendarIcon } from "lucide-react"
import { es } from "date-fns/locale"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

// Mes de referencia con 31 días (enero) para que el calendario ofrezca todos los días 1–31.
// Lo recurrente guarda solo el número de día; el mes/año no importan.
const DAY_PICKER_MONTH = new Date(2001, 0, 1)

// Día del mes de recurrentes y cuotas.
export function DayOfMonthPicker({
  value,
  onChange,
  id,
  ...props
}: {
  value: number
  id?: string
  "aria-invalid"?: boolean
  "aria-describedby"?: string
  onChange: (day: number) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          {...props}
          type="button"
          variant="outline"
          className="h-11 w-full justify-start rounded-lg text-body font-normal"
        >
          <CalendarIcon className="size-4 text-ink-3" />
          Día {value}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          locale={es}
          month={DAY_PICKER_MONTH}
          disableNavigation
          showOutsideDays={false}
          selected={new Date(2001, 0, value)}
          onSelect={(d) => {
            if (!d) return
            onChange(d.getDate())
            setOpen(false)
          }}
          classNames={{ month_caption: "hidden", nav: "hidden" }}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  )
}
