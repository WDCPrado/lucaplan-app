// cn con la escala tipográfica de iOS. Corre con: node --test lib/utils.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { cn } from "./utils.ts"

test("los tamaños de iOS son tamaños, no colores", () => {
  assert.equal(cn("text-body text-primary"), "text-body text-primary")
  assert.equal(cn("text-caption", "text-foreground"), "text-caption text-foreground")
  assert.equal(cn("text-sm", "text-subheadline"), "text-subheadline")
})
