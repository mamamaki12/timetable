import { DAYS, extractCourse, pairsFromText, decodeImport, parseTerm } from './parse.js';

const KEY = 'kadai-jikanwari-v1';
const SYLLABUS_SEARCH = 'https://syllabus11.kuas.kagoshima-u.ac.jp/showSearch';

// 鹿児島大学の標準の授業時間（6限は学部によって違うので設定で直せるようにしておく）
const DEFAULT_PERIODS = [
  ['08:50', '10:20'],
  ['10:30', '12:00'],
  ['12:50', '14:20'],
  ['14:30', '16:00'],
  ['16:10', '17:40'],
  ['17:50', '19:20'],
];
const COLORS = 8;
const COLOR_NAMES = ['ピンク', 'オレンジ', '黄', '緑', '水色', '青', '紫', 'グレー'];
// 時間割の授業は、設定で選んだ1色にそろえる（初めは青）
const themeColor = () => (Number.isInteger(state.settings?.color) ? state.settings.color : 5);

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '').trim()) ? String(u).trim() : '');
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

// 4〜9月は前期、10〜3月は後期。1〜3月は前の年度
function currentTerm(now = new Date()) {
  const m = now.getMonth() + 1;
  return { year: m < 4 ? now.getFullYear() - 1 : now.getFullYear(), term: m >= 4 && m <= 9 ? '前期' : '後期' };
}

function load() {
  let s;
  try { s = JSON.parse(localStorage.getItem(KEY)); } catch { s = null; }
  const cur = currentTerm();
  s = s && typeof s === 'object' ? s : {};
  s.settings = { showSat: false, showP6: false, periods: DEFAULT_PERIODS.map((p) => [...p]), manaba: '', ...(s.settings || {}) };
  if (!Array.isArray(s.settings.periods) || s.settings.periods.length < 6) s.settings.periods = DEFAULT_PERIODS.map((p) => [...p]);
  s.courses = Array.isArray(s.courses) ? s.courses : [];
  s.view = { ...cur, ...(s.view || {}) };
  return s;
}

let state = load();
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { toast('保存できませんでした（ブラウザの保存領域を確認してください）'); }
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2600);
}

// ---- 表示する授業 ----
// 「集中」タブでは集中講義だけ、前期・後期では その学期と通年の授業
const isIntensiveView = () => state.view.term === '集中';
const inView = (c) => c.year === state.view.year && (isIntensiveView() ? c.term === '集中' : c.term === state.view.term || c.term === '通年');
const viewCourses = () => state.courses.filter(inView);
const dayCount = () => (state.settings.showSat || viewCourses().some((c) => c.slots?.some((s) => s.d === 5)) ? 6 : 5);
const periodCount = () => (state.settings.showP6 || viewCourses().some((c) => c.slots?.some((s) => s.p >= 6)) ? 6 : 5);
// status が 'cand' の授業は「候補」。表では薄く出し、単位や「いま・つぎ」には入れない
const isCand = (c) => c.status === 'cand';
const allAt = (d, p) => viewCourses().filter((c) => c.term !== '集中' && c.slots?.some((s) => s.d === d && s.p === p));
const courseAt = (d, p) => allAt(d, p).filter((c) => !isCand(c));
const candsAt = (d, p) => allAt(d, p).filter(isCand);
// この授業とコマが重なっている、ほかの授業
const overlapping = (c, slots = c.slots || []) => viewCourses().filter((x) => x.id !== c.id && x.term !== '集中' && slots.some((s) => x.slots?.some((t) => t.d === s.d && t.p === s.p)));

function render() {
  const { year, term } = state.view;
  $('#yearLabel').textContent = `${year}年度`;
  $('#pageTitle').textContent = `${year}年度 ${term}`;
  $$('.seg button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.term === term)));
  const intensive = isIntensiveView();
  $('#gridWrap').hidden = intensive;
  $('#intensive').hidden = !intensive;
  if (intensive) {
    $('#nowCard').hidden = true;
    $('#extraPanel').hidden = true;
    renderIntensive();
  } else {
    renderGrid();
    renderExtra();
    renderNow();
  }
  renderTasks();
  renderStats();
  const m = safeUrl(state.settings.manaba);
  $('#manabaLink').hidden = !m;
  if (m) $('#manabaLink').href = m;
}

function renderGrid() {
  const days = dayCount();
  const periods = periodCount();
  const now = new Date();
  const today = (now.getDay() + 6) % 7; // 月=0
  const curP = currentPeriod(now);
  const ps = state.settings.periods;
  let h = '<thead><tr><th class="corner"></th>';
  for (let d = 0; d < days; d++) h += `<th class="${d === today ? 'today' : ''}"><span>${DAYS[d]}</span></th>`;
  h += '</tr></thead><tbody>';
  for (let p = 1; p <= periods; p++) {
    h += `<tr><th class="ph"><b>${p}</b><small><span>${ps[p - 1][0]}</span><i></i><span>${ps[p - 1][1]}</span></small></th>`;
    for (let d = 0; d < days; d++) {
      const cs = courseAt(d, p);
      const cands = candsAt(d, p);
      const live = d === today && curP?.p === p && curP.during;
      const cls = ['cell', d === today ? 'today' : '', live ? 'live' : ''].join(' ');
      if (!cs.length && !cands.length) {
        h += `<td class="${cls}"><button class="empty" data-add="${d}-${p}" aria-label="${DAYS[d]}曜${p}限に追加">＋</button></td>`;
      } else if (!cs.length) {
        // 候補だけのコマ：候補の数と名前を出し、タップで比べる画面へ
        h += `<td class="${cls}"><button class="cand-cell" data-slot-list="${d}-${p}" aria-label="${DAYS[d]}曜${p}限の候補${cands.length}件">
          <span class="cand-count">候補${cands.length}</span>
          ${cands.slice(0, 3).map((c) => `<span class="cand-name c${themeColor()}">${esc(c.name)}</span>`).join('')}
        </button></td>`;
      } else {
        h += `<td class="${cls}"><div class="stack">`;
        for (const c of cs) {
          h += `<button class="course c${themeColor()}${cs.length > 1 ? ' clash' : ''}" data-id="${c.id}">
            <span class="cname">${esc(c.name)}</span>
            ${c.room ? `<span class="croom">${esc(c.room)}</span>` : ''}
            ${absenceBadge(c) || openTaskCount(c) ? `<span class="meta">${openTaskCount(c) ? `<span class="dot" title="未提出の課題">課${openTaskCount(c)}</span>` : ''}${absenceBadge(c)}</span>` : ''}
          </button>`;
        }
        if (cands.length) h += `<button class="cand-chip" data-slot-list="${d}-${p}" aria-label="${DAYS[d]}曜${p}限のほかの候補${cands.length}件">＋候補${cands.length}</button>`;
        h += '</div></td>';
      }
    }
    h += '</tr>';
  }
  $('#grid').innerHTML = h + '</tbody>';
  $('#grid').style.setProperty('--days', days);
}

const openTaskCount = (c) => (c.tasks || []).filter((t) => !t.done).length;
const absenceLimit = (c) => Math.floor((c.sessions || 15) / 3);
function absenceBadge(c) {
  const a = c.absences || 0;
  if (!a) return '';
  const lim = absenceLimit(c);
  const lvl = a > lim ? 'over' : a >= lim ? 'edge' : a >= lim - 1 ? 'warn' : '';
  return `<span class="abs ${lvl}">欠${a}</span>`;
}

const courseLine = (c, sub) => `<li><button class="course-line c${themeColor()}${isCand(c) ? ' cand' : ''}" data-id="${c.id}"><b>${isCand(c) ? '<span class="badge">候補</span>' : ''}${esc(c.name)}</b><small>${esc(sub.filter(Boolean).join(' ・ '))}</small></button></li>`;

// 前期・後期で、曜日・時限が入っていない授業（あるときだけ出す）
function renderExtra() {
  const list = viewCourses().filter((c) => !c.slots?.length);
  $('#extraPanel').hidden = !list.length;
  $('#extraList').innerHTML = list.map((c) => courseLine(c, [c.term, c.teacher, c.room])).join('');
}

// 「2026-08-20」〜「2026-08-23」→「8/20(木)〜8/23(日)」とあと何日か
function fmtRange(start, end) {
  const f = (v) => { const d = new Date(`${v}T00:00`); return Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}/${d.getDate()}(${'日月火水木金土'[d.getDay()]})`; };
  if (!start) return '';
  const s = f(start) + (end && end !== start ? `〜${f(end)}` : '');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((new Date(`${start}T00:00`) - today) / 86400000);
  const last = Math.round((new Date(`${end || start}T00:00`) - today) / 86400000);
  return `${s}${days > 0 ? `・あと${days}日` : last >= 0 ? '・実施中' : '・終了'}`;
}

// ---- 集中のページ ----
let intQuery = '';
let intSem = '';
let intLimit = 20;
function renderIntensive() {
  // 日程が近い順（日程なしは後ろ）
  const mine = viewCourses().sort((a, b) => (a.start || '9999').localeCompare(b.start || '9999') || isCand(a) - isCand(b));
  $('#intList').innerHTML = mine.length
    ? mine.map((c) => courseLine(c, [fmtRange(c.start, c.end) || '日程未定', c.sem, c.teacher, c.room, c.credits ? `${c.credits}単位` : ''])).join('')
    : '<li class="empty-note">まだありません。下の一覧から「＋ 追加」で入れられます。</li>';
  if (!$('#intFilters').children.length) {
    $('#intFilters').innerHTML = offerFiltersHtml(intQuery, `<label>学期<select class="int-sem">
      <option value="">すべて</option><option value="前期">前期</option><option value="後期">後期</option></select></label>`);
  }
  renderIntensiveOffers();
}
async function renderIntensiveOffers() {
  const { year } = state.view;
  const data = await loadOffers(year);
  if (!isIntensiveView() || state.view.year !== year) return;
  const box = $('#intOffers');
  if (!data) { box.innerHTML = noDataHtml(year, '「✎ 一覧にない集中講義を自分で入力」'); return; }
  fillOfferFilters($('#intFilters'), data);
  const q = intQuery.trim().toLowerCase();
  // 曜日か時限に「集中・不定など」がある授業
  const rows = sortOffers(data.rows.filter((r) => (r[5].includes('x') || r[6].includes('x'))
    && (!intSem || [intSem, '通年'].includes(offerTerm(data, r))) && offerMatches(r, q)));
  box.innerHTML = offerListHtml(data, rows, {
    note: `${year}年度${intSem ? intSem : ''}`,
    showSem: () => true,
    slotsText: false,
    limit: intLimit,
    more: true,
    empty: q ? '「さがす」に当てはまる授業はありません。' : '見つかりませんでした。学部を「すべての学部」にすると、ほかの学部の授業も出ます。',
  });
}
$('#intensive').addEventListener('change', (e) => {
  intLimit = 20;
  if (e.target.classList.contains('int-sem')) { intSem = e.target.value; renderIntensiveOffers(); return; }
  onOfferFilter(e, renderIntensiveOffers);
});
$('#intensive').addEventListener('input', (e) => {
  if (!e.target.classList.contains('offer-query')) return;
  intQuery = e.target.value;
  intLimit = 20;
  renderIntensiveOffers();
});
$('#intensive').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b?.dataset.offer) { e.stopPropagation(); addOffer(b.dataset.offer, true); }
  else if (b?.hasAttribute('data-more')) { e.stopPropagation(); intLimit += 40; renderIntensiveOffers(); }
  else if (b?.id === 'addIntensive') { e.stopPropagation(); openEditor({ term: '集中', slots: [] }); }
});

function renderTasks() {
  const items = [];
  for (const c of viewCourses()) for (const t of c.tasks || []) if (!t.done) items.push({ c, t });
  items.sort((a, b) => (a.t.due || '9999').localeCompare(b.t.due || '9999'));
  $('#allTasks').innerHTML = items.length
    ? items.map(({ c, t }) => `<li class="${dueClass(t.due)}"><label><input type="checkbox" data-task="${c.id}:${t.id}"> <span>${esc(t.title)}</span></label><small><button class="link-like" data-id="${c.id}">${esc(c.name)}</button>${t.due ? ` ・ ${fmtDue(t.due)}` : ''}</small></li>`).join('')
    : '<li class="empty-note">未提出の課題はありません。授業を開いて追加できます。</li>';
}

function fmtDue(due) {
  const d = new Date(due);
  if (Number.isNaN(d.getTime())) return due;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day0 = new Date(d);
  day0.setHours(0, 0, 0, 0);
  const days = Math.round((day0 - today) / 86400000);
  const late = d < new Date();
  const s = `${d.getMonth() + 1}/${d.getDate()}(${'日月火水木金土'[d.getDay()]})${due.includes('T') ? ` ${due.slice(11, 16)}` : ''}`;
  if (late) return `${s} 期限切れ`;
  if (days === 0) return `${s} 今日まで`;
  return `${s} あと${days}日`;
}
function dueClass(due) {
  if (!due) return '';
  const days = (new Date(due) - new Date()) / 86400000;
  return days < 0 ? 'late' : days < 2 ? 'soon' : '';
}

function renderStats() {
  const cs = viewCourses().filter((c) => !isCand(c));
  const nCand = viewCourses().length - cs.length;
  const credits = cs.reduce((a, c) => a + (Number(c.credits) || 0), 0);
  const koma = cs.reduce((a, c) => a + (c.term === '集中' ? 0 : c.slots?.length || 0), 0);
  const byCat = {};
  for (const c of cs) if (c.category && Number(c.credits)) byCat[c.category] = (byCat[c.category] || 0) + Number(c.credits);
  const yearCredits = state.courses.filter((c) => c.year === state.view.year && !isCand(c)).reduce((a, c) => a + (Number(c.credits) || 0), 0);
  $('#stats').innerHTML = `
    <div><b>${cs.length}</b><small>授業</small></div>
    ${isIntensiveView() ? '' : `<div><b>${koma}</b><small>コマ / 週</small></div>`}
    <div><b>${credits}</b><small>単位（${state.view.term}）</small></div>
    <div><b>${yearCredits}</b><small>単位（年度）</small></div>
    ${Object.keys(byCat).length ? `<p class="cats">${Object.entries(byCat).map(([k, v]) => `${esc(k)} ${v}単位`).join(' ・ ')}</p>` : ''}
    ${nCand ? `<p class="cats">ほかに候補が${nCand}件あります（合計には入れていません）</p>` : ''}`;
}

// ---- 今の授業・次の授業 ----
const toMin = (hm) => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
function currentPeriod(now = new Date()) {
  const t = now.getHours() * 60 + now.getMinutes();
  const ps = state.settings.periods.slice(0, periodCount());
  for (let i = 0; i < ps.length; i++) {
    const [s, e] = ps[i].map(toMin);
    if (t >= s && t < e) return { p: i + 1, during: true, left: e - t };
    if (t < s) return { p: i + 1, during: false, until: s - t };
  }
  return null;
}

function renderNow() {
  const now = new Date();
  const d = (now.getDay() + 6) % 7;
  const card = $('#nowCard');
  const cur = currentTerm(now);
  if (cur.year !== state.view.year || cur.term !== state.view.term || d >= dayCount()) {
    card.hidden = true;
    return;
  }
  const ps = state.settings.periods;
  const cp = currentPeriod(now);
  const nowC = cp?.during ? courseAt(d, cp.p)[0] : null;
  let next = null;
  const startP = cp ? (cp.during ? cp.p + 1 : cp.p) : periodCount() + 1;
  for (let p = startP; p <= periodCount(); p++) {
    const c = courseAt(d, p)[0];
    if (c) { next = { c, p }; break; }
  }
  if (!nowC && !next) {
    card.hidden = false;
    const hasToday = Array.from({ length: periodCount() }, (_, i) => courseAt(d, i + 1).length).some(Boolean);
    card.innerHTML = `<p class="now-empty">${hasToday ? '今日の授業はもうありません。おつかれさまでした 🌋' : viewCourses().some((c) => !isCand(c)) ? '今日は授業がありません 🌋' : '下の表の「＋」から授業を追加するか、🔎 シラバス検索で授業を探しましょう。'}</p>`;
    return;
  }
  const block = (label, c, p, extra) => `
    <button class="now-item c${themeColor()}" data-id="${c.id}">
      <span class="now-label">${label} ・ ${p}限 ${ps[p - 1][0]}〜${ps[p - 1][1]}${extra ? ` ・ ${extra}` : ''}</span>
      <span class="now-name">${esc(c.name)}</span>
      <span class="now-room">${esc(c.room || '教室未設定')}</span>
    </button>`;
  let h = '';
  if (nowC) h += block('いま', nowC, cp.p, `残り${cp.left}分`);
  if (next) {
    const until = toMin(ps[next.p - 1][0]) - (now.getHours() * 60 + now.getMinutes());
    h += block('つぎ', next.c, next.p, until > 0 ? `あと${until >= 60 ? `${Math.floor(until / 60)}時間` : ''}${until % 60}分` : '');
  }
  card.hidden = false;
  card.innerHTML = h;
}

// ---- 授業の詳しい画面 ----
let detailId = null;
function openDetail(id) {
  const c = state.courses.find((x) => x.id === id);
  if (!c) return;
  detailId = id;
  const ps = state.settings.periods;
  // 曜日ごとにまとめて「水3限 12:50〜14:20」「金3・4限 12:50〜16:00」のように出す
  const byDay = new Map();
  for (const s of c.slots || []) byDay.set(s.d, [...(byDay.get(s.d) || []), s.p].sort((a, b) => a - b));
  const when = c.term === '集中' ? `${c.sem && c.sem !== '集中' ? `${c.sem}・` : ''}${c.start ? fmtRange(c.start, c.end) : '日程未定'}`
    : [...byDay].map(([d, pp]) => `${DAYS[d]}${pp.join('・')}限 ${ps[pp[0] - 1][0]}〜${ps[pp[pp.length - 1] - 1][1]}`).join(' / ') || '曜日・時限なし';
  const a = c.absences || 0;
  const lim = absenceLimit(c);
  const tasks = c.tasks || [];
  $('#detailBody').innerHTML = `
    <div class="sheet-head">
      <h2 class="detail-title c${themeColor()}">${isCand(c) ? '<span class="badge">候補</span>' : ''}${esc(c.name)}</h2>
      <button type="button" class="icon-btn" data-close aria-label="閉じる">✕</button>
    </div>
    <dl class="facts">
      <dt>いつ</dt><dd>${esc(c.year)}年度 ${esc(c.term)}<br>${esc(when)}</dd>
      ${c.room ? `<dt>教室</dt><dd>${esc(c.room)}</dd>` : ''}
      ${c.teacher ? `<dt>担当</dt><dd>${esc(c.teacher)}</dd>` : ''}
      ${c.code ? `<dt>時間割コード</dt><dd><button class="link-like" data-copy="${esc(c.code)}">${esc(c.code)} <small>コピー</small></button></dd>` : ''}
      ${c.credits ? `<dt>単位</dt><dd>${esc(c.credits)}単位${c.category ? `（${esc(c.category)}）` : ''}</dd>` : ''}
    </dl>
    <div class="big-actions">
      ${safeUrl(c.syllabus)
        ? `<a class="btn primary big" href="${esc(safeUrl(c.syllabus))}" target="_blank" rel="noopener">📖 シラバスを開く</a>`
        : `<button class="btn primary big" id="findSyllabus">🔎 シラバス検索で探す</button>`}
      ${safeUrl(c.manaba) ? `<a class="btn big" href="${esc(safeUrl(c.manaba))}" target="_blank" rel="noopener">manaba を開く</a>` : ''}
    </div>
    ${candBox(c)}
    ${safeUrl(c.syllabus) ? '' : '<p class="hint">科目名をコピーしてからシラバス検索を開きます。見つけた授業のURLを「編集」で貼っておくと、次からはすぐ開けます。</p>'}

    <section class="absence">
      <h3>欠席</h3>
      <div class="counter">
        <button class="round" data-abs="-1" aria-label="欠席を1回減らす">−</button>
        <b class="${a > lim ? 'over' : a >= lim ? 'edge' : ''}">${a}</b><span>/ ${c.sessions || 15}回</span>
        <button class="round" data-abs="1" aria-label="欠席を1回増やす">＋</button>
      </div>
      <p class="hint">${a > lim ? '⚠ 3分の1を超えています。単位が出ないおそれがあるので、担当の先生やシラバスの出席の条件を確認してください。'
        : a >= lim ? `⚠ あと1回休むと3分の1（${lim}回）を超えます。`
        : `目安：授業回数の3分の1（${lim}回）まで。条件は授業ごとにシラバスで確認してください。`}</p>
    </section>

    <section>
      <h3>課題・提出物</h3>
      <ul class="task-list">
        ${tasks.map((t) => `<li class="${t.done ? 'done' : dueClass(t.due)}"><label><input type="checkbox" data-task="${c.id}:${t.id}" ${t.done ? 'checked' : ''}> <span>${esc(t.title)}</span></label><small>${t.due ? fmtDue(t.due) : ''} <button class="link-like" data-deltask="${t.id}" aria-label="消す">消す</button></small></li>`).join('') || '<li class="empty-note">まだありません</li>'}
      </ul>
      <form class="task-add" id="taskAdd">
        <input name="title" placeholder="例：第3回レポート" required>
        <input name="due" type="datetime-local" aria-label="期限">
        <button class="btn">追加</button>
      </form>
    </section>

    ${c.memo ? `<section><h3>メモ</h3><p class="memo">${esc(c.memo)}</p></section>` : ''}

    <div class="actions">
      <button class="btn" id="editCourse">編集</button>
    </div>`;
  const dlg = $('#detail');
  if (!dlg.open) dlg.showModal();
}

$('#detail').addEventListener('click', async (e) => {
  const c = state.courses.find((x) => x.id === detailId);
  if (!c) return;
  const t = e.target.closest('button, a');
  if (e.target === $('#detail')) return $('#detail').close();
  if (!t) return;
  if (t.matches('[data-close]')) return $('#detail').close();
  if (t.dataset.abs) {
    c.absences = Math.max(0, (c.absences || 0) + Number(t.dataset.abs));
    save(); render(); openDetail(c.id);
  } else if (t.dataset.deltask) {
    c.tasks = (c.tasks || []).filter((x) => x.id !== t.dataset.deltask);
    save(); render(); openDetail(c.id);
  } else if (t.dataset.copy) {
    await copy(t.dataset.copy);
  } else if (t.id === 'findSyllabus') {
    await copy(c.code || c.name, `「${c.code || c.name}」をコピーしました。検索画面の科目名${c.code ? 'や時間割コード' : ''}の欄に貼り付けてください`);
    window.open(SYLLABUS_SEARCH, '_blank', 'noopener');
  } else if (t.id === 'decide') {
    $('#detail').close();
    decide(c);
  } else if (t.id === 'toCand') {
    c.status = 'cand';
    save(); render(); openDetail(c.id);
    toast('候補にもどしました');
  } else if (t.dataset.slotList) {
    $('#detail').close();
    openSlot(t.dataset.slotList);
  } else if (t.id === 'editCourse') {
    $('#detail').close();
    openEditor(c);
  }
});
$('#detail').addEventListener('submit', (e) => {
  if (e.target.id !== 'taskAdd') return;
  e.preventDefault();
  const c = state.courses.find((x) => x.id === detailId);
  const f = new FormData(e.target);
  (c.tasks ||= []).push({ id: uid(), title: String(f.get('title')).trim(), due: String(f.get('due') || ''), done: false });
  save(); render(); openDetail(c.id);
});

// 授業の画面の「候補」まわり：決めるボタンと、同じコマの候補へのリンク
function candBox(c) {
  if (c.term === '集中' || !c.slots?.length) {
    return `<div class="cand-box">${isCand(c) ? '<button class="btn primary" id="decide">✓ これを履修する</button>' : '<button class="btn" id="toCand">候補にもどす</button>'}</div>`;
  }
  const others = overlapping(c);
  const links = [...new Set(c.slots.map((s) => `${s.d}-${s.p}`))].map((k) => {
    const [d, p] = k.split('-').map(Number);
    const n = allAt(d, p).length - 1;
    return `<button class="link-like" data-slot-list="${k}">${DAYS[d]}${p}限${n ? `のほかの授業・候補（${n}）` : 'に候補を追加'}</button>`;
  }).join('　');
  return `<div class="cand-box">
    ${isCand(c)
      ? `<button class="btn primary" id="decide">✓ これを履修する</button><p class="hint">${others.length ? `決めると、同じコマの${others.filter((x) => !isCand(x)).length ? '今の授業は候補にもどり、' : ''}ほかの候補を消すか選べます。` : 'このコマにはほかの授業がありません。'}</p>`
      : `<button class="btn" id="toCand">候補にもどす</button>`}
    <p class="slot-links">${links}</p>
  </div>`;
}

// ---- 同じコマの授業と候補を比べる画面 ----
let slotKey = null;
let decided = null; // 直前に決めた授業（ほかの候補を消すか聞くため）
function openSlot(key) {
  slotKey = key;
  const [d, p] = key.split('-').map(Number);
  const ps = state.settings.periods;
  const list = allAt(d, p).sort((a, b) => isCand(a) - isCand(b));
  const others = decided ? overlapping(decided).filter(isCand) : [];
  $('#slotBody').innerHTML = `
    <div class="sheet-head">
      <h2>${DAYS[d]}曜${p}限 <small class="muted">${ps[p - 1][0]}〜${ps[p - 1][1]}</small></h2>
      <button type="button" class="icon-btn" data-close aria-label="閉じる">✕</button>
    </div>
    ${decided && others.length ? `<div class="notice decided">
      <p>「${esc(decided.name)}」を履修することにしました。同じコマのほかの候補（${others.length}件）はどうしますか？</p>
      <div class="actions"><button class="btn danger" id="dropOthers">ほかの候補を消す</button><button class="btn" id="keepOthers">候補のまま残す</button></div>
    </div>` : ''}
    ${list.length ? `<p class="hint">${list.filter(isCand).length ? '候補を比べて「これにする」で決めます。候補は単位の合計に入りません。' : '下の「このコマの授業」から候補を入れておけます。'}</p>` : ''}
    ${list.length ? `<ul class="slot-list">
      ${list.map((c) => `<li class="slot-item c${themeColor()}${isCand(c) ? ' cand' : ''}">
        <button class="slot-main" data-open="${c.id}">
          <span class="badge${isCand(c) ? '' : ' take'}">${isCand(c) ? '候補' : '履修'}</span>
          <b>${esc(c.name)}</b>
          <small>${esc([c.teacher, c.room, c.credits ? `${c.credits}単位` : '', (c.slots || []).length > 1 ? c.slots.map((s) => `${DAYS[s.d]}${s.p}`).join('・') : ''].filter(Boolean).join(' ・ ')) || '　'}</small>
        </button>
        <div class="slot-acts">
          ${safeUrl(c.syllabus) ? `<a class="btn" href="${esc(safeUrl(c.syllabus))}" target="_blank" rel="noopener">📖 シラバス</a>` : `<button class="btn" data-find="${c.id}">🔎 シラバス</button>`}
          ${isCand(c) ? `<button class="btn primary" data-decide="${c.id}">これにする</button>` : ''}
        </div>
      </li>`).join('')}
    </ul>` : ''}
    <section class="offers${list.length ? ' ruled' : ''}">
      <h3>このコマに開講されている授業</h3>
      ${offerFiltersHtml(offerQuery)}
      <div id="offerList" class="offer-list"><p class="hint">読み込み中…</p></div>
    </section>
    <div class="actions">
      <button class="btn" data-add-cand="${key}">✎ 一覧にない授業を自分で入力</button>
    </div>`;
  const dlg = $('#slotSheet');
  if (!dlg.open) dlg.showModal();
  renderOffers();
}

// ---- シラバス検索から集めた授業の一覧（data/syllabus-<年度>.json） ----
const KYOTSU = '58'; // 共通教育センター
const KYOSHOKU = '59'; // 教師教育開発センター
const offerData = new Map();
let offerQuery = '';
function loadOffers(year) {
  if (!offerData.has(year)) {
    // どの年度のデータがあるかを data/index.json で確かめてから取りに行く
    offerData.set(year, fetch('data/index.json').then((r) => (r.ok ? r.json() : { years: [] }))
      .then((idx) => (idx.years.some((y) => y.year === year) ? fetch(`data/syllabus-${year}.json`).then((r) => (r.ok ? r.json() : null)) : null))
      .catch(() => null));
  }
  return offerData.get(year);
}
// 一覧の1行：[シラバスの番号, 科目名, 担当教員, 開設部局, 学期の番号, 曜日, 時限, 学年]
const offerTerm = (data, row) => parseTerm(data.sems[row[4]] || '');

// 学部・学年の選択肢を入れる（学部→大学院の順）。選んだものは設定に覚えておく
function fillOfferFilters(scope, data) {
  const sel = $('.offer-dept', scope);
  if (sel.options.length) return;
  const entries = Object.entries(data.depts).filter(([c]) => c !== KYOTSU && c !== KYOSHOKU)
    .sort((a, b) => /研究科/.test(a[1]) - /研究科/.test(b[1]));
  sel.innerHTML = `<option value="">共通教育だけ</option>${entries.map(([c, n]) => `<option value="${esc(c)}"${state.settings.dept === c ? ' selected' : ''}>${esc(n)}</option>`).join('')}<option value="*"${state.settings.dept === '*' ? ' selected' : ''}>すべての学部</option>`;
}
function offerFiltersHtml(queryValue, extra = '') {
  return `<div class="offer-filters">
    <label>学部<select class="offer-dept"></select></label>
    <label>学年<select class="offer-grade">
      <option value="">すべて</option>${[1, 2, 3, 4, 5, 6].map((g) => `<option value="${g}"${String(state.settings.grade || '') === String(g) ? ' selected' : ''}>${g}年</option>`).join('')}
    </select></label>
    ${extra}
    <label class="grow">さがす<input class="offer-query" type="search" placeholder="科目名・先生の名前" value="${esc(queryValue)}"></label>
  </div>`;
}
// 学部・学年・さがす の条件に合うか
function offerMatches(r, q) {
  const dept = state.settings.dept || '';
  const grade = String(state.settings.grade || '');
  return (dept === '*' || r[3] === KYOTSU || r[3] === KYOSHOKU || r[3] === dept)
    && (!grade || !r[7] || r[7].includes(grade))
    && (!q || `${r[1]} ${r[2]}`.toLowerCase().includes(q));
}
// 自分の学部 → 共通教育 → そのほか、の順
function sortOffers(rows) {
  const dept = state.settings.dept || '';
  const rank = (r) => (r[3] === dept ? 0 : r[3] === KYOTSU ? 1 : 2);
  return rows.sort((a, b) => rank(a) - rank(b) || a[1].localeCompare(b[1], 'ja'));
}
const deptLabel = (data, code) => (code === KYOTSU ? '共通教育' : data.depts[code] || '');
function offerListHtml(data, rows, { note, showSem, slotsText = true, empty, limit = 80, more = false }) {
  const added = new Set(state.courses.filter((c) => c.year === data.year && c.sid).map((c) => c.sid));
  const shown = rows.slice(0, limit);
  if (!rows.length) return `<p class="hint">${empty}</p>`;
  return `<p class="hint">${rows.length}件${rows.length > shown.length && !more ? `（はじめの${shown.length}件。「さがす」で絞り込めます）` : ''}${note ? `・${note}` : ''}</p>
    <ul class="slot-list">${shown.map((r) => {
      const sem = data.sems[r[4]];
      const when = slotsText && (r[5].length > 1 || r[6].length > 1)
        ? `${[...r[5]].map((x) => DAYS[x] || 'ほか').join('')} ${[...r[6]].filter((x) => x !== 'x').join('・')}${r[6].replace('x', '') ? '限' : ''}${r[6].includes('x') && r[6] !== 'x' ? 'ほか' : ''}` : '';
      return `<li class="offer-item">
        <div class="offer-main">
          <b>${esc(r[1])}</b>
          <small>${esc([r[2], deptLabel(data, r[3]), showSem(sem) ? sem : '', r[7] ? `${r[7].split('').join('・')}年` : '', r[8] != null ? `${r[8]}単位` : '', when].filter(Boolean).join(' ・ '))}</small>
        </div>
        <div class="slot-acts">
          <a class="btn" href="${esc(data.detail + r[0])}" target="_blank" rel="noopener">📖 シラバス</a>
          ${added.has(String(r[0])) ? '<span class="added">追加済み</span>' : `<button class="btn primary" data-offer="${r[0]}">＋ 追加</button>`}
        </div>
      </li>`;
    }).join('')}</ul>
    ${more && rows.length > shown.length ? `<button class="btn more" data-more>もっと見る（残り${rows.length - shown.length}件）</button>` : ''}`;
}
const noDataHtml = (year, how) => `<p class="hint">${year}年度の授業の一覧はまだありません。${how}か、🔎 シラバス検索から追加してください。</p>`;

async function renderOffers() {
  const key = slotKey;
  const [d, p] = key.split('-').map(Number);
  const { year, term } = state.view;
  const data = await loadOffers(year);
  if (slotKey !== key || !$('#slotSheet').open) return;
  const box = $('#offerList');
  if (!data) { box.innerHTML = noDataHtml(year, '「✎ 一覧にない授業を自分で入力」'); return; }
  fillOfferFilters($('#slotSheet'), data);
  const q = offerQuery.trim().toLowerCase();
  const rows = sortOffers(data.rows.filter((r) => r[5].includes(String(d)) && r[6].includes(String(p))
    && [term, '通年'].includes(offerTerm(data, r)) && offerMatches(r, q)));
  const dept = state.settings.dept || '';
  box.innerHTML = offerListHtml(data, rows, {
    note: `${year}年度${term}${dept ? '' : '・学部を選ぶと専門の授業も出ます'}`,
    showSem: (sem) => sem !== term,
    empty: `${q ? '「さがす」に当てはまる授業はありません。' : `${year}年度${term}のこのコマの授業は見つかりませんでした。`}${dept && dept !== '*' ? '学部を「すべての学部」にすると、ほかの学部の授業も出ます。' : ''}`,
  });
}

// 一覧の授業を時間割に入れる。
// 時間割のコマから：そのコマにもう履修する授業があれば候補として入れる。
// 集中のページから：曜日・時限なしの集中講義として入れる。
async function addOffer(id, intensive = false) {
  const { year } = state.view;
  const data = await loadOffers(year);
  const r = data?.rows.find((x) => x[0] === Number(id));
  if (!r) return;
  const base = {
    id: uid(), sid: String(r[0]), name: r[1], teacher: r[2], room: '', code: '', credits: r[8] ?? '',
    category: r[3] === KYOTSU ? '共通教育' : r[3] === KYOSHOKU ? '教職' : '専門',
    syllabus: data.detail + r[0], manaba: '', sessions: r[9] || 15, memo: '', year,
    absences: 0, tasks: [],
  };
  if (intensive) {
    state.courses.push({ ...base, term: '集中', sem: data.sems[r[4]] || '', slots: [], status: 'take' });
    save(); render();
    toast(`「${r[1]}」を集中講義に入れました。日程が分かったら授業の画面の「編集」で入れておけます`);
    return;
  }
  const [d, p] = slotKey.split('-').map(Number);
  // 曜日か時限のどちらかが1つなら全部のコマ。どちらも複数（組み合わせ不明）や「集中・不定」があるときは、押したコマだけ
  const ds = [...r[5]];
  const ps = [...r[6]];
  const clear = !ds.includes('x') && !ps.includes('x') && (ds.length === 1 || ps.length === 1);
  const slots = clear ? ds.flatMap((x) => ps.map((y) => ({ d: Number(x), p: Number(y) }))) : [{ d, p }];
  const busy = slots.some((s) => courseAt(s.d, s.p).length);
  state.courses.push({ ...base, term: offerTerm(data, r) || state.view.term, slots, status: busy ? 'cand' : 'take' });
  save(); render(); openSlot(slotKey);
  toast(`「${r[1]}」を${busy ? '候補に' : '時間割に'}入れました${clear ? '' : `（${DAYS[d]}${p}限だけ。ほかのコマは授業の画面の「編集」で）`}`);
}

// 候補を履修する授業に決める。重なっている履修中の授業は候補にもどす
function decide(c) {
  c.status = 'take';
  const bumped = overlapping(c).filter((x) => !isCand(x));
  for (const x of bumped) x.status = 'cand';
  save(); render();
  const others = overlapping(c).filter(isCand);
  toast(`「${c.name}」を履修することにしました${bumped.length ? `（${bumped.map((x) => `「${x.name}」`).join('')}は候補にもどしました）` : ''}`);
  if (others.length && c.slots?.length) {
    decided = c;
    openSlot(`${c.slots[0].d}-${c.slots[0].p}`);
  }
}

$('#slotSheet').addEventListener('click', async (e) => {
  if (e.target === $('#slotSheet')) return $('#slotSheet').close();
  const t = e.target.closest('button');
  if (!t) return;
  if (t.matches('[data-close]')) return $('#slotSheet').close();
  if (t.dataset.open) {
    $('#slotSheet').close();
    openDetail(t.dataset.open);
  } else if (t.dataset.find) {
    const c = state.courses.find((x) => x.id === t.dataset.find);
    await copy(c.code || c.name, `「${c.code || c.name}」をコピーしました。検索画面に貼り付けてください`);
    window.open(SYLLABUS_SEARCH, '_blank', 'noopener');
  } else if (t.dataset.decide) {
    decided = null;
    decide(state.courses.find((x) => x.id === t.dataset.decide));
    if (!decided) openSlot(slotKey);
  } else if (t.id === 'dropOthers') {
    const drop = overlapping(decided).filter(isCand);
    state.courses = state.courses.filter((x) => !drop.includes(x));
    decided = null;
    save(); render(); openSlot(slotKey);
    toast(`候補を${drop.length}件消しました`);
  } else if (t.id === 'keepOthers') {
    decided = null;
    openSlot(slotKey);
  } else if (t.dataset.offer) {
    addOffer(t.dataset.offer);
  } else if (t.dataset.addCand) {
    const [d, p] = t.dataset.addCand.split('-').map(Number);
    $('#slotSheet').close();
    offerQuery = '';
    openEditor({ slots: [{ d, p }], status: courseAt(d, p).length ? 'cand' : 'take' });
  }
});
$('#slotSheet').addEventListener('close', () => { decided = null; });
// 学部・学年・さがす（時間割のコマの画面と、集中のページで共通）
function onOfferFilter(e, rerender) {
  const t = e.target;
  if (t.classList.contains('offer-dept')) state.settings.dept = t.value;
  else if (t.classList.contains('offer-grade')) state.settings.grade = t.value;
  else return false;
  save();
  rerender();
  return true;
}
$('#slotSheet').addEventListener('change', (e) => onOfferFilter(e, renderOffers));
$('#slotSheet').addEventListener('input', (e) => {
  if (!e.target.classList.contains('offer-query')) return;
  offerQuery = e.target.value;
  renderOffers();
});

async function copy(text, msg) {
  try {
    await navigator.clipboard.writeText(text);
    toast(msg || 'コピーしました');
  } catch {
    toast(`コピーできませんでした：${text}`);
  }
}

// ---- 編集画面 ----
let editing = null;
let pickedSlots = [];
let carry = {}; // 編集画面に出さないが、新しく保存するときに引き継ぐ項目（シラバスの番号など）

function openEditor(course, notice) {
  editing = course?.id ? course : null;
  const c = { term: state.view.term, year: state.view.year, sessions: 15, ...(course || {}) };
  const f = $('#editForm');
  f.reset();
  $('#editTitle').textContent = editing ? '授業を編集' : '授業を追加';
  $('#deleteCourse').hidden = !editing;
  for (const k of ['name', 'teacher', 'room', 'code', 'credits', 'syllabus', 'manaba', 'sessions', 'memo', 'term', 'category', 'start', 'end']) {
    if (f.elements[k]) f.elements[k].value = c[k] ?? '';
  }
  if (!c.term) f.elements.term.value = state.view.term;
  pickedSlots = (c.slots || []).map((s) => ({ ...s }));
  toggleTermFields();
  carry = c.sid ? { sid: c.sid } : {};
  f.elements.status.value = c.status || 'take';
  updateStatusHint();
  $('#importNotice').hidden = !notice;
  $('#importNotice').textContent = notice || '';
  $('#importBox').open = false;
  $('#pasteText').value = '';
  f.dataset.year = c.year;
  renderSlotPicker();
  const rooms = [...new Set(state.courses.map((x) => x.room).filter(Boolean))];
  $('#roomList').innerHTML = rooms.map((r) => `<option value="${esc(r)}">`).join('');
  const dlg = $('#editor');
  if (!dlg.open) dlg.showModal();
}

function renderSlotPicker() {
  const days = Math.max(dayCount(), pickedSlots.some((s) => s.d === 5) ? 6 : 0);
  const periods = Math.max(periodCount(), ...pickedSlots.map((s) => s.p));
  let h = `<div class="sp" style="--cols:${days}"><span></span>`;
  for (let d = 0; d < days; d++) h += `<span class="sp-h">${DAYS[d]}</span>`;
  for (let p = 1; p <= periods; p++) {
    h += `<span class="sp-h">${p}</span>`;
    for (let d = 0; d < days; d++) {
      const on = pickedSlots.some((s) => s.d === d && s.p === p);
      const taken = courseAt(d, p).some((c) => c.id !== editing?.id);
      h += `<button type="button" class="sp-b${on ? ' on' : ''}${taken ? ' taken' : ''}" data-slot="${d}-${p}" aria-pressed="${on}" aria-label="${DAYS[d]}曜${p}限">${on ? '●' : taken ? '·' : ''}</button>`;
    }
  }
  $('#slotPicker').innerHTML = h + '</div>';
}

// 選んだコマにもう履修する授業があれば、そのことを出す
function updateStatusHint() {
  const f = $('#editForm');
  const names = [...new Set(pickedSlots.flatMap((s) => courseAt(s.d, s.p)).filter((c) => c.id !== editing?.id).map((c) => `「${c.name}」`))];
  const hint = $('#statusHint');
  hint.hidden = !names.length;
  hint.textContent = !names.length ? ''
    : f.elements.status.value === 'cand' ? `同じコマに${names.join('')}があるので、候補として入れます。`
    : `同じコマに${names.join('')}があります。「履修する」で保存すると、そちらは候補にもどります。`;
}
$('#editForm').addEventListener('change', (e) => {
  if (e.target.name === 'status') updateStatusHint();
  if (e.target.name === 'term') toggleTermFields();
});
// 集中講義は日程の欄を出し、曜日・時限の欄は隠す
function toggleTermFields() {
  const f = $('#editForm');
  const intensive = f.elements.term.value === '集中';
  $('#dateRow').hidden = !intensive;
  $('.slots', f).hidden = intensive;
}

$('#editor').addEventListener('click', (e) => {
  if (e.target === $('#editor')) return $('#editor').close();
  const b = e.target.closest('button');
  if (!b) return;
  if (b.matches('[data-close]')) return $('#editor').close();
  if (b.dataset.slot) {
    const [d, p] = b.dataset.slot.split('-').map(Number);
    const i = pickedSlots.findIndex((s) => s.d === d && s.p === p);
    if (i >= 0) pickedSlots.splice(i, 1); else pickedSlots.push({ d, p });
    renderSlotPicker();
    updateStatusHint();
  } else if (b.id === 'readPaste') {
    const text = $('#pasteText').value;
    const got = extractCourse(pairsFromText(text), { text });
    const n = fillForm(got);
    toast(!n ? '読み取れませんでした。項目を手で入れてください'
      : got.slotNote ? `${n}項目を読み取りました。${got.slotNote}は組み合わせが分からないので、曜日・時限を選んでください`
      : `${n}項目を読み取りました。内容を確かめて保存してください`);
    if (n) $('#importBox').open = false;
  } else if (b.id === 'deleteCourse') {
    if (!editing || !confirm(`「${editing.name}」を消しますか？`)) return;
    state.courses = state.courses.filter((x) => x.id !== editing.id);
    save(); render();
    $('#editor').close();
    toast('消しました');
  }
});

// 読み取った内容を編集画面に入れる（入れた項目の数を返す）
function fillForm(got) {
  const f = $('#editForm');
  let n = 0;
  for (const k of ['name', 'teacher', 'room', 'code', 'credits', 'syllabus', 'term', 'category', 'sessions']) {
    if (got[k] === undefined || got[k] === '') continue;
    if (k === 'category' && ![...f.elements.category.options].some((o) => o.value === got[k])) {
      f.elements.category.value = /共通/.test(got[k]) ? '共通教育' : /教職/.test(got[k]) ? '教職' : /専門/.test(got[k]) ? '専門' : '';
    } else {
      f.elements[k].value = got[k];
    }
    n++;
  }
  if (got.year) f.dataset.year = got.year;
  if (got.slots?.length) { pickedSlots = got.slots; renderSlotPicker(); n++; }
  return n;
}

$('#editForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  const v = (k) => f.elements[k].value.trim();
  const term = v('term');
  if (term !== '集中' && !pickedSlots.length && !confirm('曜日・時限が選ばれていません。このまま保存しますか？（時間割の下の「曜日・時限が決まっていない授業」に入ります）')) return;
  const data = {
    name: v('name'), teacher: v('teacher'), room: v('room'), code: v('code'),
    credits: v('credits') === '' ? '' : Number(v('credits')),
    term, category: v('category'), syllabus: safeUrl(v('syllabus')), manaba: safeUrl(v('manaba')),
    sessions: Number(v('sessions')) || 15, memo: f.elements.memo.value.trim(),
    slots: term === '集中' ? [] : [...pickedSlots].sort((a, b) => a.d - b.d || a.p - b.p),
    year: Number(f.dataset.year) || state.view.year,
    start: term === '集中' ? f.elements.start.value : '', end: term === '集中' ? f.elements.end.value : '',
    status: f.elements.status.value === 'cand' ? 'cand' : 'take',
  };
  if (editing) Object.assign(editing, data);
  else state.courses.push({ id: uid(), absences: 0, tasks: [], ...carry, ...data });
  // 保存した授業が見えるように、その年度・学期に切り替える
  if (data.year !== state.view.year || (data.term !== state.view.term && data.term !== '通年')) {
    state.view.year = data.year;
    if (data.term !== '通年') state.view.term = data.term;
  }
  // 「履修する」で保存したら、同じコマで履修中だった授業は候補にもどす（1コマに履修は1つ）
  const saved = editing || state.courses[state.courses.length - 1];
  const bumped = data.status === 'take' && data.term !== '集中' ? overlapping(saved).filter((x) => !isCand(x)) : [];
  for (const x of bumped) x.status = 'cand';
  save(); render();
  $('#editor').close();
  toast(bumped.length ? `保存しました（${bumped.map((x) => `「${x.name}」`).join('')}は候補にもどしました）`
    : data.status === 'cand' ? '候補として保存しました' : '保存しました');
});

// ---- 設定 ----
function renderSettings() {
  const s = state.settings;
  $('#showSat').checked = s.showSat;
  $('#showP6').checked = s.showP6;
  $('#manabaUrl').value = s.manaba || '';
  $('#themeColors').innerHTML = Array.from({ length: COLORS }, (_, i) => `<button type="button" role="radio" class="swatch c${i}${i === themeColor() ? ' on' : ''}" data-theme="${i}" aria-checked="${i === themeColor()}" aria-label="${COLOR_NAMES[i]}"></button>`).join('');
  $('#periodEditor').innerHTML = s.periods.map((p, i) => `
    <div class="period-row"><b>${i + 1}限</b><span class="pair"><input type="time" data-pi="${i}" data-pj="0" value="${p[0]}" aria-label="${i + 1}限の始まり"> 〜 <input type="time" data-pi="${i}" data-pj="1" value="${p[1]}" aria-label="${i + 1}限の終わり"></span></div>`).join('');
  const bm = bookmarklet();
  $('#bookmarklet').href = bm;
}

// シラバスのページで押すと「見出し→値」の組を集めて、このアプリの #add= に渡す
// シラバスのページで押すと、このアプリの #add= に授業の情報を渡す。
// 鹿大シラバス検索の詳しいページ（/showDetail/）では、ページに埋め込まれたデータをそのまま読む。
// それ以外のページでは「見出し→値」の組を集めて送り、アプリ側で項目を見分ける。
function bookmarklet() {
  const app = location.origin + location.pathname;
  const src = `(function(){var A=${JSON.stringify(app)},w=window.open('about:blank','_blank');function go(d){var u=A+'#add='+encodeURIComponent(JSON.stringify(d));if(w)w.location.href=u;else location.href=u}function generic(){var p=[],x='';function s(e){return((e.innerText||e.textContent||'')+'').replace(/\\s+/g,' ').trim()}function g(d){try{d.querySelectorAll('th,dt,td,label,b,strong,span').forEach(function(e){var k=s(e);if(!k||k.length>20)return;var n=e.nextElementSibling;if(!n)return;var v=s(n);if(v&&v.length<300&&p.length<200)p.push([k,v])});x=x||(d.getSelection&&d.getSelection()+'')||(d.body&&d.body.innerText||'').slice(0,1000);for(var i=0;i<d.defaultView.frames.length;i++)g(d.defaultView.frames[i].document)}catch(e){}}g(document);go({t:document.title,u:location.href,p:p,x:x.slice(0,1000)})}if(/\\/showDetail\\//.test(location.pathname)){fetch(location.href,{credentials:'same-origin'}).then(function(r){return r.text()}).then(function(h){var m=h.match(/<user-syllabus-detail\\s+:data='([^']*)'/)||h.match(/:data='([^']*)'/),t=document.createElement('textarea');t.innerHTML=m[1];var j=JSON.parse(t.value);function nm(a){return(a||[]).map(function(o){return o.name})}go({u:location.href,k:{id:j.id,n:j.syllabusName,t:j.teacher,ct:j.collaboratedTeacher,c:j.numberOfCredit,s:j.semesterName,tm:j.term,d:nm(j.days),h:nm(j.times),y:j.academicYear,dep:j.courseName,l:j.numberOfLessons}})}).catch(generic)}else generic()})();`;
  return 'javascript:' + src;
}

$('#openSettings').addEventListener('click', () => { renderSettings(); $('#settings').showModal(); });
$('#settings').addEventListener('click', (e) => {
  if (e.target === $('#settings') || e.target.closest('[data-close]')) $('#settings').close();
});
$('#bookmarklet').addEventListener('click', (e) => { e.preventDefault(); toast('ブックマークバーにドラッグしてください'); });
$('#copyBookmarklet').addEventListener('click', () => copy(bookmarklet(), 'コピーしました。ブックマークを作り、URLの欄に貼り付けてください'));
$('#themeColors').addEventListener('click', (e) => {
  const b = e.target.closest('[data-theme]');
  if (!b) return;
  state.settings.color = Number(b.dataset.theme);
  save(); render(); renderSettings();
});
$('#showSat').addEventListener('change', (e) => { state.settings.showSat = e.target.checked; save(); render(); });
$('#showP6').addEventListener('change', (e) => { state.settings.showP6 = e.target.checked; save(); render(); });
$('#manabaUrl').addEventListener('change', (e) => { state.settings.manaba = e.target.value.trim(); save(); render(); });
$('#periodEditor').addEventListener('change', (e) => {
  const i = e.target.dataset.pi;
  if (i === undefined || !e.target.value) return;
  state.settings.periods[i][e.target.dataset.pj] = e.target.value;
  save(); render();
});
$('#resetPeriods').addEventListener('click', () => {
  state.settings.periods = DEFAULT_PERIODS.map((p) => [...p]);
  save(); render(); renderSettings();
});
$('#exportData').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ app: 'kadai-jikanwari', ...state }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `鹿大じかんわり-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$('#importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.courses)) throw new Error();
    if (!confirm(`${data.courses.length}件の授業を読み込みます。今のデータは置き換わります。よろしいですか？`)) return;
    localStorage.setItem(KEY, JSON.stringify(data));
    state = load();
    render(); renderSettings();
    toast('読み込みました');
  } catch {
    toast('このファイルは読み込めませんでした');
  } finally {
    e.target.value = '';
  }
});
$('#clearTerm').addEventListener('click', () => {
  const n = viewCourses().filter((c) => c.term !== '通年').length;
  if (!n || !confirm(`${state.view.year}年度${state.view.term}の授業${n}件を消します。よろしいですか？`)) return;
  state.courses = state.courses.filter((c) => !(inView(c) && c.term !== '通年'));
  save(); render();
  toast('消しました');
});

// ---- 画面の操作 ----
document.addEventListener('click', (e) => {
  if (e.target.closest('dialog')) return;
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.add) {
    offerQuery = '';
    openSlot(b.dataset.add);
  } else if (b.dataset.slotList) {
    offerQuery = '';
    openSlot(b.dataset.slotList);
  } else if (b.dataset.id) {
    openDetail(b.dataset.id);
  } else if (b.dataset.term) {
    state.view.term = b.dataset.term;
    save(); render();
  } else if (b.id === 'prevYear' || b.id === 'nextYear') {
    state.view.year += b.id === 'prevYear' ? -1 : 1;
    save(); render();
  }
});
document.addEventListener('change', (e) => {
  const key = e.target.dataset?.task;
  if (!key) return;
  const [cid, tid] = key.split(':');
  const t = state.courses.find((c) => c.id === cid)?.tasks?.find((x) => x.id === tid);
  if (!t) return;
  t.done = e.target.checked;
  save(); render();
  if ($('#detail').open && detailId === cid) openDetail(cid);
  if (t.done) toast(`「${t.title}」を提出済みにしました`);
});

// ---- シラバスから来たとき（ブックマークレット・共有） ----
function handleIncoming() {
  let got = decodeImport(location.hash);
  if (!got) {
    // Android でシラバスのページを「共有」→このアプリ、のとき
    const q = new URLSearchParams(location.search);
    const url = q.get('url') || (q.get('text') || '').match(/https?:\/\/\S+/)?.[0];
    if (url || q.get('title')) got = { ...extractCourse([], { title: q.get('title') || '', url: url || '' }) };
  }
  if (!got) return;
  history.replaceState(null, '', location.pathname);
  const same = state.courses.find((c) => (got.sid && c.sid === got.sid) || (got.code && c.code === got.code && (!got.year || c.year === got.year)));
  if (same) {
    // 一覧から入れた授業には単位などがないので、シラバスから読んだ値で空いている項目を埋める
    let filled = 0;
    for (const k of ['syllabus', 'teacher', 'credits', 'sessions', 'category', 'sid']) {
      if (got[k] !== undefined && got[k] !== '' && (same[k] === undefined || same[k] === '' || (k === 'sessions' && same[k] === 15))) {
        if (same[k] !== got[k]) filled++;
        same[k] = got[k];
      }
    }
    if (filled) { save(); render(); }
    openDetail(same.id);
    toast(filled ? 'この授業はもう入っているので、空いていた項目（単位など）をシラバスから埋めました' : 'この授業はもう時間割に入っています');
    return;
  }
  const n = Object.keys(got).filter((k) => !['syllabus', 'sid', 'slotNote'].includes(k)).length;
  const year = got.year || state.view.year;
  const term = got.term || state.view.term;
  // もう履修する授業があるコマなら、最初から候補として入れる
  const busy = term !== '集中' && state.courses.some((c) => !isCand(c) && c.year === year && (c.term === term || c.term === '通年' || term === '通年')
    && (got.slots || []).some((s) => c.slots?.some((t) => t.d === s.d && t.p === s.p)));
  openEditor({ year, term, sessions: 15, status: busy ? 'cand' : 'take', ...got },
    n ? `シラバスから読み込みました。${got.slotNote ? `${got.slotNote}と書かれていて組み合わせが分からないので、曜日・時限を選んでください。` : ''}${busy ? '同じコマにもう授業があるので、候補として入れます。' : ''}内容を確かめて保存してください。` : 'シラバスのURLだけ読み込みました。科目名と曜日・時限を入れてください。');
}

render();
handleIncoming();
setInterval(() => { if (!document.hidden) { renderNow(); renderGrid(); } }, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
