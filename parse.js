// シラバスのページから、時間割に入れる情報を読み取る。
// ブックマークレットは「見出し→値」の組を集めて送ってくるだけで、ここで項目を見分ける
// （シラバスの画面が変わっても、こちらを直せば済むように）。

export const DAYS = ['月', '火', '水', '木', '金', '土'];

// 全角の数字・英字・空白を半角にする
export function toHalf(s) {
  return String(s ?? '')
    .replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[－‐―ー](?=\s*\d)/g, '-')
    .replace(/／/g, '/')
    .replace(/　/g, ' ');
}

// 「月1」「月曜日 3・4時限」「月3-4」「火1,木1」「水曜2限」などを [{d, p}] にする（d: 0=月）
export function parseSlots(text) {
  const t = toHalf(text);
  const out = [];
  const seen = new Set();
  const re = /([月火水木金土])(?:曜日?)?\s*[/:：]?\s*(?:第\s*)?([1-7](?:\s*(?:[-~〜～・,、]|から)\s*[1-7])*)\s*(?:時限|限|講時)?/g;
  for (const m of t.matchAll(re)) {
    const d = DAYS.indexOf(m[1]);
    const nums = [];
    const parts = m[2].match(/[1-7]|[-~〜～]|から/g);
    for (let i = 0; i < parts.length; i++) {
      const n = Number(parts[i]);
      if (Number.isNaN(n)) continue;
      const prev = parts[i - 1];
      if ((prev === '-' || prev === '~' || prev === '〜' || prev === '～' || prev === 'から') && nums.length) {
        const from = nums[nums.length - 1];
        for (let p = from + 1; p <= n; p++) nums.push(p);
      } else {
        nums.push(n);
      }
    }
    for (const p of nums) {
      const key = `${d}-${p}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ d, p });
      }
    }
  }
  return out;
}

// 学期の書き方を「前期・後期・通年・集中」にそろえる
export function parseTerm(text) {
  const t = toHalf(text);
  if (/集中/.test(t)) return '集中';
  if (/通年/.test(t)) return '通年';
  if (/後期|後学期|秋|第?[34]\s*(?:Q|クォーター|ターム)|[34]Q/i.test(t)) return '後期';
  if (/前期|前学期|春|第?[12]\s*(?:Q|クォーター|ターム)|[12]Q/i.test(t)) return '前期';
  return '';
}

// 見出しの言葉 → 項目。上から順に見て、最初に当たった値を使う
const LABELS = [
  ['name', /^(?:授業科目名?|科目名(?:称)?|授業名|講義名|開講科目名)(?:\s*[(（]和[)）])?$/],
  ['teacher', /^(?:担当教員(?:名)?|主担当教員|教員名|担当者|授業担当(?:教員)?|代表教員)$/],
  ['room', /^(?:講義室|教室|授業場所|開講場所|講義室名?|教室名)$/],
  ['code', /^(?:時間割コード|時間割番号|授業コード|科目コード|講義コード|科目番号|授業番号)$/],
  ['credits', /^(?:単位数?|単位数\s*[(（].*[)）])$/],
  ['slots', /^(?:曜日\s*[・/]?\s*時限|曜日時限|曜限|曜日・校時|開講曜限)$/],
  // 鹿大のシラバス検索では「曜日」と「時限」が別の欄
  ['day', /^曜日$/],
  ['time', /^時限$/],
  ['sessions', /^(?:授業回数|回数)$/],
  ['dept', /^(?:開設部局|開講部局)$/],
  ['term', /^(?:学期|開講学期|開講期|開講時期|学期区分)$/],
  ['year', /^(?:開設年度|開講年度|年度)$/],
  ['category', /^(?:科目区分|授業区分|区分)$/],
];

function cleanLabel(k) {
  return toHalf(k).replace(/[\s:：*＊※【】[\]]/g, '').trim();
}

function cleanValue(v) {
  return String(v ?? '').replace(/\s+/g, ' ').trim();
}

// 貼り付けられた文字から「見出し→値」の組を作る（「見出し<TAB>値」「見出し：値」「見出し の次の行が値」）
export function pairsFromText(text) {
  const lines = String(text ?? '').split(/\r?\n/).map((l) => l.trim());
  const pairs = [];
  const isLabel = (s) => LABELS.some(([, re]) => re.test(cleanLabel(s)));
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const tab = line.split('\t').map((s) => s.trim()).filter(Boolean);
    if (tab.length >= 2) {
      // 「見出し 値 見出し 値」のように1行に並ぶ表にも対応する
      for (let j = 0; j + 1 < tab.length; j++) {
        if (isLabel(tab[j])) pairs.push([tab[j], tab[j + 1]]);
      }
      if (!isLabel(tab[0])) pairs.push([tab[0], tab.slice(1).join(' ')]);
      continue;
    }
    const colon = line.match(/^([^:：]{1,16})[:：]\s*(.+)$/);
    if (colon) {
      pairs.push([colon[1], colon[2]]);
      continue;
    }
    if (line.length <= 16 && isLabel(line)) {
      let j = i + 1;
      while (j < lines.length && !lines[j]) j++;
      if (j < lines.length && !isLabel(lines[j])) {
        pairs.push([line, lines[j]]);
        i = j;
      }
    }
  }
  return pairs;
}

// 曜日の並びと時限の並びからコマを作る。どちらかが1つなら全部の組み合わせ。
// 両方が複数（例：体育で「月 火 水 木」「1限 2限 3限 4限」）のときは組み合わせが分からないので空にする
export function slotsFromDayTime(days, times) {
  const ds = days.map((x) => DAYS.indexOf(toHalf(x).trim().charAt(0))).filter((d) => d >= 0);
  const ps = times.map((x) => Number(toHalf(x).match(/[1-7]/)?.[0])).filter(Boolean);
  if (!ds.length || !ps.length) return { slots: [], ambiguous: false };
  if (ds.length > 1 && ps.length > 1) return { slots: [], ambiguous: true };
  const slots = [];
  for (const d of ds) for (const p of ps) slots.push({ d, p });
  return { slots, ambiguous: false };
}

const splitList = (v) => String(v || '').split(/[\s,、・／/]+/).filter(Boolean);

// 鹿大シラバス検索の詳しいページでは、科目名は表の上の見出し（「＜検索キー＞」の前、英語名の上）
function nameFromHeading(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const i = lines.findIndex((l) => /^[<＜]\s*検索キー\s*[>＞]$/.test(l));
  if (i < 0) return '';
  for (let j = i - 1; j >= 0 && j >= i - 4; j--) {
    const l = lines[j];
    if (/検索結果に戻る|PDF|ダウンロード|^日本語$|^English$/.test(l)) break;
    if (/[\u3040-\u30ff\u4e00-\u9fff]/.test(l)) return l;
  }
  return '';
}

// ページの題名から科目名らしいところを取り出す
function nameFromTitle(title) {
  const t = cleanValue(title)
    .replace(/鹿児島大学|シラバス(?:検索|参照|照会|詳細)?|Kagoshima\s*U(?:niversity)?|Syllabus/gi, '')
    .replace(/^[\s\-|｜:：]+|[\s\-|｜:：]+$/g, '')
    .trim();
  return t.length >= 2 && t.length <= 60 ? t : '';
}

// 「見出し→値」の組（とページの題名・URL）から、科目の情報を作る
export function extractCourse(pairs, { title = '', url = '', text = '' } = {}) {
  const found = {};
  for (const [rawK, rawV] of pairs || []) {
    const k = cleanLabel(rawK);
    const v = cleanValue(rawV);
    if (!k || !v) continue;
    for (const [field, re] of LABELS) {
      if (found[field] === undefined && re.test(k)) {
        found[field] = v;
        break;
      }
    }
  }
  const course = {};
  if (found.name) course.name = found.name.replace(/\s*[(（][A-Za-z][^)）]*[)）]\s*$/, '');
  else if (nameFromHeading(text)) course.name = nameFromHeading(text);
  else if (nameFromTitle(title)) course.name = nameFromTitle(title);
  if (found.teacher) course.teacher = found.teacher.replace(/[（(]代表者?[）)]/g, '').trim().replace(/[、,]\s*/g, '・');
  if (found.room) course.room = found.room;
  if (found.code) course.code = toHalf(found.code).replace(/\s/g, '');
  if (found.credits) {
    const n = toHalf(found.credits).match(/\d+(?:\.\d+)?/);
    if (n) course.credits = Number(n[0]);
  }
  if (found.category) course.category = found.category;
  if (found.dept) course.category = /共通教育/.test(found.dept) ? '共通教育' : /教職|教師教育/.test(found.dept) ? '教職' : '専門';
  if (found.sessions) {
    const n = toHalf(found.sessions).match(/\d+/);
    if (n) course.sessions = Number(n[0]);
  }

  // 曜日・時限は、見出しが見つからなければページ全体からも探す
  let slots = found.slots ? parseSlots(found.slots) : [];
  if (!slots.length && found.day && found.time) {
    const r = slotsFromDayTime(splitList(found.day), splitList(found.time));
    slots = r.slots;
    if (r.ambiguous) course.slotNote = `曜日「${found.day}」・時限「${found.time}」`;
    if (/集中/.test(found.day + found.time)) course.term = '集中';
  }
  const termText = found.term || '';
  if (!slots.length && termText) slots = parseSlots(termText);
  if (!slots.length && !course.slotNote && text && !(found.day || found.time)) slots = parseSlots(text.slice(0, 3000)).slice(0, 4);
  if (slots.length) course.slots = slots;

  const term = parseTerm(termText) || (found.slots ? parseTerm(found.slots) : '');
  if (term) course.term = term;
  if (/集中/.test(found.slots || '') || course.term === '集中' || /集中/.test(found.day || '')) course.term = '集中';

  if (found.year) {
    const y = toHalf(found.year).match(/20\d\d/);
    if (y) course.year = Number(y[0]);
  }
  if (/^https?:\/\//.test(url)) course.syllabus = url;
  return course;
}

// 鹿大シラバス検索の詳しいページに埋め込まれたデータ（ブックマークレットが k として送る）から科目を作る
export function courseFromKadai(k, url = '') {
  const course = {};
  if (k.n) course.name = String(k.n).trim();
  const teachers = [k.t, k.ct].map((t) => String(t || '').replace(/[（(]代表者?[）)]/g, '').trim()).filter(Boolean);
  if (teachers.length) course.teacher = teachers.join('・').replace(/\s*[、,]\s*/g, '・');
  const cr = toHalf(k.c).match(/\d+(?:\.\d+)?/);
  if (cr) course.credits = Number(cr[0]);
  const ls = toHalf(k.l).match(/\d+/);
  if (ls) course.sessions = Number(ls[0]);
  if (k.dep) course.category = /共通教育/.test(k.dep) ? '共通教育' : /教師教育/.test(k.dep) ? '教職' : '専門';
  const term = parseTerm(`${k.s || ''} ${k.tm || ''}`);
  if (term) course.term = term;
  const days = (k.d || []).map(String);
  const times = (k.h || []).map(String);
  if ([...days, ...times].some((x) => /集中/.test(x))) {
    course.term = '集中';
  } else {
    const r = slotsFromDayTime(days, times);
    if (r.slots.length) course.slots = r.slots;
    if (r.ambiguous) course.slotNote = `曜日「${days.join(' ')}」・時限「${times.join(' ')}」`;
  }
  if (Number(k.y)) course.year = Number(k.y);
  if (k.id) course.sid = String(k.id);
  if (/^https?:\/\//.test(url)) course.syllabus = url;
  return course;
}

// ブックマークレットが送ってくる #add=... を読む
export function decodeImport(hash) {
  const m = String(hash || '').match(/[#&]add=([^&]*)/);
  if (!m) return null;
  try {
    const data = JSON.parse(decodeURIComponent(m[1]));
    if (data.k) return courseFromKadai(data.k, data.u || '');
    return extractCourse(data.p || [], { title: data.t || '', url: data.u || '', text: data.x || '' });
  } catch {
    return null;
  }
}
