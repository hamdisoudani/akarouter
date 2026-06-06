import Link from 'next/link'

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col">
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-b from-gray-50 to-white py-20 lg:py-32">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-3xl text-center">
            <span className="inline-flex items-center rounded-full bg-blue-50 px-3 py-1 text-sm font-medium text-blue-700 mb-6">
              AKAROUTER v0.1 — Now on Railway
            </span>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-gray-900 mb-6">
              Multi-Account AI Inference
              <br />
              <span className="akarouter-text-gradient">Proxy & Router</span>
            </h1>
            <p className="text-lg sm:text-xl text-gray-600 mb-10 max-w-2xl mx-auto">
              Route requests across your Hermes/NOUS accounts with automatic token refresh,
              health-weighted round-robin, and a fully OpenAI-compatible API.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                href="/dashboard"
                className="w-full sm:w-auto rounded-lg bg-blue-600 px-8 py-3 text-base font-semibold text-white shadow-sm hover:bg-blue-700 transition-colors"
              >
                Open Dashboard
              </Link>
              <Link
                href="https://github.com/hamdisoudani/akarouter"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full sm:w-auto rounded-lg border border-gray-300 bg-white px-8 py-3 text-base font-semibold text-gray-700 shadow-sm hover:bg-gray-50 transition-colors"
              >
                View Source
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 bg-white border-t border-gray-100">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-16">Why AKAROUTER?</h2>
          <div className="grid md:grid-cols-3 gap-8">
            <FeatureCard
              title="Auto Token Refresh"
              description="Hermes/NOUS refresh tokens are single-use. AKAROUTER handles per-account refresh locks in Supabase — no race conditions, no expired tokens."
              icon="🔄"
            />
            <FeatureCard
              title="Health-Weighted Routing"
              description="Round-robin weighted by success rate and concurrency. Dead accounts auto-excluded. Free-tier TCP-reset limits respected."
              icon="⚖️"
            />
            <FeatureCard
              title="OpenAI-Compatible API"
              description="Drop-in replacement for OpenAI SDK. `/v1/models`, `/v1/chat/completions`, streaming support — zero code changes for clients."
              icon="🔌"
            />
          </div>
        </div>
      </section>

      {/* Deploy targets */}
      <section className="py-20 bg-gray-50">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl font-bold text-gray-900 mb-6">Deploy Anywhere</h2>
          <p className="text-gray-600 mb-12 max-w-2xl mx-auto">
            Clean configs for Railway, Render, and Docker. Frontend deploys to Vercel. Your Supabase project handles auth & account storage.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <Badge>Railway ✓ Live</Badge>
            <Badge>Render Ready</Badge>
            <Badge>Docker Ready</Badge>
            <Badge>Vercel Frontend</Badge>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 bg-gray-900 text-gray-400">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 text-center">
          <p>Built with FastAPI + Next.js + Supabase</p>
          <p className="mt-2 text-sm">
            <a href="https://github.com/hamdisoudani/akarouter" className="hover:text-white" target="_blank" rel="noopener">
              GitHub
            </a> · 
            <a href="https://akarouter-production.up.railway.app/docs" className="hover:text-white" target="_blank" rel="noopener">
              API Docs
            </a>
          </p>
        </div>
      </footer>
    </main>
  )
}

function FeatureCard({ title, description, icon }: { title: string; description: string; icon: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm hover:shadow-md transition-shadow">
      <div className="text-4xl mb-4">{icon}</div>
      <h3 className="text-xl font-semibold text-gray-900 mb-2">{title}</h3>
      <p className="text-gray-600">{description}</p>
    </div>
  )
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-white px-4 py-1.5 text-sm font-medium text-gray-700 border border-gray-200 shadow-sm">
      {children}
    </span>
  )
}
