import type { NextConfig } from "next"

const nextConfig: NextConfig = {
    allowedDevOrigins: ['pcwilly.taild2feb2.ts.net', '100.101.76.33'],
    // Patchright/Playwright son módulos nativos de Node (lanzan Chromium): no se deben empaquetar.
    // Se dejan como require en runtime desde node_modules (evita "Can't resolve 'chromium-bidi'").
    serverExternalPackages: ['patchright', 'patchright-core']
}

export default nextConfig
