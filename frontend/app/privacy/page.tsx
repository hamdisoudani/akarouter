import { Shield } from 'lucide-react'
import { LegalLayout, LegalSection } from '@/components/LegalLayout'

/**
 * Server Component. No interactivity, no client JS.
 * Fully indexable by search engines.
 */
export const metadata = {
  title: 'Privacy Policy — AkaRouter',
  description: 'AkaRouter privacy policy: what data we collect, how we use it, and how we protect it.',
}

export default function PrivacyPolicy() {
  return (
    <LegalLayout
      icon={<Shield className="w-6 h-6 text-[#ef4444]" />}
      title="Privacy Policy"
      documentRef="AR_PRIV_v1.0"
    >
      <LegalSection index={1} title="Information We Collect">
        AkaRouter registers basic authentication metadata provided during OAuth registration (e.g. email, display name) to manage service authentication, keys authorization, and billing tier presets. We collect and log latency metrics, model routing logs, status codes, and input/output token counts to construct live performance matrix analytics.
      </LegalSection>
      <LegalSection index={2} title="Use of Data">
        Collected telemetry is utilized strictly to provide, maintain, and optimize AkaRouter. Token analytics are evaluated in real-time to compute sliding window budget consumption and enforce tier limits. Detailed latency metrics are rendered on the developer board for traffic statistics.
      </LegalSection>
      <LegalSection index={3} title="Request Payload Processing">
        Completions request payloads (messages arrays and parameters) are proxy-forwarded directly to authorized upstream model providers through the AkaRouter routing layer. AkaRouter does not inspect, read, or store the contents of completion request prompts or generated output responses once returned.
      </LegalSection>
      <LegalSection index={4} title="Telemetry Storage">
        System session logs, latency times, and token totals are securely stored in our analytical databases managed by Supabase. Historical trace buffer records are periodically pruned to ensure system efficiency and data hygiene.
      </LegalSection>
    </LegalLayout>
  )
}