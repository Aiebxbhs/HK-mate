import { useState } from 'react'

// Isometric (2.5D) stack of Main Library floors, drawn as plain SVG: no 3D library needed.
const COS = Math.cos(Math.PI / 6)
const SIN = Math.sin(Math.PI / 6)
const WIDTH = 200 // along x: Old Wing (left half) and New Wing (right half)
const DEPTH = 84
const SLAB = 9
const GAP = 46
const ORIGIN = { x: 165, y: 92 }

function project(x, y, z) {
  return [ORIGIN.x + (x - y) * COS, ORIGIN.y + (x + y) * SIN - z]
}

function face(points) {
  return points.map((point) => project(...point).join(',')).join(' ')
}

function box(x0, x1, z) {
  const top = z + SLAB
  return {
    top: face([
      [x0, 0, top],
      [x1, 0, top],
      [x1, DEPTH, top],
      [x0, DEPTH, top],
    ]),
    front: face([
      [x0, DEPTH, top],
      [x1, DEPTH, top],
      [x1, DEPTH, z],
      [x0, DEPTH, z],
    ]),
    side: face([
      [x1, 0, top],
      [x1, DEPTH, top],
      [x1, DEPTH, z],
      [x1, 0, z],
    ]),
  }
}

export const FILTERS = [
  {
    id: 'colour',
    label: '彩色打印',
    match: (floor) =>
      floor.printers.filter((p) => p.print_mode === 'colour' || p.copy_mode === 'colour'),
  },
  {
    id: 'scan',
    label: '扫描',
    match: (floor) => [
      ...floor.printers.filter((p) => p.scan),
      ...floor.spots.filter((s) => s.text.includes('扫描')),
    ],
  },
  {
    id: 'study',
    label: '自习空间',
    match: (floor) => floor.spots.filter((s) => s.kind === 'study'),
  },
  {
    id: 'service',
    label: '服务台',
    match: (floor) => floor.spots.filter((s) => s.kind === 'service'),
  },
  {
    id: 'tech',
    label: '电脑与设备',
    match: (floor) => floor.spots.filter((s) => s.kind === 'tech'),
  },
]

const KIND_LABELS = { study: '自习', service: '服务', tech: '设备', collection: '馆藏' }

function printerFeatures(printer) {
  const parts = [printer.print_mode === 'colour' ? '彩色打印' : '黑白打印']
  if (printer.copy_mode) parts.push(printer.copy_mode === 'colour' ? '彩色复印' : '黑白复印')
  if (printer.wifi) parts.push('Wi-Fi 打印')
  if (printer.scan) parts.push('扫描到邮箱')
  return parts.join('、')
}

/** Main Library floors from the verified official data (top floor first). */
export default function LibraryFloors({ library }) {
  // Floors arrive top floor first; draw from the ground up.
  const floors = library.floors
  const [selectedId, setSelectedId] = useState(floors[floors.length - 1]?.id)
  const [filterId, setFilterId] = useState('')
  const filter = FILTERS.find((item) => item.id === filterId)
  const matches = new Map(floors.map((floor) => [floor.id, filter ? filter.match(floor) : []]))
  const selected = floors.find((floor) => floor.id === selectedId) || floors[0]
  const selectedMatches = new Set(matches.get(selected.id))

  function chooseFilter(id) {
    const next = id === filterId ? '' : id
    setFilterId(next)
    const nextFilter = FILTERS.find((item) => item.id === next)
    if (nextFilter && !nextFilter.match(selected).length) {
      const first = [...floors].reverse().find((floor) => nextFilter.match(floor).length)
      if (first) setSelectedId(first.id)
    }
  }

  const height = ORIGIN.y + (WIDTH + DEPTH) * SIN + SLAB + 12
  const stackTop = (floors.length - 1) * GAP
  const viewTop = ORIGIN.y - stackTop - SLAB - 16

  return (
    <section className="library-floors" aria-label={`${library.name} 逐层设施`}>
      <header className="guide-visual-head">
        <h2>{library.name} 逐层设施</h2>
        <p>{library.intro}</p>
      </header>

      <div className="library-filters" role="group" aria-label="按设施筛选楼层">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            className="guide-chip"
            aria-pressed={item.id === filterId}
            onClick={() => chooseFilter(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="library-layout">
        <div className="library-stack">
          <svg
            viewBox={`0 ${viewTop} 345 ${height - viewTop}`}
            className="library-svg"
            aria-hidden="true"
          >
            {[...floors].reverse().map((floor, index) => {
              const z = index * GAP
              const active = floor.id === selected.id
              const lit = filter && matches.get(floor.id).length > 0
              const dim = filter && !lit
              const lift = active ? 6 : 0
              const oldWing = floor.wings.includes('Old Wing')
              const newWing = floor.wings.includes('New Wing')
              const parts = [
                oldWing && { key: 'old', ...box(0, WIDTH / 2, z + lift) },
                newWing && { key: 'new', ...box(WIDTH / 2, WIDTH, z + lift) },
              ].filter(Boolean)
              const [labelX, labelY] = project(0, DEPTH, z + lift + SLAB / 2)
              return (
                <g
                  key={floor.id}
                  className={`floor-slab${active ? ' active' : ''}${lit ? ' lit' : ''}${dim ? ' dim' : ''}`}
                  onClick={() => setSelectedId(floor.id)}
                >
                  {parts.map((part) => (
                    <g key={part.key} className={`wing wing-${part.key}`}>
                      <polygon className="slab-top" points={part.top} />
                      <polygon className="slab-front" points={part.front} />
                      <polygon className="slab-side" points={part.side} />
                    </g>
                  ))}
                  <text x={labelX - 10} y={labelY + 4} textAnchor="end" className="slab-label">
                    {floor.label}
                  </text>
                </g>
              )
            })}
            {(() => {
              const [ox, oy] = project(WIDTH / 4, DEPTH, -14)
              const [nx, ny] = project((WIDTH * 3) / 4, DEPTH, -14)
              return (
                <>
                  <text x={ox} y={oy + 14} textAnchor="middle" className="wing-label">
                    Old Wing
                  </text>
                  <text x={nx} y={ny + 14} textAnchor="middle" className="wing-label">
                    New Wing
                  </text>
                </>
              )
            })()}
          </svg>
          <div className="library-floor-tabs" role="group" aria-label="选择楼层">
            {floors.map((floor) => (
              <button
                key={floor.id}
                type="button"
                className="guide-chip floor-tab"
                aria-pressed={floor.id === selected.id}
                data-lit={filter && matches.get(floor.id).length > 0 ? 'true' : undefined}
                onClick={() => setSelectedId(floor.id)}
              >
                {floor.label}
              </button>
            ))}
          </div>
        </div>

        <div
          className={`library-detail${['colour', 'scan'].includes(filterId) ? ' printers-first' : ''}`}
          aria-live="polite"
        >
          <h3>
            {selected.label}
            <span>{selected.wings.join('、')}</span>
          </h3>
          {filter && !selectedMatches.size && (
            <p className="library-detail-note">这一层没有“{filter.label}”。</p>
          )}
          <ul className="library-spots">
            {selected.spots.map((spot) => (
              <li key={spot.name} className={selectedMatches.has(spot) ? 'matched' : undefined}>
                <span className={`spot-kind spot-${spot.kind}`}>{KIND_LABELS[spot.kind]}</span>
                <div>
                  <strong>{spot.name}</strong>
                  {spot.wing && <small>{spot.wing}</small>}
                  <p>{spot.text}</p>
                </div>
              </li>
            ))}
          </ul>
          {selected.printers.length > 0 && (
            <div className="library-printers">
              <h4>uPrint 打印机 / 复印机</h4>
              <ul>
                {selected.printers.map((printer) => (
                  <li
                    key={printer.number}
                    className={selectedMatches.has(printer) ? 'matched' : undefined}
                  >
                    <span className="printer-number">{printer.number}</span>
                    <span className="printer-wing">{printer.wing}</span>
                    <span>{printerFeatures(printer)}</span>
                  </li>
                ))}
              </ul>
              <p className="library-detail-note">
                Wi-Fi 打印只支持连接名为“HKU”的网络；收费与充值方法见官网“Copy, Print, Scan”页面。
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
