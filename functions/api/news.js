// Cloudflare Pages Function: GET /api/news
// 공신력 있는 언론사 RSS에서 기획·구상에 다른 관점을 줄 만한 기사를 고르고,
// Workers AI(바인딩 이름 AI)로 한눈에 볼 수 있게 요약합니다.
// AI 바인딩이 없거나 실패하면 RSS 요약문을 그대로 돌려줍니다.

const FEEDS = [
  { source: '한겨레', section: '문화', url: 'https://www.hani.co.kr/rss/culture/' },
  { source: '한겨레', section: '과학', url: 'https://www.hani.co.kr/rss/science/' },
  { source: '경향신문', section: '문화', url: 'https://www.khan.co.kr/rss/rssdata/culture_news.xml' },
  { source: '경향신문', section: '과학', url: 'https://www.khan.co.kr/rss/rssdata/science_news.xml' },
  { source: 'BBC 코리아', section: '세계', url: 'https://feeds.bbci.co.uk/korean/rss.xml' },
];

// 새로운 시각·이야기·발견이 담긴 기사일수록 점수를 올립니다
const BOOST = ['인터뷰', '칼럼', '기획', '이야기', '생각', '질문', '왜', '어떻게', '미래', '실험', '발견', '연구',
  '도전', '상상', '철학', '예술', '디자인', '건축', '교육', '청년', '기록', '역사', '자연', '우주', '기술', '창작'];
// 정쟁·사건사고·단순 행사 안내는 점수를 내립니다
const PENALTY = ['민주당', '국민의힘', '공화당', '대통령실', '검찰', '선거', '의원', '탄핵', '북한', '김정은', '김여정',
  '트럼프', '사망', '살해', '체포', '혐의', '해킹', '개최', '개막', '할인', '모집', '부고', '포토'];

const TOTAL = 6;
const PER_SOURCE = 2;
const CACHE_SECONDS = 3 * 3600; // 요약은 3시간마다 새로 만듭니다 (무료 사용량 안에서 쓰기 위해)
const MODELS = ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-3.1-8b-instruct'];

function decode(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1]) : '';
}

function parse(xml, feed) {
  return (xml.match(/<item[\s>][\s\S]*?<\/item>/g) ?? []).map((it) => {
    const date = new Date(tag(it, 'pubDate') || tag(it, 'dc:date'));
    return {
      title: tag(it, 'title'),
      excerpt: tag(it, 'description').slice(0, 400),
      link: tag(it, 'link'),
      source: feed.source,
      section: feed.section,
      publishedAt: Number.isNaN(date.getTime()) ? null : date.toISOString(),
    };
  });
}

function score(item, now) {
  const text = `${item.title} ${item.excerpt}`;
  let s = 0;
  for (const w of BOOST) if (text.includes(w)) s += 2;
  for (const w of PENALTY) if (text.includes(w)) s -= 3;
  if (item.excerpt.length > 60) s += 1;
  if (item.publishedAt) {
    const hours = (now - new Date(item.publishedAt)) / 3600000;
    if (hours > 72) s -= 4;
    else if (hours < 24) s += 1;
  }
  return s;
}

async function fetchFeed(feed) {
  const res = await fetch(feed.url, {
    headers: { 'User-Agent': 'today-dashboard' },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`${feed.source} ${res.status}`);
  return parse(await res.text(), feed);
}

function pick(all) {
  const picked = [];
  const perSource = {};
  for (const it of all) {
    if (picked.length >= TOTAL) break;
    if ((perSource[it.source] ?? 0) >= PER_SOURCE) continue;
    perSource[it.source] = (perSource[it.source] ?? 0) + 1;
    picked.push(it);
  }
  return picked;
}

// 기사 여러 개를 한 번의 AI 호출로 요약합니다
async function summarize(ai, items) {
  const list = items.map((it, i) => `[${i}] 제목: ${it.title}\n내용: ${it.excerpt}`).join('\n\n');
  const prompt = `다음은 오늘의 기사 ${items.length}개입니다. 기획이나 구상을 하는 고등학생이 한눈에 볼 수 있게 정리해 주세요.
반드시 아래 JSON 하나만 출력하세요. 다른 말은 쓰지 마세요.
{"overview":"오늘 기사들에서 보이는 흐름 두 문장","items":[{"i":0,"summary":"핵심 내용 한 문장(50자 이내)","angle":"기획에 가져갈 만한 관점 한 문장(40자 이내)"}]}
모든 문장은 자연스러운 한국어 존댓말이 아닌 평서문(~다)으로 쓰고, 기사에 없는 사실은 지어내지 마세요.

${list}`;
  for (const model of MODELS) {
    try {
      const out = await ai.run(model, {
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1200,
        temperature: 0.2,
      });
      const text = typeof out?.response === 'string' ? out.response : JSON.stringify(out?.response ?? '');
      const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
      if (Array.isArray(json.items)) return { ...json, model };
    } catch {
      /* 다음 모델로 */
    }
  }
  return null;
}

export async function onRequestGet(context) {
  const cache = caches.default;
  const cacheKey = new Request(new URL('/api/news', context.request.url).toString());
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const results = await Promise.allSettled(FEEDS.map(fetchFeed));
  const now = Date.now();
  const seen = new Set();
  const ranked = results
    .flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
    .filter((it) => it.title && it.link && !seen.has(it.title) && seen.add(it.title))
    .map((it) => ({ ...it, score: score(it, now) }))
    .sort((a, b) => b.score - a.score || (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
  const picked = pick(ranked);

  const ai = context.env.AI ? await summarize(context.env.AI, picked) : null;
  const byIndex = new Map((ai?.items ?? []).map((x) => [Number(x.i), x]));

  const body = JSON.stringify({
    updatedAt: new Date(now).toISOString(),
    summarized: Boolean(ai),
    overview: ai?.overview ?? null,
    failed: results.flatMap((r, i) => (r.status === 'rejected' ? [`${FEEDS[i].source} ${FEEDS[i].section}`] : [])),
    items: picked.map((it, i) => ({
      title: it.title,
      link: it.link,
      source: it.source,
      section: it.section,
      publishedAt: it.publishedAt,
      summary: byIndex.get(i)?.summary || it.excerpt.slice(0, 120),
      angle: byIndex.get(i)?.angle || null,
    })),
  });
  const response = new Response(body, {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': `public, max-age=${CACHE_SECONDS}` },
  });
  if (picked.length) context.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}
