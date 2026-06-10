import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getGatewayUrl(): string {
  let url = process.env.NEXT_PUBLIC_API_URL
  if (!url) {
    if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
      url = 'http://localhost:8000'
    } else {
      url = 'https://akarouter-production.up.railway.app'
    }
  }
  return url.replace(/\/+$/, '')
}
