import { Terminal } from 'lucide-react'
import { LegalLayout, LegalSection } from '@/components/LegalLayout'

/**
 * Server Component. No interactivity, no client JS.
 */
export const metadata = {
  title: 'Terms of Service — AkaRouter',
  description: 'AkaRouter terms of service: rules for using the API gateway, key licensing, and usage limits.',
}

export default function TermsOfService() {
  return (
    <LegalLayout
      icon={<Terminal className="w-6 h-6 text-[#ef4444]" />}
      title="Terms of Service"
      documentRef="AR_TOS_v1.0"
    >
      <LegalSection index={1} title="Acceptance of Terms">
        By accessing the AkaRouter API Gateway platform, routing networks, and interface utilities, you agree to comply with and be bound by these Terms of Service. If you do not accept these terms in their entirety, you are prohibited from utilizing the services.
      </LegalSection>
      <LegalSection index={2} title="Gateway & Node API Utilization">
        AkaRouter grants you a limited, non-exclusive, non-transferable license to access AI routing services via authorized API keys. All keys generated remain the property of AkaRouter and may be degraded, suspended, or revoked by the system administrator under suspicion of service misuse.
      </LegalSection>
      <LegalSection index={3} title="Token Budgets & Sliding Window Quotas">
        Standard usage is regulated by token consumption windows ($ 5-hour, $ 7-day, and $ monthly budget limits). System resource allocations are evaluated dynamically. Exceeding assigned limits will return a HTTP 429 rate/budget limit exception. Request counts are preserved solely for performance matrix analytics.
      </LegalSection>
      <LegalSection index={4} title="Fair Use & Suspensions">
        Users must not engage in any activity that overloads the routing latency arrays, attempts brute-force token generation, or circumvents the 60 RPM rate limit rules. AkaRouter reserves the right to suspend or ban account nodes with or without prior notice under terms violation.
      </LegalSection>
      <LegalSection index={5} title="Disclaimer of Warranties">
        AkaRouter services are provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;. We offer no warranties concerning gateway uptime, models output correctness, or prompt latency times. Upstream connection states are beyond local latency guarantees.
      </LegalSection>
    </LegalLayout>
  )
}