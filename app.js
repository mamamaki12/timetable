import { DAYS, extractCourse, pairsFromText, decodeImport } from './parse.js';

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
const inView = (c) => c.year === state.view.year && (c.term === state.view.term || c.term === '通年');
const viewCourses = () => state.courses.filter(inView);
const dayCount = () => (state.settings.showSat || viewCourses().some((c) => c.slots?.some((s) => s.d === 5)) ? 6 : 5);
const periodCount = () => (state.settings.showP6 || viewCourses().some((c) => c.slots?.some((s) => s.p >= 6)) ? 6 : 5);
const courseAt = (d, p) => viewCourses().filter((c) => c.term !== '集中' && c.slots?.some((s) => s.d === d && s.p === p));

function render() {
  const { year, term } = state.view;
  $('#yearLabel').textContent = `${year}年度`;
  $('#termLabel').textContent = `鹿児島大学 ${year}年度 ${term}`;
  $$('.seg button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.term === term)));
  renderGrid();
  renderExtra();
  renderTasks();
  renderStats();
  renderNow();
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
  for (let d = 0; d < days; d++) h += `<th class="${d === today ? 'today' : ''}">${DAYS[d]}</th>`;
  h += '</tr></thead><tbody>';
  for (let p = 1; p <= periods; p++) {
    h += `<tr><th class="ph"><b>${p}</b><small>${ps[p - 1][0]}<br>${ps[p - 1][1]}</small></th>`;
    for (let d = 0; d < days; d++) {
      const cs = courseAt(d, p);
      const live = d === today && curP?.p === p && curP.during;
      const cls = ['cell', d === today ? 'today' : '', live ? 'live' : ''].join(' ');
      if (!cs.length) {
        h += `<td class="${cls}"><button class="empty" data-add="${d}-${p}" aria-label="${DAYS[d]}曜${p}限に追加">＋</button></td>`;
      } else {
        h += `<td class="${cls}">`;
        for (const c of cs) {
          h += `<button class="course c${c.color ?? 0}${cs.length > 1 ? ' clash' : ''}" data-id="${c.id}">
            <span class="cname">${esc(c.name)}</span>
            ${c.room ? `<span class="croom">${esc(c.room)}</span>` : ''}
            ${absenceBadge(c)}${openTaskCount(c) ? `<span class="dot" title="未提出の課題">${openTaskCount(c)}</span>` : ''}
          </button>`;
        }
        h += '</td>';
      }
    }
    h += '</tr>';
  }
  $('#grid').innerHTML = h + '</tbody>';
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

function renderExtra() {
  const list = viewCourses().filter((c) => c.term === '集中' || !c.slots?.length);
  $('#extraList').innerHTML = list.length
    ? list.map((c) => `<li><button class="course-line c${c.color ?? 0}" data-id="${c.id}"><b>${esc(c.name)}</b><small>${esc([c.term, c.teacher, c.room].filter(Boolean).join(' ・ '))}</small></button></li>`).join('')
    : '<li class="empty-note">ありません</li>';
}

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
  const cs = viewCourses();
  const credits = cs.reduce((a, c) => a + (Number(c.credits) || 0), 0);
  const koma = cs.reduce((a, c) => a + (c.term === '集中' ? 0 : c.slots?.length || 0), 0);
  const byCat = {};
  for (const c of cs) if (c.category) byCat[c.category] = (byCat[c.category] || 0) + (Number(c.credits) || 0);
  const yearCredits = state.courses.filter((c) => c.year === state.view.year).reduce((a, c) => a + (Number(c.credits) || 0), 0);
  $('#stats').innerHTML = `
    <div><b>${cs.length}</b><small>授業</small></div>
    <div><b>${koma}</b><small>コマ / 週</small></div>
    <div><b>${credits}</b><small>単位（${state.view.term}）</small></div>
    <div><b>${yearCredits}</b><small>単位（年度）</small></div>
    ${Object.keys(byCat).length ? `<p class="cats">${Object.entries(byCat).map(([k, v]) => `${esc(k)} ${v}単位`).join(' ・ ')}</p>` : ''}`;
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
    card.innerHTML = `<p class="now-empty">${viewCourses().length ? '今日の授業はもうありません。おつかれさまでした 🌋' : '下の表の「＋」から授業を追加するか、🔎 シラバス検索で授業を探しましょう。'}</p>`;
    return;
  }
  const block = (label, c, p, extra) => `
    <button class="now-item c${c.color ?? 0}" data-id="${c.id}">
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
  const when = c.term === '集中' ? '集中講義'
    : [...byDay].map(([d, pp]) => `${DAYS[d]}${pp.join('・')}限 ${ps[pp[0] - 1][0]}〜${ps[pp[pp.length - 1] - 1][1]}`).join(' / ') || '曜日・時限なし';
  const a = c.absences || 0;
  const lim = absenceLimit(c);
  const tasks = c.tasks || [];
  $('#detailBody').innerHTML = `
    <div class="sheet-head">
      <h2 class="detail-title c${c.color ?? 0}">${esc(c.name)}</h2>
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
let pickedColor = 0;

function openEditor(course, notice) {
  editing = course?.id ? course : null;
  const c = { term: state.view.term, year: state.view.year, sessions: 15, ...(course || {}) };
  const f = $('#editForm');
  f.reset();
  $('#editTitle').textContent = editing ? '授業を編集' : '授業を追加';
  $('#deleteCourse').hidden = !editing;
  for (const k of ['name', 'teacher', 'room', 'code', 'credits', 'syllabus', 'manaba', 'sessions', 'memo', 'term', 'category']) {
    if (f.elements[k]) f.elements[k].value = c[k] ?? '';
  }
  if (!c.term) f.elements.term.value = state.view.term;
  pickedSlots = (c.slots || []).map((s) => ({ ...s }));
  pickedColor = c.color ?? nextColor();
  $('#importNotice').hidden = !notice;
  $('#importNotice').textContent = notice || '';
  $('#importBox').open = false;
  $('#pasteText').value = '';
  f.dataset.year = c.year;
  renderSlotPicker();
  renderColorPicker();
  const rooms = [...new Set(state.courses.map((x) => x.room).filter(Boolean))];
  $('#roomList').innerHTML = rooms.map((r) => `<option value="${esc(r)}">`).join('');
  const dlg = $('#editor');
  if (!dlg.open) dlg.showModal();
}

function nextColor() {
  const used = viewCourses().map((c) => c.color);
  for (let i = 0; i < COLORS; i++) if (!used.includes(i)) return i;
  return viewCourses().length % COLORS;
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

function renderColorPicker() {
  let h = '';
  for (let i = 0; i < COLORS; i++) h += `<button type="button" class="swatch c${i}${i === pickedColor ? ' on' : ''}" data-color="${i}" aria-label="色${i + 1}" aria-pressed="${i === pickedColor}"></button>`;
  $('#colorPicker').innerHTML = h;
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
  } else if (b.dataset.color) {
    pickedColor = Number(b.dataset.color);
    renderColorPicker();
  } else if (b.id === 'readPaste') {
    const text = $('#pasteText').value;
    const got = extractCourse(pairsFromText(text), { text });
    const n = fillForm(got);
    toast(n ? `${n}項目を読み取りました。内容を確かめて保存してください` : '読み取れませんでした。項目を手で入れてください');
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
  for (const k of ['name', 'teacher', 'room', 'code', 'credits', 'syllabus', 'term', 'category']) {
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
  if (term !== '集中' && !pickedSlots.length && !confirm('曜日・時限が選ばれていません。「集中講義・時間外」に入れますか？')) return;
  const data = {
    name: v('name'), teacher: v('teacher'), room: v('room'), code: v('code'),
    credits: v('credits') === '' ? '' : Number(v('credits')),
    term, category: v('category'), syllabus: safeUrl(v('syllabus')), manaba: safeUrl(v('manaba')),
    sessions: Number(v('sessions')) || 15, memo: f.elements.memo.value.trim(),
    slots: [...pickedSlots].sort((a, b) => a.d - b.d || a.p - b.p), color: pickedColor,
    year: Number(f.dataset.year) || state.view.year,
  };
  if (editing) Object.assign(editing, data);
  else state.courses.push({ id: uid(), absences: 0, tasks: [], ...data });
  // 保存した授業が見えるように、その年度・学期に切り替える
  if (data.year !== state.view.year || (data.term !== state.view.term && (data.term === '前期' || data.term === '後期'))) {
    state.view.year = data.year;
    if (data.term === '前期' || data.term === '後期') state.view.term = data.term;
  }
  const clash = data.term !== '集中' && data.slots.find((s) => courseAt(s.d, s.p).filter((c) => c.id !== editing?.id && c.name !== data.name).length);
  save(); render();
  $('#editor').close();
  toast(clash ? `保存しました（${DAYS[clash.d]}${clash.p}限がほかの授業と重なっています）` : '保存しました');
});

// ---- 設定 ----
function renderSettings() {
  const s = state.settings;
  $('#showSat').checked = s.showSat;
  $('#showP6').checked = s.showP6;
  $('#manabaUrl').value = s.manaba || '';
  $('#periodEditor').innerHTML = s.periods.map((p, i) => `
    <label><b>${i + 1}限</b><input type="time" data-pi="${i}" data-pj="0" value="${p[0]}"> 〜 <input type="time" data-pi="${i}" data-pj="1" value="${p[1]}"></label>`).join('');
  const bm = bookmarklet();
  $('#bookmarklet').href = bm;
}

// シラバスのページで押すと「見出し→値」の組を集めて、このアプリの #add= に渡す
function bookmarklet() {
  const app = location.origin + location.pathname;
  const src = `(function(){var A=${JSON.stringify(app)},p=[],x='';function s(e){return((e.innerText||e.textContent||'')+'').replace(/\\s+/g,' ').trim()}function g(d){try{d.querySelectorAll('th,dt,td,label,b,strong,span').forEach(function(e){var k=s(e);if(!k||k.length>20)return;var n=e.nextElementSibling;if(!n)return;var v=s(n);if(v&&v.length<300&&p.length<200)p.push([k,v])});x=x||(d.getSelection&&d.getSelection()+'')||(d.body&&d.body.innerText||'').slice(0,1000);for(var i=0;i<d.defaultView.frames.length;i++)g(d.defaultView.frames[i].document)}catch(e){}}g(document);var u=A+'#add='+encodeURIComponent(JSON.stringify({t:document.title,u:location.href,p:p,x:x.slice(0,1000)}));if(!window.open(u,'_blank'))location.href=u})();`;
  return 'javascript:' + src;
}

$('#openSettings').addEventListener('click', () => { renderSettings(); $('#settings').showModal(); });
$('#settings').addEventListener('click', (e) => {
  if (e.target === $('#settings') || e.target.closest('[data-close]')) $('#settings').close();
});
$('#bookmarklet').addEventListener('click', (e) => { e.preventDefault(); toast('ブックマークバーにドラッグしてください'); });
$('#copyBookmarklet').addEventListener('click', () => copy(bookmarklet(), 'コピーしました。ブックマークを作り、URLの欄に貼り付けてください'));
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
    const [d, p] = b.dataset.add.split('-').map(Number);
    openEditor({ slots: [{ d, p }] });
  } else if (b.dataset.id) {
    openDetail(b.dataset.id);
  } else if (b.dataset.term) {
    state.view.term = b.dataset.term;
    save(); render();
  } else if (b.id === 'prevYear' || b.id === 'nextYear') {
    state.view.year += b.id === 'prevYear' ? -1 : 1;
    save(); render();
  } else if (b.id === 'addExtra') {
    openEditor({ term: '集中', slots: [] });
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
  const same = got.code && state.courses.find((c) => c.code === got.code && (!got.year || c.year === got.year));
  if (same) {
    if (got.syllabus && !same.syllabus) { same.syllabus = got.syllabus; save(); render(); }
    openDetail(same.id);
    toast('この授業はもう時間割に入っています');
    return;
  }
  const n = Object.keys(got).filter((k) => k !== 'syllabus').length;
  openEditor({ year: state.view.year, term: state.view.term, sessions: 15, ...got },
    n ? 'シラバスから読み込みました。内容を確かめて保存してください。' : 'シラバスのURLだけ読み込みました。科目名と曜日・時限を入れてください。');
}

render();
handleIncoming();
setInterval(() => { if (!document.hidden) { renderNow(); renderGrid(); } }, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
