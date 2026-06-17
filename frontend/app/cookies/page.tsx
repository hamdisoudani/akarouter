import { Terminal } from 'lucide-react'
import { LegalLayout, LegalSection } from '@/components/LegalLayout'

/**
 * Server Component. No interactivity, no client JS.
 */
export const metadata = {
  title: 'Cookie Policy — AkaRouter',
  description: 'AkaRouter cookie policy: what cookies we use and why.',
}

export default function CookiePolicy() {
  return (
    <LegalLayout
      icon={<Terminal className="w-6 h-6 text-[#ef4444]" />}
      title="Cookie Policy"
      documentRef="AR_COOK_v1.0"
    >
      <LegalSection index={1} title="What Are Cookies?">
        Cookies are small raw text tokens stored locally on your device by your browser. They are utilized to store session variables, authenticate account status, and preserve system settings preferences between client visits.
      </LegalSection>
      <LegalSection index={2} title="Essential System Cookies">
        AkaRouter uses essential session cookies managed directly by Supabase Auth to establish and verify your logged-in session status. Disabling these cookies in your browser settings will prevent you from accessing the developer dashboard, telemetry views, and keys configurations.
      </LegalSection>
      <LegalSection index={3} title="Analytics and Preferences">
        We do not deploy any non-essential tracking cookies, advertising arrays, or third-party marketing tags on AkaRouter. All interface parameters are resolved locally without persistent cross-site tracking markers.
      </LegalSection>
    </LegalLayout>
  )
}