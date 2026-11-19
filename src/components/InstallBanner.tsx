import { useState } from 'react'
import { getPref, setPref } from '../lib/session'

export function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

export function isStandalone(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
}

/**
 * iPhone in Safari (not installed): how to add the app to the Home Screen.
 * iOS keeps the installed app's storage separate from Safari, so people should
 * onboard inside the installed app — and notifications only work there.
 */
export function InstallBanner() {
  const [hidden, setHidden] = useState(() => getPref('installDismissed', false))
  if (hidden || !isIOS() || isStandalone()) return null
  return (
    <div className="mx-4 mt-3 rounded-xl border border-line bg-alt px-4 py-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <strong>Install All Around Cricket</strong>
          <p className="mt-1 text-muted">
            Tap <span aria-label="Share">Share ⬆️</span> → <strong>Add to Home Screen</strong>, then open the app from your Home Screen and set it up there. Notifications need the Home Screen
            app.
          </p>
        </div>
        <button
          className="-mr-2 -mt-2 flex h-11 w-11 shrink-0 items-center justify-center text-muted"
          aria-label="Dismiss"
          onClick={() => {
            setPref('installDismissed', true)
            setHidden(true)
          }}
        >
          ✕
        </button>
      </div>
    </div>
  )
}
