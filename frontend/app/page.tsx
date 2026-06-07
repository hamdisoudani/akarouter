import Link from 'next/link'

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white flex flex-col">
      {/* Nav */}
      <nav className="px-6 py-4 border-b border-gray-800/50">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">AKAROUTER</h1>
          <div className="flex items-center gap-4">
            <Link href="/auth/login" className="text-sm text-gray-400 hover:text-white transition-colors">Sign in</Link>
            <Link href="/auth/login" className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors">Get Started</Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <main className="flex-1 flex items-center justify-center px-6 py-20">
        <div className="max-w-3xl text-center">
          <div className="inline-block mb-4 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-xs text-blue-400">
            OpenAI-Compatible API
          </div>
          <h2 className="text-5xl md:text-6xl font-black tracking-tight">
            AI Inference
            <br />
            <span className="bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">Made Simple</span>
          </h2>
          <p className="mt-6 text-lg text-gray-400 max-w-xl mx-auto">
            Access powerful AI models through a single, OpenAI-compatible endpoint.
            No vendor lock-in. No complex setup. Just your API key.
          </p>
          <div className="mt-8 flex items-center justify-center gap-4">
            <Link href="/auth/login" className="rounded-xl bg-blue-600 px-8 py-3 text-sm font-medium text-white hover:bg-blue-700 transition-colors shadow-lg shadow-blue-500/20">
              Start for Free
            </Link>
            <a href="#models" className="rounded-xl border border-gray-700 px-8 py-3 text-sm font-medium text-gray-300 hover:text-white hover:border-gray-600 transition-colors">
              View Models
            </a>
          </div>

          {/* Code Snippet */}
          <div className="mt-12 text-left bg-gray-900/80 rounded-xl border border-gray-800 p-4 font-mono text-xs text-gray-300 max-w-lg mx-auto overflow-x-auto">
            <p className="text-gray-500"># Works with any OpenAI SDK</p>
            <pre>{`from openai import OpenAI
client = OpenAI(
  base_url="https://akarouter-production.up.railway.app/v1",
  api_key="akar_your_key_here"
)
r = client.chat.completions.create(
  model="akarouter-pro",
  messages=[{"role":"user","content":"Hi"}]
)`}</pre>
          </div>
        </div>
      </main>

      {/* Models Section */}
      <section id="models" className="px-6 py-20 border-t border-gray-800/50">
        <div className="max-w-4xl mx-auto">
          <h3 className="text-2xl font-bold text-center mb-8">Available Models</h3>
          <div className="grid md:grid-cols-2 gap-6">
            <div className="rounded-xl border border-gray-800 bg-gray-800/50 p-6">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center text-blue-400 font-bold text-sm">Pro</div>
                <div>
                  <h4 className="font-semibold">akarouter-pro</h4>
                  <p className="text-xs text-gray-500">Step 3.7 Flash</p>
                </div>
              </div>
              <p className="text-sm text-gray-400">Fast inference for general tasks. Best for chat, Q&A, and code generation.</p>
            </div>
            <div className="rounded-xl border border-gray-800 bg-gray-800/50 p-6">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center text-purple-400 font-bold text-sm">⚡</div>
                <div>
                  <h4 className="font-semibold">akarouter-flash</h4>
                  <p className="text-xs text-gray-500">Nemotron 3 Ultra</p>
                </div>
              </div>
              <p className="text-sm text-gray-400">Ultra-fast responses. Optimized for low-latency, high-throughput workloads.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-6 py-6 border-t border-gray-800/50 text-center text-xs text-gray-600">
        © 2026 AkaRouter. All rights reserved.
      </footer>
    </div>
  )
}
