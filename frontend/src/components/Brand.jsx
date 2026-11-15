/** The HK Mate wordmark: a serif name whose full stop is a small warm orb. */
export function Wordmark() {
  return (
    <span className="wordmark">
      HK Mate
      <span className="wordmark-orb" aria-hidden="true" />
    </span>
  )
}

export default function Brand() {
  return (
    <a className="brand" href="/" aria-label="HK Mate 首页">
      <Wordmark />
    </a>
  )
}
