import { createAuthClient } from "better-auth/react"
import { oauthProviderClient } from "@better-auth/oauth-provider/client"
import { adminClient, emailOTPClient } from "better-auth/client/plugins"

export const authClient = createAuthClient({
  plugins: [emailOTPClient(), adminClient(), oauthProviderClient()],
})

export const { signUp, signIn, signOut, useSession } = authClient
