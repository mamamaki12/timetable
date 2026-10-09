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
  ['slots', /^(?:曜日\s*[・/]?\s*時限|曜日時限|曜限|曜日・校時|開講曜限|曜日|時限)$/],
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
  else if (nameFromTitle(title)) course.name = nameFromTitle(title);
  if (found.teacher) course.teacher = found.teacher.replace(/[、,]\s*/g, '・');
  if (found.room) course.room = found.room;
  if (found.code) course.code = toHalf(found.code).replace(/\s/g, '');
  if (found.credits) {
    const n = toHalf(found.credits).match(/\d+(?:\.\d+)?/);
    if (n) course.credits = Number(n[0]);
  }
  if (found.category) course.category = found.category;

  // 曜日・時限は、見出しが見つからなければページ全体からも探す
  let slots = found.slots ? parseSlots(found.slots) : [];
  const termText = found.term || '';
  if (!slots.length && termText) slots = parseSlots(termText);
  if (!slots.length && text) slots = parseSlots(text.slice(0, 3000)).slice(0, 4);
  if (slots.length) course.slots = slots;

  const term = parseTerm(termText) || (found.slots ? parseTerm(found.slots) : '');
  if (term) course.term = term;
  if (/集中/.test(found.slots || '')) course.term = '集中';

  if (found.year) {
    const y = toHalf(found.year).match(/20\d\d/);
    if (y) course.year = Number(y[0]);
  }
  if (/^https?:\/\//.test(url)) course.syllabus = url;
  return course;
}

// ブックマークレットが送ってくる #add=... を読む
export function decodeImport(hash) {
  const m = String(hash || '').match(/[#&]add=([^&]*)/);
  if (!m) return null;
  try {
    const data = JSON.parse(decodeURIComponent(m[1]));
    return extractCourse(data.p || [], { title: data.t || '', url: data.u || '', text: data.x || '' });
  } catch {
    return null;
  }
}
