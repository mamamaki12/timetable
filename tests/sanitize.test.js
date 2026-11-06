import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sanitizeState, cleanSlots } from '../sanitize.js';

const PERIODS = [['08:50', '10:20'], ['10:30', '12:00'], ['12:50', '14:20'], ['14:30', '16:00'], ['16:10', '17:40'], ['17:50', '19:20']];
const opts = { cur: { year: 2026, term: '後期' }, periods: PERIODS };
const XSS = '<img src=x onerror=alert(1)>';

test('ふつうのデータは、そのまま読める', () => {
  const course = {
    id: 'abc123xyz9', sid: '34528', name: '線形代数', teacher: '鹿大 太郎', room: '共通教育棟1号館 111', code: '112345', credits: 2,
    category: '共通教育', syllabus: 'https://syllabus11.kuas.kagoshima-u.ac.jp/showDetail/ja/34528', sessions: 15, memo: 'メモ',
    year: 2026, term: '後期', slots: [{ d: 1, p: 2, room: '211' }, { d: 3, p: 2 }], start: '', end: '', status: 'cand', absences: 3,
    tasks: [{ id: 't1', title: 'レポート', due: '2026-11-20T23:59', done: false }, { id: 't2', title: '小テスト', due: '2026-11-21', done: true }],
  };
  const intensive = { ...course, id: 'int1', sid: undefined, term: '集中', sem: '前期', slots: [], start: '2026-08-20', end: '2026-08-23', credits: 0.5, sessions: 7.5, status: 'take', absences: 0, tasks: [] };
  delete intensive.sid;
  const raw = { settings: { periods: PERIODS, dept: '17', prog: 'l044', grade: '1', welcomed: true, lastExport: '2026-10-01T00:00:00.000Z' }, view: { year: 2026, term: '後期' }, courses: [course, intensive] };
  const s = sanitizeState(JSON.parse(JSON.stringify(raw)), opts);
  assert.deepEqual(s, raw);
});

test('細工したバックアップの値は、画面に入れても安全な形にする', () => {
  const s = sanitizeState({
    settings: { periods: [[XSS, '10:20'], ['10:30', '12:00']], dept: 17, welcomed: 'yes', lastExport: XSS, extra: XSS },
    view: { year: XSS, term: XSS },
    courses: [
      { id: `"><b>`, name: XSS, year: '2026', term: '後期', absences: XSS, sessions: XSS, credits: XSS, syllabus: 'javascript:alert(1)',
        slots: [{ d: 0, p: XSS }, { d: '1', p: '2' }, { d: 9, p: 1 }, { d: 1, p: 2 }, { d: 2, p: 7 }, XSS],
        tasks: [{ id: XSS, title: 'レポート', due: XSS, done: 'true' }, XSS], start: XSS, status: XSS },
      XSS, null, ['配列'],
      { id: 'same', name: 'A' }, { id: 'same', name: 'B' },
    ],
  }, opts);
  assert.deepEqual(s.view, { year: 2026, term: '後期' });
  assert.deepEqual(s.settings.periods, PERIODS); // おかしな時刻は標準に、足りない時限も標準で埋める
  assert.equal(s.settings.dept, '17');
  assert.equal(s.settings.welcomed, undefined);
  assert.equal(s.settings.lastExport, undefined);
  assert.equal(s.settings.extra, undefined);
  assert.equal(s.courses.length, 3); // 授業でないものは捨てる
  const [c, a, b] = s.courses;
  assert.match(c.id, /^[A-Za-z0-9_-]+$/);
  assert.equal(c.name, XSS); // 科目名などの文字は、表示するときに必ず置き換える（esc）ので、そのまま
  assert.equal(c.year, 2026);
  assert.equal(c.absences, 0);
  assert.equal(c.sessions, 15);
  assert.equal(c.credits, '');
  assert.equal(c.syllabus, '');
  assert.equal(c.start, '');
  assert.equal(c.status, 'take');
  assert.deepEqual(c.slots, [{ d: 1, p: 2 }, { d: 2, p: 7 }]);
  assert.equal(c.tasks.length, 1);
  assert.match(c.tasks[0].id, /^[A-Za-z0-9_-]+$/);
  assert.equal(c.tasks[0].due, '');
  assert.equal(c.tasks[0].done, false);
  // 同じ番号の授業は、片方の番号を付け直す
  assert.equal(a.id, 'same');
  assert.notEqual(b.id, 'same');
});

test('保存したデータが無い・壊れているときは、今の年度・学期から始める', () => {
  for (const raw of [null, undefined, 'abc', 123, [], {}]) {
    const s = sanitizeState(raw, opts);
    assert.deepEqual(s.view, { year: 2026, term: '後期' });
    assert.deepEqual(s.courses, []);
    assert.deepEqual(s.settings, { periods: PERIODS });
  }
});

test('コマは月〜土・1〜8限だけ', () => {
  assert.deepEqual(cleanSlots([{ d: 5, p: 8 }, { d: 6, p: 1 }, { d: 0, p: 0 }, { d: 0, p: 9 }, { d: 0.5, p: 1 }]), [{ d: 5, p: 8 }]);
  assert.deepEqual(cleanSlots('月1'), []);
});

// app.js が読み込むファイルは、公開（pages.yml）とオフライン用の保存（sw.js）の両方に入っていること
test('app.js が読み込むファイルは、すべて公開・オフライン用に入っている', () => {
  const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
  const imports = [...read('app.js').matchAll(/from '\.\/([\w.-]+\.js)'/g)].map((m) => m[1]);
  assert.ok(imports.includes('parse.js') && imports.includes('sanitize.js'));
  const pages = read('.github/workflows/pages.yml');
  const sw = read('sw.js');
  for (const f of ['app.js', ...imports]) {
    assert.match(pages, new RegExp(`cp [^\\n]*\\b${f.replace('.', '\\.')}\\b`), `pages.yml に ${f} がない`);
    assert.ok(sw.includes(`'${f}'`), `sw.js の FILES に ${f} がない`);
  }
});
