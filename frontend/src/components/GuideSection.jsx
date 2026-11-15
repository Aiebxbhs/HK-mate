// One guide section. Its text has one line per paragraph or per fact ("- 标签：内容"),
// so short facts can be shown as labelled rows instead of one long paragraph.
const ROUTE_LIST = /^[0-9A-Z]{1,5}(、[0-9A-Z]{1,5})*$/

export function parseSection(text) {
  const blocks = []
  for (const line of text.split('\n')) {
    if (line.startsWith('- ')) {
      const item = line.slice(2)
      const cut = item.indexOf('：')
      const fact =
        cut > 0
          ? { label: item.slice(0, cut), value: item.slice(cut + 1) }
          : { label: '', value: item }
      const last = blocks[blocks.length - 1]
      if (last?.type === 'facts') last.facts.push(fact)
      else blocks.push({ type: 'facts', facts: [fact] })
    } else {
      blocks.push({ type: 'paragraph', text: line })
    }
  }
  return blocks
}

/** Sections with many facts or route numbers take the full row in the card grid. */
export function isWide(blocks) {
  const facts = blocks.flatMap((block) => (block.type === 'facts' ? block.facts : []))
  return facts.length > 5 || facts.some((fact) => ROUTE_LIST.test(fact.value))
}

function FactValue({ value }) {
  if (!ROUTE_LIST.test(value)) return <span className="guide-fact-value">{value}</span>
  return (
    <span className="guide-fact-value guide-routes">
      {value.split('、').map((route) => (
        <span key={route} className="guide-route">
          {route}
        </span>
      ))}
    </span>
  )
}

export default function GuideSection({ heading, blocks, wide = isWide(blocks) }) {
  const hasFacts = blocks.some((block) => block.type === 'facts')
  return (
    <section
      className={`agenda-card hku-guide-section${hasFacts ? ' has-facts' : ''}${
        wide ? ' wide' : ''
      }`}
    >
      <h2>{heading}</h2>
      {blocks.map((block, index) =>
        block.type === 'paragraph' ? (
          <p key={index}>{block.text}</p>
        ) : (
          <ul key={index} className="guide-facts">
            {block.facts.map((fact) => (
              <li key={fact.label + fact.value}>
                {fact.label && <span className="guide-fact-label">{fact.label}</span>}
                <FactValue value={fact.value} />
              </li>
            ))}
          </ul>
        ),
      )}
    </section>
  )
}

/** Which sections take a full row: the long ones, plus a half-width card that would
 * otherwise sit alone in its row. */
export function wideSections(parts) {
  const wide = parts.map((part) => isWide(part.blocks))
  let run = 0
  wide.forEach((isFull, index) => {
    if (!isFull) run += 1
    const endOfRun = isFull || index === wide.length - 1
    if (endOfRun && run % 2 === 1) wide[isFull ? index - 1 : index] = true
    if (isFull) run = 0
  })
  return wide
}
