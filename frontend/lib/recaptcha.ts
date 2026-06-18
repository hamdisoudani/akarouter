/**
 * reCAPTCHA v2 (interactive "I am not a robot" checkbox) — client-side
 * manager.
 *
 * Why v2 checkbox instead of v3 invisible:
 *   - v3 runs invisibly on every page load, scoring the user 0.0-1.0
 *     without their knowledge. It's frictionless UX but adds noise to
 *     the user's browser without any opt-in.
 *   - v2 shows a visible "I am not a robot" checkbox the user must
 *     click before the form submits. Standard pattern on the modern
 *     web, transparent to the user, and the per-form token is bound
 *     to the explicit interaction.
 *   - For protected forms (account activation, key generation,
 *     admin actions) the small UX cost is worth the explicit consent
 *     and clearer audit trail.
 *
 * The backend uses the same verification endpoint — just the
 * client-side capture mechanism changes. The server-side code that
 * calls Google's /siteverify endpoint is unchanged.
 */

declare global {
  interface Window {
    grecaptcha?: {
      ready: (cb: () => void) => void
      execute: (siteKey: string, options: { action: string }) => Promise<string>
      render: (
        container: string | HTMLElement,
        params: {
          sitekey: string
          callback?: (token: string) => void
          'expired-callback'?: () => void
          'error-callback'?: () => void
          theme?: 'light' | 'dark'
          size?: 'normal' | 'compact'
          tabindex?: number
        },
      ) => number
      reset: (widgetId?: number) => void
      getResponse: (widgetId?: number) => string
    }
    // Set by the loading script. Identifies that the v2 API JS has
    // loaded (the global `grecaptcha` object only appears AFTER
    // grecaptcha.ready fires).
    __akarouterRecaptchaLoaded?: boolean
    __akarouterRecaptchaLoadedV3?: boolean
    __akarouterRecaptchaLoading?: Promise<void>
    __akarouterRecaptchaLoadingV3?: Promise<void>
  }
}

const V2_SCRIPT_SRC = 'https://www.google.com/recaptcha/api.js'
// v3 REQUIRES the render= query param to associate the load with the
// site key, otherwise grecaptcha.execute() will fail with 'Invalid
// site key' even when the script itself loaded successfully.
const v3ScriptSrc = (siteKey: string) =>
  `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(siteKey)}`

/**
 * Load the reCAPTCHA v2 script once. Subsequent calls return the
 * same promise (singleton). The script tag uses `async defer` so it
 * never blocks page render.
 */
export function loadRecaptchaScript(siteKey: string): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('reCAPTCHA can only load in the browser'))
  }
  if (window.__akarouterRecaptchaLoaded) {
    return Promise.resolve()
  }
  if (window.__akarouterRecaptchaLoading) {
    return window.__akarouterRecaptchaLoading
  }

  window.__akarouterRecaptchaLoading = new Promise<void>((resolve, reject) => {
    // The v2 API uses `onload=grecaptchaReady` callback rather than
    // a global `grecaptcha` we can poll.
    ;(window as unknown as { grecaptchaReady?: () => void }).grecaptchaReady = () => {
      window.__akarouterRecaptchaLoaded = true
      resolve()
    }
    const script = document.createElement('script')
    script.src = V2_SCRIPT_SRC
    script.async = true
    script.defer = true
    script.onerror = () => reject(new Error('Failed to load reCAPTCHA script'))
    document.head.appendChild(script)
  })
  return window.__akarouterRecaptchaLoading
}

/**
 * Load the reCAPTCHA v3 script with the site key bound to the load
 * (required for v3). Returns a singleton promise per page.
 */
export function loadRecaptchaScriptV3(siteKey: string): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('reCAPTCHA can only load in the browser'))
  }
  if (window.__akarouterRecaptchaLoadedV3) {
    return Promise.resolve()
  }
  if (window.__akarouterRecaptchaLoadingV3) {
    return window.__akarouterRecaptchaLoadingV3
  }

  window.__akarouterRecaptchaLoadingV3 = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = v3ScriptSrc(siteKey)
    script.async = true
    script.defer = true
    script.onload = () => {
      window.__akarouterRecaptchaLoadedV3 = true
      resolve()
    }
    script.onerror = () =>
      reject(new Error('Failed to load reCAPTCHA v3 script'))
    document.head.appendChild(script)
  })
  return window.__akarouterRecaptchaLoadingV3
}

/**
 * Render a reCAPTCHA v2 widget into a DOM container.
 *
 * Returns a widgetId that can be used with `resetWidget` and
 * `getWidgetResponse`. The callback is invoked when the user solves
 * the challenge (clicks the checkbox and, if prompted, picks the
 * matching images).
 */
export async function renderRecaptchaWidget(
  container: HTMLElement,
  siteKey: string,
  options: {
    onSolve: (token: string) => void
    onExpire?: () => void
    onError?: () => void
    theme?: 'light' | 'dark'
    size?: 'normal' | 'compact'
  },
): Promise<number> {
  await loadRecaptchaScript(siteKey)
  if (!window.grecaptcha) {
    throw new Error('reCAPTCHA script loaded but grecaptcha is missing')
  }
  return window.grecaptcha.render(container, {
    sitekey: siteKey,
    callback: options.onSolve,
    'expired-callback': options.onExpire,
    'error-callback': options.onError,
    theme: options.theme ?? 'dark',
    size: options.size ?? 'normal',
  })
}

/** Reset the widget so the user must re-solve the challenge. */
export function resetRecaptchaWidget(widgetId: number): void {
  window.grecaptcha?.reset(widgetId)
}

/** Return the current response token, or empty string if not solved. */
export function getRecaptchaResponse(widgetId: number): string {
  return window.grecaptcha?.getResponse(widgetId) ?? ''
}