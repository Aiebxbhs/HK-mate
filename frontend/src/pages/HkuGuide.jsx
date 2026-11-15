import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { KnowledgeCard } from '../components/AgentCards'
import CampusMap from '../components/CampusMap'
import GuideSection, { parseSection, wideSections } from '../components/GuideSection'
import LibraryFloors from '../components/LibraryFloors'
import Skeleton from '../components/Skeleton'

/** One category of the HKU guide (postgraduates), from verified official sources only. */
export default function HkuGuide({ category }) {
  const [guide, setGuide] = useState(null)
  const [places, setPlaces] = useState(null)
  const [error, setError] = useState('')
  // Only the library page has the floor view built from the verified places data.
  const visual = category === 'library'

  useEffect(() => {
    let active = true
    Promise.all([api.hkuGuide(), visual ? api.hkuPlaces() : null])
      .then(([value, placeData]) => {
        if (!active) return
        setGuide(value)
        setPlaces(placeData)
      })
      .catch((cause) => active && setError(cause.message))
    return () => {
      active = false
    }
  }, [visual])

  if (error)
    return (
      <p className="message error" role="alert">
        {error}
      </p>
    )
  if (!guide || (visual && !places))
    return <Skeleton label="正在读取 HKU 指南…" rows={6} variant="text" />
  const section = guide.categories.find((item) => item.id === category)
  const placeSources = places && (
    <KnowledgeCard
      card={{ type: 'knowledge', verified: places.verified, sources: places.sources }}
    />
  )
  return (
    <section className="hku-guide" aria-label={section?.title || 'HKU 指南'}>
      <p className="hku-guide-audience">以下内容针对{guide.audience}，整理自港大官方网站。</p>
      {places && <LibraryFloors library={places.library} />}
      {category === 'transport' && <CampusMap />}
      {placeSources}
      {section?.documents.length ? (
        section.documents.map((document) => {
          const parts = document.sections.map((part) => ({
            heading: part.heading,
            blocks: parseSection(part.text),
          }))
          // Documents written as short facts are laid out as a grid of cards.
          const cards = parts.some((part) => part.blocks.some((b) => b.type === 'facts'))
          // "rows" documents put every card on its own full row.
          const wide = document.layout === 'rows' ? parts.map(() => true) : wideSections(parts)
          return (
            <article
              key={document.title}
              className={`hku-guide-document${cards ? ' fact-cards' : ''}`}
            >
              {parts.map((part, index) => (
                <GuideSection
                  key={part.heading}
                  heading={part.heading}
                  blocks={part.blocks}
                  wide={wide[index]}
                />
              ))}
              <KnowledgeCard
                card={{
                  type: 'knowledge',
                  verified: document.verified,
                  sources: document.sources,
                }}
              />
            </article>
          )
        })
      ) : (
        <div className="agenda-card agenda-empty">
          <p>这一部分正在整理中，内容只会采用港大官方资料。</p>
        </div>
      )}
    </section>
  )
}
