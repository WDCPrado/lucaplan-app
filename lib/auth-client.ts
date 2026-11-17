import { createAuthClient } from "better-auth/react"
import { oauthProviderClient } from "@better-auth/oauth-provider/client"
import { adminClient, emailOTPClient } from "better-auth/client/plugins"
import { passkeyClient } from "@better-auth/passkey/client"

export const authClient = createAuthClient({
  plugins: [emailOTPClient(), adminClient(), oauthProviderClient(), passkeyClient()],
})

export const { signUp, signIn, signOut, useSession } = authClient
