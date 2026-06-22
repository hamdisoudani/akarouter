'use client'

/**
 * Product Hunt "Featured" badge.
 *
 * Displayed in the top-of-page sticky banner on the marketing site so
 * that visitors immediately see social proof that AkaRouter was
 * featured on Product Hunt.
 *
 * Props:
 *   - postId:  the PH post ID (we currently use 1178076 for AkaRouter)
 *   - theme:   "light" | "dark" — match the site's current theme so
 *              the badge fits the chrome
 *   - placement: "banner" = full-width row above nav; "inline" =
 *                centered row that sits inside the hero on /
 *
 * The badge SVG is fetched from api.producthunt.com (image/svg+xml).
 * We render it as a plain <img> inside an <a> that opens the post in
 * a new tab. The original PH-provided markup uses <a><img></a> with
 * target="_blank" rel="noopener noreferrer", which is what we keep
 * here verbatim so PH's click tracking still works.
 *
 * PH's official snippet wraps the SVG in an <a>. We lift that into
 * a reusable component because we render the same badge in multiple
 * spots (sticky banner + hero CTA row).
 *
 * Sizing: the default SVG is 250x54. We let it scale with CSS so it
 * fits both the small sticky banner (height ~36px) and the hero
 * "inline" placement (height ~54px). Width auto, height set per
 * variant.
 */

import { useEffect, useState } from 'react'

type Theme = 'light' | 'dark'
type Placement = 'banner' | 'inline'

interface Props {
  postId?: string
  theme?: Theme
  placement?: Placement
  className?: string
}

const DEFAULT_POST_ID = '1178076'
// The t= cache-buster comes from PH's official snippet. We leave it
// as a constant here so the URL stays stable across renders — when PH
// updates their snippet they also bump t.
const T_CACHE_BUSTER = '1782146525492'

export function ProductHuntBadge({
  postId = DEFAULT_POST_ID,
  theme = 'light',
  placement = 'banner',
  className = '',
}: Props) {
  const [resolvedTheme, setResolvedTheme] = useState<Theme>(theme)

  // Honor the user's system / explicit theme when placement === 'banner'
  // so the badge matches the rest of the chrome (dark mode site → dark
  // badge). The 'inline' placement is always light because the hero
  // area is light-on-dark by design.
  useEffect(() => {
    if (placement !== 'banner') return
    const root = document.documentElement
    const obs = new MutationObserver(() => {
      setResolvedTheme(root.classList.contains('dark') ? 'dark' : 'light')
    })
    obs.observe(root, { attributes: true, attributeFilter: ['class'] })
    setResolvedTheme(root.classList.contains('dark') ? 'dark' : 'light')
    return () => obs.disconnect()
  }, [placement])

  const badgeUrl = `https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=${postId}&theme=${resolvedTheme}&t=${T_CACHE_BUSTER}`
  const linkUrl = `https://www.producthunt.com/products/akarouter?embed=true&utm_source=badge-featured&utm_medium=badge&utm_campaign=badge-akarouter`

  // 'banner' = small, fits inside the ~40px tall ribbon. 'inline' =
  // larger, sits next to the hero CTA.
  const sizeClass =
    placement === 'banner'
      ? 'h-9 w-auto'
      : 'h-[54px] w-[250px]'

  return (
    <a
      href={linkUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="AkaRouter on Product Hunt"
      className={`inline-flex items-center hover:opacity-90 transition-opacity ${className}`}
    >
      <img
        src={badgeUrl}
        alt="AkaRouter - Pay per request. Not per token. 11 frontier models. | Product Hunt"
        width={placement === 'banner' ? 250 : 250}
        height={placement === 'banner' ? 36 : 54}
        className={sizeClass}
      />
    </a>
  )
}