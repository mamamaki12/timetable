// この端末に保存したデータや、読み込んだバックアップのファイルを、アプリが使う形にそろえる。
// ファイルが壊れていたり、わざと細工されていたりしても、画面が崩れたり、
// 中に書かれたスクリプトが動いたりしないように、決まった種類の値だけを残す。

export const TERMS = ['前期', '後期', '通年', '集中'];
const VIEW_TERMS = ['前期', '後期', '集中'];
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DUE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?)?$/;

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
export const isWebUrl = (u) => /^https?:\/\//i.test(String(u || '').trim());

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
// 文字（数は文字にする）。それ以外は空
const str = (v) => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
// min〜max の数（"2026" のような文字も受け取る）。当てはまらなければ null
const num = (v, min, max) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max ? n : null;
};
const int = (v, min, max) => { const n = num(v, min, max); return Number.isInteger(n) ? n : null; };
// 「8:50」「08:50」→「08:50」。時刻でなければ null
const hm = (v) => {
  const m = typeof v === 'string' && v.match(/^(\d{1,2}):(\d{2})$/);
  return m && Number(m[1]) <= 23 && Number(m[2]) <= 59 ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
};

// 曜日（0=月〜5=土）・時限（1〜8。大学院には7・8限もある）のコマ。同じコマは1つにする
export function cleanSlots(list) {
  const out = [];
  for (const s of Array.isArray(list) ? list : []) {
    if (!isObj(s)) continue;
    const d = int(s.d, 0, 5);
    const p = int(s.p, 1, 8);
    if (d === null || p === null || out.some((x) => x.d === d && x.p === p)) continue;
    const slot = { d, p };
    if (typeof s.room === 'string') slot.room = s.room;
    out.push(slot);
  }
  return out;
}

function cleanTasks(list) {
  const seen = new Set();
  const out = [];
  for (const t of Array.isArray(list) ? list : []) {
    if (!isObj(t)) continue;
    const id = typeof t.id === 'string' && ID.test(t.id) && !seen.has(t.id) ? t.id : uid();
    seen.add(id);
    out.push({ id, title: str(t.title), due: typeof t.due === 'string' && DUE.test(t.due) ? t.due : '', done: t.done === true });
  }
  return out;
}

function cleanCourse(c, fallback) {
  const course = {
    id: c.id,
    name: str(c.name), teacher: str(c.teacher), room: str(c.room), code: str(c.code),
    credits: num(c.credits, 0, 999) ?? '',
    category: str(c.category),
    syllabus: isWebUrl(c.syllabus) ? str(c.syllabus).trim() : '',
    sessions: num(c.sessions, 0, 999) || 15,
    memo: str(c.memo),
    year: int(c.year, 2000, 2100) ?? fallback.year,
    term: TERMS.includes(c.term) ? c.term : fallback.term,
    slots: cleanSlots(c.slots),
    start: typeof c.start === 'string' && DATE.test(c.start) ? c.start : '',
    end: typeof c.end === 'string' && DATE.test(c.end) ? c.end : '',
    status: c.status === 'cand' ? 'cand' : 'take',
    absences: int(c.absences, 0, 999) ?? 0,
    tasks: cleanTasks(c.tasks),
  };
  if (str(c.sid)) course.sid = str(c.sid);
  if (str(c.sem)) course.sem = str(c.sem);
  return course;
}

// raw：保存してあったデータ（JSON を読んだもの）。cur：今の年度・学期。periods：標準の授業時間
export function sanitizeState(raw, { cur, periods }) {
  const r = isObj(raw) ? raw : {};
  const s = isObj(r.settings) ? r.settings : {};
  const settings = {
    periods: periods.map((def, i) => {
      const p = Array.isArray(s.periods) ? s.periods[i] : null;
      const a = Array.isArray(p) ? hm(p[0]) : null;
      const b = Array.isArray(p) ? hm(p[1]) : null;
      return a && b ? [a, b] : [...def];
    }),
  };
  // 学部（dept）があるかどうかで、前から使っている人かを見分けるので、無いときは入れない
  for (const k of ['dept', 'prog', 'grade']) if (s[k] !== undefined) settings[k] = str(s[k]);
  if (s.welcomed === true) settings.welcomed = true;
  if (typeof s.lastExport === 'string' && !Number.isNaN(Date.parse(s.lastExport))) settings.lastExport = s.lastExport;

  const v = isObj(r.view) ? r.view : {};
  const view = { year: int(v.year, 2000, 2100) ?? cur.year, term: VIEW_TERMS.includes(v.term) ? v.term : cur.term };

  const seen = new Set();
  const courses = [];
  for (const c of Array.isArray(r.courses) ? r.courses : []) {
    if (!isObj(c)) continue;
    let id = typeof c.id === 'string' && ID.test(c.id) ? c.id : uid();
    while (seen.has(id)) id = uid();
    seen.add(id);
    courses.push(cleanCourse({ ...c, id }, cur));
  }
  return { settings, view, courses };
}
