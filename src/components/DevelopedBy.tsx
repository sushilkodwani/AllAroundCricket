// Credit line shown at the bottom of the sign-in screens and Settings.
export function DevelopedBy({ className = '' }: { className?: string }) {
  return (
    <div className={`text-center ${className}`}>
      <p className="text-xs text-muted">Developed By</p>
      <p className="text-sm font-semibold">KiaSoft Innovations</p>
    </div>
  )
}
