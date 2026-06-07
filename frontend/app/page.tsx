import Link from 'next/link'

export default function Home() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white flex flex-col">
      {/* Nav */}
      <nav className="px-6 py-5">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
              </svg>
            </div>
            <span className="text-base font-bold tracking-tight">AkaRouter</span>
          </div>
          <Link
            href="/auth/login"
            className="rounded-xl bg-white text-[#0a0a0f] px-5 py-2 text-sm font-semibold hover:bg-zinc-200 active:scale-[0.98] transition-all"
          >
            Sign in
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <main className="flex-1 flex items-center justify-center px-6 py-16">
        <div className="max-w-2xl text-center">
          <div className="inline-flex items-center gap-2 mb-6 px-4 py-1.5 rounded-full bg-violet-500/10 border border-violet-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
            <span className="text-xs font-medium text-violet-400">OpenAI-Compatible API</span>
          </div>

          <h1 className="text-5xl md:text-6xl font-black tracking-tight leading-[1.1]">
            One API key.
            <br />
            <span className="bg-gradient-to-r from-violet-400 via-blue-400 to-cyan-400 bg-clip-text text-transparent">
              Every model.
            </span>
          </h1>

          <p className="mt-5 text-lg text-zinc-400 max-w-lg mx-auto leading-relaxed">
            Access powerful AI models through a single, OpenAI-compatible endpoint.
            No vendor lock-in. Just your key.
          </p>

          <div className="mt-8 flex items-center justify-center gap-3">
            <Link
              href="/auth/login"
              className="rounded-xl bg-violet-600 px-7 py-3 text-sm font-semibold text-white hover:bg-violet-500 active:scale-[0.98] transition-all shadow-lg shadow-violet-500/20"
            >
              Get Started Free
            </Link>
            <a
              href="#models"
              className="rounded-xl border border-zinc-800 px-7 py-3 text-sm font-medium text-zinc-400 hover:text-white hover:border-zinc-700 transition-all"
            >
              See Models
            </a>
          </div>

          {/* Code Snippet */}
          <div className="mt-14 text-left bg-[#12121a] rounded-2xl border border-zinc-800/60 p-5 max-w-md mx-auto overflow-x-auto">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-3 h-3 rounded-full bg-red-500/60" />
              <div className="w-3 h-3 rounded-full bg-yellow-500/60" />
              <div className="w-3 h-3 rounded-full bg-green-500/60" />
              <span className="text-[10px] text-zinc-600 ml-2 font-mono">quickstart.py</span>
            </div>
            <pre className="text-xs text-zinc-400 font-mono leading-relaxed">{`from openai import OpenAI

client = OpenAI(
  base_url="https://akarouter.production/v1",
  api_key="akar_your_key_here"
)

r = client.chat.completions.create(
  model="akarouter-pro",
  messages=[{"role":"user",
             "content":"Hello!"}]
)`}</pre>
          </div>
        </div>
      </main>

      {/* Models */}
      <section id="models" className="px-6 py-20 border-t border-zinc-800/40">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-10">Two models. Zero hassle.</h2>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="p-6 rounded-2xl bg-[#12121a] border border-zinc-800/60 hover:border-violet-500/30 transition-colors group">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-violet-500/20 flex items-center justify-center text-violet-400 font-bold text-sm group-hover:scale-110 transition-transform">
                  P
                </div>
                <div>
                  <h3 className="font-semibold text-white">akarouter-pro</h3>
                  <p className="text-xs text-zinc-600">Step 3.7 Flash</p>
                </div>
              </div>
              <p className="text-sm text-zinc-500 leading-relaxed">Fast inference for general tasks — chat, Q&A, code generation, and reasoning.</p>
            </div>
            <div className="p-6 rounded-2xl bg-[#12121a] border border-zinc-800/60 hover:border-blue-500/30 transition-colors group">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center text-blue-400 font-bold text-sm group-hover:scale-110 transition-transform">
                  ⚡
                </div>
                <div>
                  <h3 className="font-semibold text-white">akarouter-flash</h3>
                  <p className="text-xs text-zinc-600">Nemotron 3 Ultra</p>
                </div>
              </div>
              <p className="text-sm text-zinc-500 leading-relaxed">Ultra-fast responses. Optimized for low-latency, high-throughput workloads.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-6 py-8 border-t border-zinc-800/40 text-center text-xs text-zinc-700">
        © 2026 AkaRouter
      </footer>
    </div>
  )
}
