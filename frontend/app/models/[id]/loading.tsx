import { Loader2 } from 'lucide-react'

export default function ModelDetailLoading() {
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="text-center">
        <Loader2 className="w-6 h-6 text-red-500 animate-spin mx-auto mb-2" />
        <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">
          Loading model…
        </p>
      </div>
    </div>
  )
}
