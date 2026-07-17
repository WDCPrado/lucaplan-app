import { toNextJsHandler } from "better-auth/next-js"
import { auth } from "@/arch/v1/infrastructure/auth/auth"

export const { POST, GET } = toNextJsHandler(auth)
