import Link from "next/link"

export default function Page() {
  return (
    <main className="grid min-h-svh place-items-center bg-background px-6 text-foreground">
      <div className="text-center">
        <h1 className="font-heading text-3xl font-bold tracking-tight">LucaPlan</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Finanzas personales — en construcción.
        </p>
        <Link
          href="/design"
          className="mt-6 inline-flex rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-transform active:scale-95"
        >
          Ver mocks de diseño
        </Link>
      </div>
    </main>
  )
}
