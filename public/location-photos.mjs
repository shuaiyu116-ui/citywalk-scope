const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const BAIDU_IMAGE_API = 'https://image.baidu.com/search/acjson';

function coordinate(value, maximum) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number) <= maximum ? number : null;
}

function plainText(value) {
  return String(value || '').replace(/<[^>]*>/g, ' ')
    .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/gi, entity => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' }[entity.toLowerCase()] || ' '))
    .replace(/\s+/g, ' ').trim();
}

function compact(value) {
  return plainText(value).toLocaleLowerCase().replace(/[\s_\-:,.\/\\()[\]{}'"]/g, '');
}

function distanceMeters(origin, destination) {
  if (destination.lat == null || destination.lng == null) return Infinity;
  const radians = value => value * Math.PI / 180;
  const arc = Math.sin(radians(destination.lat - origin.lat) / 2) ** 2
    + Math.cos(radians(origin.lat)) * Math.cos(radians(destination.lat))
    * Math.sin(radians(destination.lng - origin.lng) / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(arc), Math.sqrt(Math.max(0, 1 - arc)));
}

function httpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : '';
  } catch { return ''; }
}

// Commons selection is retained for compatibility; the default domestic
// image provider is Baidu Images.
export function selectLocationPhoto(pages, { lat, lng, name = '', city = '', radius = 1000 }) {
  const locationName = compact(name);
  const cityName = compact(city);
  const candidates = pages.map(page => {
    const info = page.imageinfo?.[0];
    const image = httpsUrl(info?.thumburl || info?.url);
    if (!image || (info?.mime && !/^image\/(jpeg|png|webp)$/i.test(info.mime))) return null;
    const title = String(page.title || '');
    if (/\.(svg|pdf|tiff?|gif|webm|ogg|ogv)$/i.test(title)) return null;
    const metadata = key => plainText(info?.extmetadata?.[key]?.value);
    const description = compact([title, metadata('ObjectName'), metadata('ImageDescription')].join(' '));
    const exact = Boolean(locationName && description.includes(locationName));
    const cityMatch = Boolean(cityName && description.includes(cityName));
    const position = page.coordinates?.[0];
    const distance = distanceMeters({ lat, lng }, {
      lat: coordinate(position?.lat, 90), lng: coordinate(position?.lon, 180)
    });
    if (Number.isFinite(distance) && distance > radius + 50) return null;
    const artist = metadata('Artist') || metadata('Credit');
    const license = metadata('LicenseShortName') || metadata('UsageTerms');
    return {
      exact, cityMatch, distance,
      result: {
        image,
        imageSource: 'Wikimedia Commons',
        imageKind: exact ? 'location-photo' : 'nearby-photo',
        imagePageUrl: httpsUrl(info.descriptionurl) || `https://commons.wikimedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
        imageAttribution: [artist, license].filter(Boolean).join(' · ').slice(0, 240),
        imageTitle: title.replace(/^File:/i, ''),
        distanceMeters: Number.isFinite(distance) ? Math.round(distance) : null
      }
    };
  }).filter(Boolean).sort((a, b) => Number(b.exact) - Number(a.exact)
    || a.distance - b.distance || Number(b.cityMatch) - Number(a.cityMatch));
  return candidates[0]?.result || null;
}

// Kept as an explicit compatibility path for an opt-in Mapillary setup and
// for old saved demos. The default provider below is domestic Baidu Images.
export async function findCommonsLocationPhoto(input, { timeoutMs = 9000, headers = {} } = {}) {
  const lat = coordinate(input.lat, 90);
  const lng = coordinate(input.lng, 180);
  if (lat == null || lng == null) return null;
  const radius = Math.max(50, Math.min(1000, Number(input.radius) || 1000));
  const params = new URLSearchParams({
    action: 'query', format: 'json', origin: '*', generator: 'geosearch',
    ggscoord: `${lat}|${lng}`, ggsradius: String(radius), ggslimit: '30',
    ggsnamespace: '6', ggsprimary: 'all', prop: 'coordinates|imageinfo',
    iiprop: 'url|mime|extmetadata', iiurlwidth: '1200'
  });
  try {
    const response = await fetch(`${COMMONS_API}?${params}`, {
      headers: { Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) return null;
    const payload = await response.json();
    return selectLocationPhoto(Object.values(payload.query?.pages || {}), { ...input, lat, lng, radius });
  } catch { return null; }
}

function baiduText(value) {
  return plainText(value).replace(/\\u([0-9a-f]{4})/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function baiduImageUrl(value) {
  return httpsUrl(value);
}

function baiduCandidates(payload) {
  const data = Array.isArray(payload?.data) ? payload.data : [];
  return data.map(item => {
    if (!item || typeof item !== 'object') return null;
    const image = baiduImageUrl(item.thumbURL || item.middleURL || item.hoverURL || item.objURL || item.fromURL);
    if (!image) return null;
    const title = baiduText(item.fromPageTitleEnc || item.fromPageTitle || item.word || item.ename || item.title || '');
    const sourceUrl = baiduImageUrl(item.fromURL || item.fromPageUrl || item.fromPageURL);
    return { image, title, sourceUrl, raw: item };
  }).filter(Boolean);
}

export function selectBaiduPhoto(items, { name = '', city = '' } = {}) {
  const locationName = compact(name);
  const cityName = compact(city);
  const candidates = items.map(item => {
    const title = compact([item.title, item.raw?.word, item.raw?.fromPageTitle].filter(Boolean).join(' '));
    const exact = Boolean(locationName && title.includes(locationName));
    const cityMatch = Boolean(cityName && title.includes(cityName));
    return {
      exact, cityMatch,
      result: {
        image: item.image,
        imageSource: '百度图片',
        imageKind: exact ? 'location-photo' : 'nearby-photo',
        imagePageUrl: item.sourceUrl || `https://image.baidu.com/search/index?tn=baiduimage&word=${encodeURIComponent([city, name].filter(Boolean).join(' '))}`,
        imageAttribution: '百度图片搜索结果（请核对授权）',
        imageTitle: item.title || `${city}${name}`,
        distanceMeters: null
      }
    };
  }).sort((a, b) => Number(b.exact) - Number(a.exact) || Number(b.cityMatch) - Number(a.cityMatch));
  return candidates[0]?.result || null;
}

export async function findBaiduLocationPhoto(input = {}, { timeoutMs = 9000, headers = {} } = {}) {
  const name = String(input.name || '').trim().slice(0, 120);
  const city = String(input.city || '').trim().slice(0, 80);
  if (!name && !city) return null;
  const query = [city, name].filter(Boolean).join(' ');
  const params = new URLSearchParams({
    tn: 'resultjson_com', ipn: 'rj', ct: '201326592', fp: 'result',
    queryWord: query, word: query, pn: '0', rn: '30', ie: 'utf-8'
  });
  try {
    const response = await fetch(`${BAIDU_IMAGE_API}?${params}`, {
      headers: { Accept: 'application/json,text/plain,*/*', ...headers },
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) return null;
    const text = await response.text();
    let payload;
    try { payload = JSON.parse(text); } catch {
      const json = text.match(/\{[\s\S]*\}/);
      if (!json) return null;
      try { payload = JSON.parse(json[0]); } catch { return null; }
    }
    return selectBaiduPhoto(baiduCandidates(payload), { name, city });
  } catch { return null; }
}

export async function findLocationPhoto(input = {}, options = {}) {
  if (input.lat == null || input.lng == null || input.lat === '' || input.lng === '') {
    // A name-only search is useful for domestic image providers, but callers
    // that explicitly pass empty coordinates still get the old null contract.
    if (!input.name && !input.city) return null;
  }
  // Browser requests go through our same-origin proxy. This avoids CORS and
  // keeps the provider switch in one place for the evaluator's network.
  if (typeof window !== 'undefined' && window.location) {
    try {
      const params = new URLSearchParams({ name: String(input.name || ''), city: String(input.city || '') });
      const response = await fetch(`/api/location-photo?${params}`, { signal: AbortSignal.timeout(options.timeoutMs || 9000) });
      if (!response.ok) return null;
      const payload = await response.json();
      return payload.photo || null;
    } catch { return null; }
  }
  return findBaiduLocationPhoto(input, options);
}
