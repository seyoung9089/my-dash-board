import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm';

// planning-web과 같은 Supabase를 읽기만 합니다. 공개(publishable) 키라 브라우저에 있어도 되고,
// 데이터는 RLS 규칙 때문에 로그인한 본인 것만 보입니다.
const supabase = createClient(
  'https://hxhwncbetmnurjwvnvlv.supabase.co',
  'sb_publishable_Kk2QV9JeUoP70JITBHEVgg_rqdXj908',
);

// 학교 위치: 충남 금산군 남일면 별무리길 근처
const WEATHER_URL =
  'https://api.open-meteo.com/v1/forecast?latitude=36.05&longitude=127.47' +
  '&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m' +
  '&hourly=temperature_2m,precipitation_probability' +
  '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code' +
  '&timezone=Asia%2FSeoul&forecast_days=2';

const PERIODS = [
  ['1교시', '09:05', '09:50'], ['2교시', '09:50', '10:35'], ['3교시', '10:40', '11:25'], ['4교시', '11:25', '12:10'],
  ['점심', '12:10', '13:10'], ['5교시', '13:10', '13:55'], ['6교시', '14:00', '14:45'], ['7교시', '14:50', '15:35'],
  ['8교시', '15:40', '16:25'], ['9교시', '16:30', '17:15'], ['10교시', '17:20', '18:05'], ['저녁시간', '18:10', '18:55'],
  ['저녁활동 1', '19:00', '20:00'], ['저녁활동 2', '20:00', '21:00'],
];

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pad = (n) => String(n).padStart(2, '0');
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeKey = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

// ---- 로그인 ----

let timer = null;
let channel = null;

supabase.auth.getSession().then(({ data }) => onSession(data.session));
supabase.auth.onAuthStateChange((_e, session) => onSession(session));
$('logout').addEventListener('click', () => supabase.auth.signOut());

let currentUser;
function onSession(session) {
  const id = session?.user.id ?? null;
  if (id === currentUser) return;
  currentUser = id;
  clearInterval(timer);
  if (channel) supabase.removeChannel(channel);
  channel = null;
  $('logout').hidden = !session;

  if (!session) {
    renderLogin();
    return;
  }
  const refresh = () => loadPlans().catch(() => {
    $('todo-body').innerHTML = '<p class="muted">할 일을 불러오지 못했어요. 새로고침해 주세요.</p>';
  });
  refresh();
  timer = setInterval(refresh, 60_000);
  channel = supabase
    .channel('dash')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'todos' }, refresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, refresh)
    .subscribe();
}

function renderLogin() {
  $('todo-count').textContent = '';
  $('now-line').textContent = '오늘 한눈에';
  $('next-line').textContent = 'planning-web 계정으로 로그인하면 할 일과 일정이 보여요';
  $('agenda').innerHTML = '<li class="muted">로그인하면 보여요</li>';
  $('todo-body').innerHTML = `
    <form class="login" id="login">
      <input id="email" type="email" placeholder="planning-web 이메일" autocomplete="username" required />
      <input id="password" type="password" placeholder="비밀번호" autocomplete="current-password" required />
      <button class="primary" type="submit">로그인</button>
      <p class="msg" id="login-msg"></p>
    </form>`;
  $('login').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('login-msg').textContent = '';
    const { error } = await supabase.auth.signInWithPassword({ email: $('email').value, password: $('password').value });
    if (error) $('login-msg').textContent = '이메일이나 비밀번호가 맞지 않아요.';
  });
}

// ---- 할 일 + 오늘 일정 ----

async function loadPlans() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start.getTime() + 86400000);
  const [todos, events] = await Promise.all([
    supabase.from('todos').select('*').eq('done', false).order('due_date', { nullsFirst: false }).order('created_at', { ascending: false }),
    supabase.from('events').select('*').lt('start_at', end.toISOString()).gt('end_at', start.toISOString()).order('start_at'),
  ]);
  if (todos.error || events.error) throw todos.error || events.error;
  renderHeader(now, events.data);
  renderTodos(todos.data);
  renderAgenda(now, events.data, todos.data);
}

function dueLabel(key) {
  if (!key) return null;
  const today = new Date(dateKey(new Date()) + 'T00:00');
  const diff = Math.round((new Date(key + 'T00:00') - today) / 86400000);
  if (diff < 0) return { text: `${-diff}일 지남`, tone: 'late' };
  if (diff === 0) return { text: '오늘', tone: 'late' };
  if (diff === 1) return { text: '내일', tone: 'soon' };
  if (diff <= 7) return { text: `D-${diff}`, tone: 'soon' };
  const [, m, d] = key.split('-').map(Number);
  return { text: `${m}/${d}`, tone: '' };
}

function periodLabel(s, e) {
  const a = PERIODS.find((p) => p[1] === timeKey(s));
  const b = PERIODS.find((p) => p[2] === timeKey(e));
  const day = s.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric', weekday: 'short' });
  if (a && b) return `${day} ${a[0] === b[0] ? a[0] : `${a[0]}–${b[0].replace('교시', '')}`}`;
  return `${day} ${timeKey(s)}`;
}

function renderTodos(todos) {
  // 시간(교시)을 정한 할 일이 먼저, 나머지는 마감 순
  const list = [...todos].sort((a, b) => {
    if (!!a.scheduled_start !== !!b.scheduled_start) return a.scheduled_start ? -1 : 1;
    if (a.scheduled_start) return new Date(a.scheduled_start) - new Date(b.scheduled_start);
    return 0;
  });
  $('todo-count').textContent = list.length ? `${list.length}개` : '';
  if (!list.length) {
    $('todo-body').innerHTML = '<p class="muted">남은 할 일이 없어요</p>';
    return;
  }
  $('todo-body').innerHTML = `<ul class="todos">${list
    .map((t) => {
      const due = dueLabel(t.due_date);
      const when = t.scheduled_start ? periodLabel(new Date(t.scheduled_start), new Date(t.scheduled_end)) : '';
      return `<li><span class="title">${esc(t.title)}</span><span class="tags">
        ${when ? `<span class="tag when">${esc(when)}</span>` : ''}
        ${due ? `<span class="tag ${due.tone}">${due.text}</span>` : ''}</span></li>`;
    })
    .join('')}</ul>`;
}

function renderHeader(now, events) {
  const timed = events.filter((e) => !e.all_day);
  const cur = timed.find((e) => new Date(e.start_at) <= now && now < new Date(e.end_at));
  const next = timed.find((e) => new Date(e.start_at) > now);
  const span = (d) => {
    const m = Math.max(0, Math.round((d - now) / 60000));
    return m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m}분`;
  };
  $('now-line').textContent = cur ? `지금: ${cur.title} · ${span(new Date(cur.end_at))} 남음` : '지금은 비어 있는 시간이에요';
  $('next-line').textContent = next
    ? `다음: ${timeKey(new Date(next.start_at))} ${next.title} (${span(new Date(next.start_at))} 뒤)`
    : '오늘 남은 일정이 없어요';
}

function renderAgenda(now, events, todos) {
  const today = dateKey(now);
  const rows = [
    ...events.filter((e) => !e.all_day),
    ...todos
      .filter((t) => t.scheduled_start && dateKey(new Date(t.scheduled_start)) === today)
      .map((t) => ({ title: t.title, start_at: t.scheduled_start, end_at: t.scheduled_end, todo: true })),
  ].sort((a, b) => new Date(a.start_at) - new Date(b.start_at));
  if (!rows.length) {
    $('agenda').innerHTML = '<li class="muted">오늘 일정이 없어요</li>';
    return;
  }
  $('agenda').innerHTML = rows
    .map((e) => {
      const s = new Date(e.start_at);
      const en = new Date(e.end_at);
      const state = en <= now ? 'past' : s <= now ? 'now' : '';
      const kind = e.todo ? 'todo' : e.is_timetable || e.memo === '[시간표]' ? 'class' : '';
      return `<li class="${state} ${kind}"><span class="time">${timeKey(s)}–${timeKey(en)}</span><span>${esc(e.title)}</span></li>`;
    })
    .join('');
}

// ---- 날씨 ----

const WMO = {
  0: '맑음', 1: '대체로 맑음', 2: '구름 조금', 3: '흐림', 45: '안개', 48: '짙은 안개', 51: '약한 이슬비', 53: '이슬비',
  55: '강한 이슬비', 61: '약한 비', 63: '비', 65: '강한 비', 66: '어는 비', 67: '강한 어는 비', 71: '약한 눈', 73: '눈',
  75: '많은 눈', 77: '싸락눈', 80: '소나기', 81: '소나기', 82: '강한 소나기', 85: '눈 소나기', 86: '강한 눈 소나기',
  95: '뇌우', 96: '뇌우·우박', 99: '강한 뇌우·우박',
};

async function loadWeather() {
  try {
    const res = await fetch(WEATHER_URL);
    if (!res.ok) throw new Error();
    const w = await res.json();
    const c = w.current;
    const d = w.daily;
    const base = w.hourly.time.findIndex((t) => new Date(t) >= new Date(Date.now() - 3600000));
    const hours = [0, 3, 6, 9, 12]
      .map((k) => base + k)
      .filter((i) => i >= 0 && i < w.hourly.time.length)
      .map((i) => `<li><span>${new Date(w.hourly.time[i]).getHours()}시</span><b>${Math.round(w.hourly.temperature_2m[i])}°</b><span class="muted">${w.hourly.precipitation_probability[i]}%</span></li>`);
    const tips = [];
    if (d.precipitation_probability_max[0] >= 50) tips.push('우산 챙기기');
    if (d.temperature_2m_min[0] <= 5) tips.push('두꺼운 겉옷');
    else if (d.temperature_2m_max[0] - d.temperature_2m_min[0] >= 10) tips.push('일교차 큼, 겉옷');
    $('weather').innerHTML = `
      <div class="wx-now"><span class="wx-temp">${Math.round(c.temperature_2m)}°</span>
        <div><p class="wx-state">${WMO[c.weather_code] ?? '-'}</p>
        <p class="muted">체감 ${Math.round(c.apparent_temperature)}° · 바람 ${Math.round(c.wind_speed_10m)}km/h</p></div></div>
      <p class="wx-day">최고 ${Math.round(d.temperature_2m_max[0])}° / 최저 ${Math.round(d.temperature_2m_min[0])}° · 강수확률 ${d.precipitation_probability_max[0]}%</p>
      <ul class="wx-hours">${hours.join('')}</ul>
      ${tips.length ? `<p class="wx-tip">${tips.join(' · ')}</p>` : ''}
      <p class="muted small">내일 ${WMO[d.weather_code[1]] ?? '-'}, ${Math.round(d.temperature_2m_min[1])}°~${Math.round(d.temperature_2m_max[1])}°, 강수확률 ${d.precipitation_probability_max[1]}%</p>`;
  } catch {
    $('weather').innerHTML = '<p class="muted">날씨를 불러오지 못했어요.</p>';
  }
}

// ---- 뉴스 ----

async function loadNews() {
  try {
    const res = await fetch('/api/news');
    if (!res.ok) throw new Error();
    const data = await res.json();
    if (!data.items?.length) throw new Error();
    const at = new Date(data.updatedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    $('news-meta').textContent = `${at} 기준${data.summarized ? ' · AI 요약' : ''}`;
    if (data.overview) {
      $('news-overview').textContent = data.overview;
      $('news-overview').hidden = false;
    }
    $('news').innerHTML = data.items
      .map(
        (n) => `<li>
          <a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a>
          <p class="sum">${esc(n.summary)}</p>
          ${n.angle ? `<p class="angle"><span>관점</span>${esc(n.angle)}</p>` : ''}
          <span class="src">${esc(n.source)} · ${esc(n.section)}</span>
        </li>`,
      )
      .join('');
  } catch {
    $('news').innerHTML = '<li class="muted">뉴스를 불러오지 못했어요. 잠시 뒤 새로고침해 주세요.</li>';
  }
}

$('today-date').textContent = new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' });
loadWeather();
loadNews();
