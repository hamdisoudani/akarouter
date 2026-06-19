"use client"

import * as React from "react"
import { Monitor, Moon, Sun, Check } from "lucide-react"
import { useTheme } from "next-themes"

/**
 * Premium 3-state theme toggle.
 *
 * Why a dropdown (not a 2-state button):
 *   - The user can explicitly choose "System" (follows OS) or override
 *     with Light/Dark. A 2-state button can't represent 3 modes.
 *   - The icon shows the CURRENT resolved theme, not the action it would
 *     perform — clearer feedback (Linear / Vercel pattern).
 *
 * Icons (lucide-react):
 *   - system → Monitor (rectangle with stand)
 *   - light  → Sun
 *   - dark   → Moon
 *
 * Accessibility:
 *   - sr-only <span> announces the action
 *   - role="menu" / role="menuitem" for screen readers
 *   - keyboard: Escape closes, Tab cycles items
 *   - click-outside closes
 */
export function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme()
  const [open, setOpen] = React.useState(false)
  const [mounted, setMounted] = React.useState(false)
  const containerRef = React.useRef<HTMLDivElement>(null)

  // Avoid hydration mismatch: next-themes reads localStorage on mount
  // and the server has no way to know the user's preference.
  React.useEffect(() => setMounted(true), [])

  // Click-outside to close
  React.useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  // What to render: theme = "system" means we should show the resolved value's icon
  // for the button itself, and mark "system" as active in the dropdown.
  const activeTheme = theme ?? "system"
  const buttonIconKey =
    activeTheme === "system" ? "system" : activeTheme === "dark" ? "dark" : "light"

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label="Toggle theme"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-md border border-zinc-200 dark:border-zinc-800 bg-transparent text-zinc-500 hover:text-zinc-900 hover:border-zinc-400 dark:text-zinc-400 dark:hover:text-white dark:hover:border-zinc-600 transition-colors"
      >
        {/* Mounted gate: render the right icon only after hydration */}
        {mounted ? (
          <>
            <Sun
              className={`h-4 w-4 transition-all duration-200 ${
                buttonIconKey === "light"
                  ? "rotate-0 scale-100 opacity-100"
                  : "rotate-90 scale-0 opacity-0 absolute"
              }`}
            />
            <Moon
              className={`h-4 w-4 transition-all duration-200 ${
                buttonIconKey === "dark"
                  ? "rotate-0 scale-100 opacity-100"
                  : "-rotate-90 scale-0 opacity-0 absolute"
              }`}
            />
            <Monitor
              className={`h-4 w-4 transition-all duration-200 ${
                buttonIconKey === "system"
                  ? "rotate-0 scale-100 opacity-100"
                  : "rotate-90 scale-0 opacity-0 absolute"
              }`}
            />
          </>
        ) : (
          // Skeleton icon during SSR / pre-hydration
          <Monitor className="h-4 w-4 opacity-50" />
        )}
        <span className="sr-only">Toggle theme</span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Theme selection"
          className="absolute right-0 mt-2 w-44 origin-top-right rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-lg shadow-zinc-900/5 dark:shadow-black/40 z-50 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150"
        >
          <div className="p-1">
            <ThemeMenuItem
              icon={<Monitor className="h-3.5 w-3.5" />}
              label="System"
              hint="Follow OS"
              active={activeTheme === "system"}
              onClick={() => {
                setTheme("system")
                setOpen(false)
              }}
            />
            <ThemeMenuItem
              icon={<Sun className="h-3.5 w-3.5" />}
              label="Light"
              active={activeTheme === "light"}
              onClick={() => {
                setTheme("light")
                setOpen(false)
              }}
            />
            <ThemeMenuItem
              icon={<Moon className="h-3.5 w-3.5" />}
              label="Dark"
              active={activeTheme === "dark"}
              onClick={() => {
                setTheme("dark")
                setOpen(false)
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function ThemeMenuItem({
  icon,
  label,
  hint,
  active,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  hint?: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 text-xs font-mono uppercase tracking-wider transition-colors ${
        active
          ? "text-zinc-900 dark:text-white bg-zinc-100 dark:bg-zinc-900"
          : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
      }`}
    >
      <span className={active ? "text-[#ef4444]" : ""}>{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {hint && (
        <span className="text-[9px] text-zinc-400 dark:text-zinc-600 normal-case tracking-normal">
          {hint}
        </span>
      )}
      {active && <Check className="h-3 w-3 text-[#ef4444]" />}
    </button>
  )
}
