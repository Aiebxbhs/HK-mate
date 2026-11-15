/**
 * Grey placeholder blocks shown while content loads. Screen readers hear only the label.
 * variant "list": card rows (lists of mail, events, records); "text": paragraph lines.
 */
export default function Skeleton({ label, rows = 3, variant = 'list' }) {
  return (
    <div className={`skeleton skeleton-${variant}`} role="status" aria-busy="true">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) =>
        variant === 'text' ? (
          <span key={index} className="skeleton-block skeleton-line" aria-hidden="true" />
        ) : (
          <div key={index} className="skeleton-row" aria-hidden="true">
            <span className="skeleton-block skeleton-title" />
            <span className="skeleton-block skeleton-line" />
          </div>
        ),
      )}
    </div>
  )
}
