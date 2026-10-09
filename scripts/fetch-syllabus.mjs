// 鹿児島大学シラバス検索（syllabus11）から、授業の一覧を集めて data/syllabus-<年度>.json に書く。
// 「＋」を押したときに、そのコマに開講されている授業を候補として出すためのデータ。
//
//   node scripts/fetch-syllabus.mjs            今の年度（とそれより新しく公開されている年度）
//   node scripts/fetch-syllabus.mjs 2026       年度を指定
//
// 相手のサーバーに負担をかけないよう、1回に500件ずつ、1秒以上あけて取りに行く（1年度で10回ほど）。
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'https://syllabus11.kuas.kagoshima-u.ac.jp';
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'data');
const PER_PAGE = 500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DAY_INDEX = { 月: 0, 火: 1, 水: 2, 木: 3, 金: 4, 土: 5, 日: 6 };
const toHalf = (s) => String(s ?? '').replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
const decodeEntities = (s) => s
  .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&amp;/g, '&');

// クッキーを覚えておく小さな仕組み（Laravel のセッションと CSRF のため）
const jar = new Map();
function keepCookies(res) {
  for (const c of res.headers.getSetCookie?.() || []) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
}
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

async function request(url, opts = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { ...opts, headers: { 'User-Agent': 'kadai-jikanwari (timetable app; weekly fetch)', Cookie: cookieHeader(), ...(opts.headers || {}) } });
      keepCookies(res);
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return res;
    } catch (e) {
      if (attempt >= 3) throw e;
      await sleep(5000 * attempt);
    }
  }
}

async function openSearch() {
  const html = await (await request(`${BASE}/showSearch`)).text();
  const token = html.match(/name="csrf-token" content="([^"]+)"/)?.[1];
  const m = html.match(/<user-syllabus-search\s+:data='([^']*)'/);
  if (!token || !m) throw new Error('シラバス検索の画面の作りが変わったようです（csrf-token か :data が見つかりません）');
  return { token, data: JSON.parse(decodeEntities(m[1])) };
}

async function searchPage(token, year, firstRowNo) {
  const body = {
    languageClass: 1, academicYear: year, courseCode: '', programCodes: [], dayCodes: [], timeCodes: [],
    overview: '', syllabusName: '', syllabusNameEn: '', syllabusClassCode: '', formCode: '', directOnlineCode: '',
    teacher: '', workExperienceCode: '', firstRowNo, perPage: String(PER_PAGE), semesterCode: '', yearCodes: [],
  };
  const res = await request(`${BASE}/seachList`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-TOKEN': token, 'X-Requested-With': 'XMLHttpRequest' },
    body: JSON.stringify(body),
  });
  return res.json();
}

// 「月 火」→ "01"、集中・不定などは "x"
const encodeDays = (s) => [...new Set(String(s || '').split(/\s+/).filter(Boolean).map((d) => (d in DAY_INDEX ? String(DAY_INDEX[d]) : 'x')))].join('');
// 「１限 ２限」→ "12"、集中・不定などは "x"
const encodeTimes = (s) => [...new Set(String(s || '').split(/\s+/).filter(Boolean).map((t) => toHalf(t).match(/^(\d)限/)?.[1] || 'x'))].join('');
// 「１年 ２年」→ "12"
const encodeYears = (s) => [...new Set(toHalf(s).match(/\d(?=年)/g) || [])].join('');
const cleanTeacher = (s) => String(s || '').replace(/[（(]代表者?[）)]/g, '').replace(/\s+/g, ' ').trim();

async function fetchYear(token, year, courseList) {
  const rows = [];
  let total = Infinity;
  for (let first = 0; first < total; first += PER_PAGE) {
    const page = await searchPage(token, year, first);
    total = page.searchedCount;
    rows.push(...page.syllabusList);
    console.log(`  ${year}年度: ${rows.length} / ${total}`);
    if (!page.syllabusList.length) break;
    await sleep(1500);
  }
  const depts = {};
  for (const c of courseList) if (c.academic_year === year) depts[c.code] = c.name;
  const sems = [];
  const semIndex = (name) => {
    const n = name || '';
    let i = sems.indexOf(n);
    if (i < 0) { sems.push(n); i = sems.length - 1; }
    return i;
  };
  // [シラバスの番号, 科目名, 担当教員, 開設部局のコード, 学期(sems の番号), 曜日, 時限, 学年]
  const list = rows
    .filter((r) => r.academic_year === year)
    .map((r) => [r.id, r.syllabus_name, cleanTeacher(r.teacher), r.course_code, semIndex(r.semester_name), encodeDays(r.day_name), encodeTimes(r.time_name), encodeYears(r.year_name)])
    .sort((a, b) => a[0] - b[0]);
  return { year, source: `${BASE}/showSearch`, detail: `${BASE}/showDetail/ja/`, fetchedAt: new Date().toISOString(), depts, sems, rows: list };
}

const { token, data } = await openSearch();
const now = new Date();
const currentYear = now.getMonth() < 3 ? now.getFullYear() - 1 : now.getFullYear();
const years = process.argv[2]
  ? [Number(process.argv[2])]
  : data.academicYearList.map((y) => y.academic_year).filter((y) => y >= currentYear).sort();
if (!years.length) throw new Error('取りに行く年度がありません');

fs.mkdirSync(OUT, { recursive: true });
const index = [];
for (const year of years) {
  const result = await fetchYear(token, year, data.courseList);
  if (!result.rows.length) { console.log(`  ${year}年度: 0件なので書き出しません`); continue; }
  fs.writeFileSync(path.join(OUT, `syllabus-${year}.json`), JSON.stringify(result));
  index.push({ year, count: result.rows.length, fetchedAt: result.fetchedAt });
}
// 前に取った年度も一覧に残す
const indexPath = path.join(OUT, 'index.json');
let old = [];
try { old = JSON.parse(fs.readFileSync(indexPath, 'utf8')).years || []; } catch {}
const merged = [...index, ...old.filter((o) => !index.some((n) => n.year === o.year) && fs.existsSync(path.join(OUT, `syllabus-${o.year}.json`)))].sort((a, b) => b.year - a.year);
fs.writeFileSync(indexPath, JSON.stringify({ years: merged }, null, 1) + '\n');
console.log('書き出しました:', merged.map((y) => `${y.year}年度 ${y.count}件`).join(' / '));
