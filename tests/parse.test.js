import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSlots, parseTerm, pairsFromText, extractCourse, decodeImport, toHalf } from '../parse.js';

test('曜日・時限のいろいろな書き方', () => {
  assert.deepEqual(parseSlots('月1'), [{ d: 0, p: 1 }]);
  assert.deepEqual(parseSlots('水曜日 3時限'), [{ d: 2, p: 3 }]);
  assert.deepEqual(parseSlots('金3-4'), [{ d: 4, p: 3 }, { d: 4, p: 4 }]);
  assert.deepEqual(parseSlots('木曜 2〜4限'), [{ d: 3, p: 2 }, { d: 3, p: 3 }, { d: 3, p: 4 }]);
  assert.deepEqual(parseSlots('火1,木1'), [{ d: 1, p: 1 }, { d: 3, p: 1 }]);
  assert.deepEqual(parseSlots('月曜3・4時限'), [{ d: 0, p: 3 }, { d: 0, p: 4 }]);
  assert.deepEqual(parseSlots('月／１'), [{ d: 0, p: 1 }]);
  assert.deepEqual(parseSlots('土２限'), [{ d: 5, p: 2 }]);
  assert.deepEqual(parseSlots('集中'), []);
});

test('学期をそろえる', () => {
  assert.equal(parseTerm('前期'), '前期');
  assert.equal(parseTerm('後期'), '後期');
  assert.equal(parseTerm('第3クォーター'), '後期');
  assert.equal(parseTerm('1Q'), '前期');
  assert.equal(parseTerm('前期集中'), '集中');
  assert.equal(parseTerm('通年'), '通年');
  assert.equal(parseTerm(''), '');
});

test('全角を半角に', () => {
  assert.equal(toHalf('ＡＢ１２３　４'), 'AB123 4');
});

test('タブ区切りの表をコピーしたものを読む', () => {
  const text = [
    '開設年度\t2026',
    '時間割コード\t１１２３４５\t単位数\t2',
    '授業科目名\t線形代数Ⅰ',
    '英語科目名\tLinear Algebra I',
    '担当教員\t鹿大 太郎、桜島 花子',
    '学期\t後期\t曜日・時限\t火2',
    '講義室\t共通教育棟2号館 211',
  ].join('\n');
  const c = extractCourse(pairsFromText(text), { text });
  assert.equal(c.name, '線形代数Ⅰ');
  assert.equal(c.code, '112345');
  assert.equal(c.credits, 2);
  assert.equal(c.teacher, '鹿大 太郎・桜島 花子');
  assert.equal(c.term, '後期');
  assert.deepEqual(c.slots, [{ d: 1, p: 2 }]);
  assert.equal(c.room, '共通教育棟2号館 211');
  assert.equal(c.year, 2026);
});

test('見出しの次の行に値があるコピーも読む', () => {
  const text = '科目名\n\n有機化学\n担当教員\n指宿 一郎\n曜日時限\n月3-4\n開講学期\n前期\n';
  const c = extractCourse(pairsFromText(text), { text });
  assert.equal(c.name, '有機化学');
  assert.equal(c.teacher, '指宿 一郎');
  assert.deepEqual(c.slots, [{ d: 0, p: 3 }, { d: 0, p: 4 }]);
  assert.equal(c.term, '前期');
});

test('「見出し：値」も読む', () => {
  const c = extractCourse(pairsFromText('科目名：日本国憲法\n担当教員：霧島 次郎\n曜日・時限：木5'));
  assert.equal(c.name, '日本国憲法');
  assert.deepEqual(c.slots, [{ d: 3, p: 5 }]);
});

test('英語科目名は科目名と取り違えない', () => {
  const c = extractCourse([['英語科目名', 'Chemistry'], ['科目名', '化学']]);
  assert.equal(c.name, '化学');
});

test('科目名が見つからなければページの題名から', () => {
  const c = extractCourse([], { title: '鹿児島大学シラバス - 微分積分学', url: 'https://syllabus11.kuas.kagoshima-u.ac.jp/x' });
  assert.equal(c.name, '微分積分学');
  assert.equal(c.syllabus, 'https://syllabus11.kuas.kagoshima-u.ac.jp/x');
});

test('集中講義', () => {
  const c = extractCourse([['科目名', '野外実習'], ['曜日・時限', '集中']]);
  assert.equal(c.term, '集中');
  assert.equal(c.slots, undefined);
});

test('javascript: のURLはシラバスとして受け取らない', () => {
  const c = extractCourse([], { url: 'javascript:alert(1)' });
  assert.equal(c.syllabus, undefined);
});

test('ブックマークレットの #add= を読む', () => {
  const data = { t: 'シラバス', u: 'https://syllabus11.kuas.kagoshima-u.ac.jp/a?b=1', p: [['授業科目名', '統計学'], ['曜日・時限', '金1']], x: '' };
  const c = decodeImport('#add=' + encodeURIComponent(JSON.stringify(data)));
  assert.equal(c.name, '統計学');
  assert.deepEqual(c.slots, [{ d: 4, p: 1 }]);
  assert.equal(c.syllabus, data.u);
  assert.equal(decodeImport('#add=%E3%81'), null);
  assert.equal(decodeImport(''), null);
});
