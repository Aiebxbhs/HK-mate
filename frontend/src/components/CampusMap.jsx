import { tr } from '../i18n'
const CAMPUS_MAP_URL = 'https://www.maps.hku.hk/'
// Official printed map (Version 25.2, April 2025), from the 2025 TPG handbook PDF.
const PRINTED_MAP = '/guide/hku-main-campus-map-2025.jpg'
const PRINTED_MAP_PDF =
  'https://handbook.hku.hk/tpg/pdf/2025/Appendices_P.%20Map%20of%20the%20Main%20Campus.pdf'

/** The official HKU Campus Map, embedded so students can search buildings themselves. */
export default function CampusMap() {
  return (
    <section className="campus-map" aria-label="HKU Campus Map">
      <header className="guide-visual-head">
        <h2>HKU Campus Map</h2>
        <p>
          {tr(
            '港大官方校园地图，可搜索建筑、院系和设施；地图内容由港大提供。',
            'The official HKU campus map: search buildings, faculties and facilities. Map content is provided by HKU.',
          )}
        </p>
      </header>
      <figure className="campus-map-image">
        <a href={PRINTED_MAP} target="_blank" rel="noopener noreferrer">
          <img
            src={PRINTED_MAP}
            alt={tr(
              '港大主校园平面图（Version 25.2，2025 年 4 月），按编号标出各建筑、University Street、West Gate、East Gate 和 HKU Station',
              'HKU Main Campus map (Version 25.2, April 2025), with numbered buildings, University Street, West Gate, East Gate and HKU Station',
            )}
            loading="lazy"
          />
        </a>
        <figcaption>
          {tr(
            '港大官方主校园平面图（Version 25.2，2025 年 4 月，取自研究生手册），点击可看大图；',
            'Official HKU Main Campus map (Version 25.2, April 2025, from the postgraduate handbook). Click to enlarge; ',
          )}
          <a href={PRINTED_MAP_PDF} target="_blank" rel="noopener noreferrer">
            {tr('官方 PDF ↗', 'official PDF ↗')}
          </a>
          {tr(
            '。之后新建或改名的建筑以下方的在线地图为准。',
            '. For buildings added or renamed since, use the online map below.',
          )}
        </figcaption>
      </figure>
      <iframe
        className="campus-map-frame"
        src={CAMPUS_MAP_URL}
        title={tr('HKU Campus Map（港大官方校园地图）', 'HKU Campus Map (official)')}
        loading="lazy"
        referrerPolicy="no-referrer"
      />
      <a href={CAMPUS_MAP_URL} target="_blank" rel="noopener noreferrer">
        {tr('在新窗口打开 HKU Campus Map ↗', 'Open HKU Campus Map in a new window ↗')}
      </a>
    </section>
  )
}
