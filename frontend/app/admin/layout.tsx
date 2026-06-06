'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const links = [
  { href: '/admin/providers', label: 'Providers', icon: '⚡' },
  { href: '/dashboard', label: 'User Dashboard', icon: '💬' },
  { href: '/', label: 'Landing', icon: '🏠' },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <div className="min-h-screen bg-black text-white">
      <aside className="fixed left-0 top-0 bottom-0 w-56 border-r border-white/10 bg-black/80 backdrop-blur-xl p-4 z-50">
        <Link href="/admin/providers" className="block mb-6">
          <div className="text-lg font-bold tracking-tight">AKAROUTER</div>
          <div className="text-[10px] text-zinc-500 font-medium tracking-wider uppercase">Admin</div>
        </Link>
        <nav className="space-y-1">
          {links.map(link => {
            const active = pathname === link.href || (link.href !== '/' && pathname.startsWith(link.href))
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                  active ? 'bg-white/10 text-white' : 'text-zinc-400 hover:bg-white/5 hover:text-white'
                }`}
              >
                <span>{link.icon}</span>
                <span>{link.label}</span>
              </Link>
            )
          })}
        </nav>
      </aside>
      <main className="ml-56">{children}</main>
    </div>
  )
}
