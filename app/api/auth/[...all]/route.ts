import { toNextJsHandler } from "better-auth/next-js"
import { auth } from "@/arch/v1/infrastructure/auth/auth"
import { withPluginAuthRequest } from "@/arch/v1/infrastructure/auth/plugin-request"

const handlers = toNextJsHandler(auth)
export const POST = (request: Request) =>
  withPluginAuthRequest(() => handlers.POST(request))
export const GET = (request: Request) =>
  withPluginAuthRequest(() => handlers.GET(request))
