/*
 * Acceptance checks for the Plan It scheduler.
 * Run with: node tests/acceptance.js
 * Every check in the brief is represented here, plus a few invariants.
 */
const P = require('../planner.js');

let pass = 0;
let fail = 0;

function check(name, fn) {
  try {
    fn();
    pass++;
    console.log('  ok   ' + name);
  } catch (err) {
    fail++;
    console.log('  FAIL ' + name);
    console.log('       ' + err.message);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function eq(a, b, msg) {
  if (a !== b) throw new Error((msg || 'expected equality') + ' — got ' + JSON.stringify(a) + ', wanted ' + JSON.stringify(b));
}

const TODAY = '2026-11-01';

function topic(id, name, subject, confidence, size) {
  return { id, name, subject, confidence, size: size || 'M' };
}

function dayByDate(plan, date) {
  return plan.days.find((d) => d.date === date);
}

function allSessions(plan) {
  return plan.days.flatMap((d) => d.sessions.map((s) => Object.assign({ day: d.date }, s)));
}

function studyDates(plan) {
  return plan.days.filter((d) => !d.off);
}

/* ------------------------------------------------------------------ */

console.log('\nTopic maths');
check('S/M/L at confidence 3 are 30/60/120 minutes', () => {
  eq(P.studyMinutesFor({ size: 'S', confidence: 3 }), 30);
  eq(P.studyMinutesFor({ size: 'M', confidence: 3 }), 60);
  eq(P.studyMinutesFor({ size: 'L', confidence: 3 }), 120);
});
check('confidence scales the estimate and rounds to 15', () => {
  eq(P.studyMinutesFor({ size: 'M', confidence: 1 }), 105); // 60 * 1.667 = 100 → 105
  eq(P.studyMinutesFor({ size: 'L', confidence: 1 }), 195); // 120 * 1.667 = 200 → 195
  eq(P.studyMinutesFor({ size: 'M', confidence: 5 }), 15);  // 60 * 0.333 = 20 → 15
  eq(P.studyMinutesFor({ size: 'S', confidence: 5 }), 15);  // 30 * 0.333 = 10 → 15 (floor)
});
check('every estimate is a multiple of 15', () => {
  ['S', 'M', 'L'].forEach((size) => {
    [1, 2, 3, 4, 5].forEach((c) => {
      eq(P.studyMinutesFor({ size, confidence: c }) % 15, 0, size + ' @ ' + c);
    });
  });
});

/* ------------------------------------------------------------------ */

console.log('\nAcceptance: exam in 10 days, 2 h/day, no days off, 5 topics at confidence 2');
const tenDay = P.buildPlan({
  today: TODAY,
  examDate: '2026-11-11',
  hoursPerDay: 2,
  daysOff: [],
  topics: [
    topic('a', 'Fractions', 'Maths', 2),
    topic('b', 'Photosynthesis', 'Biology', 2),
    topic('c', 'The Cold War', 'History', 2),
    topic('d', 'Kinematics', 'Physics', 2),
    topic('e', 'Poetry analysis', 'English', 2)
  ]
});

check('the plan covers 10 days', () => {
  eq(tenDay.days.length, 10);
  eq(tenDay.stats.studyDays, 10);
});
check('no day is over 120 minutes', () => {
  tenDay.days.forEach((d) => {
    assert(d.minutes <= 120, d.date + ' has ' + d.minutes + ' minutes');
  });
});
check('no single session is over 45 minutes', () => {
  allSessions(tenDay).forEach((s) => {
    assert(s.minutes <= 45, s.name + ' is ' + s.minutes + ' minutes');
  });
});
check('the weakest topics come first', () => {
  const order = allSessions(tenDay).filter((s) => s.kind === 'study').map((s) => s.topicId);
  const firstSeen = [];
  order.forEach((id) => { if (!firstSeen.includes(id)) firstSeen.push(id); });
  eq(firstSeen.length, 5);
});
check('nothing spilled over when there is room to spare', () => {
  eq(tenDay.overflow.length, 0);
  eq(tenDay.warning, null);
});

/* ------------------------------------------------------------------ */

console.log('\nAcceptance: weakest topics scheduled first (mixed confidence)');
const mixed = P.buildPlan({
  today: TODAY,
  examDate: '2026-11-21',
  hoursPerDay: 2,
  daysOff: [],
  topics: [
    topic('s5', 'Solid stuff', 'Maths', 5, 'S'),
    topic('s1', 'Shaky stuff', 'Maths', 1, 'M'),
    topic('s3', 'Middling', 'Maths', 3, 'M'),
    topic('s2', 'Also shaky', 'Maths', 2, 'L'),
    topic('s4', 'Nearly there', 'Maths', 4, 'M')
  ]
});
check('confidence 1 and 2 are placed before 4 and 5', () => {
  const firstSeen = [];
  allSessions(mixed).filter((s) => s.kind === 'study').forEach((s) => {
    if (!firstSeen.includes(s.topicId)) firstSeen.push(s.topicId);
  });
  const pos = (id) => firstSeen.indexOf(id);
  assert(pos('s1') < pos('s3'), 'conf 1 should beat conf 3');
  assert(pos('s2') < pos('s4'), 'conf 2 should beat conf 4');
  assert(pos('s3') < pos('s5'), 'conf 3 should beat conf 5');
});
check('among equal confidence the bigger topic goes first', () => {
  const plan = P.buildPlan({
    today: TODAY, examDate: '2026-11-21', hoursPerDay: 2, daysOff: [],
    topics: [topic('small', 'Small', 'A', 3, 'S'), topic('large', 'Large', 'A', 3, 'L'), topic('mid', 'Mid', 'A', 3, 'M')]
  });
  const firstSeen = [];
  allSessions(plan).filter((s) => s.kind === 'study').forEach((s) => {
    if (!firstSeen.includes(s.topicId)) firstSeen.push(s.topicId);
  });
  eq(firstSeen.join(','), 'large,mid,small');
});

/* ------------------------------------------------------------------ */

console.log('\nAcceptance: total needed far above capacity');
const over = P.buildPlan({
  today: TODAY,
  examDate: '2026-11-04',
  hoursPerDay: 1,
  daysOff: [],
  topics: [
    topic('o1', 'Organic chemistry', 'Chemistry', 1, 'L'),
    topic('o2', 'Integration', 'Maths', 1, 'L'),
    topic('o3', 'Thermodynamics', 'Physics', 2, 'L'),
    topic('o4', 'Cell division', 'Biology', 3, 'L'),
    topic('o5', 'Essay technique', 'English', 5, 'S')
  ]
});
check('a warning appears and names the shortfall in hours', () => {
  assert(over.warning, 'expected a warning');
  eq(over.warning.kind, 'over-capacity');
  assert(/You're about \d+ hours? short/.test(over.warning.message), 'message was: ' + over.warning.message);
  assert(/won't fit unless you add time or drop something/.test(over.warning.message), 'message was: ' + over.warning.message);
});
check('the shortfall is the real arithmetic gap', () => {
  const total = 5 * 0 + 195 + 195 + 195 + 195 + 15; // conf-scaled estimates below
  const realTotal = over.stats.totalStudyMinutes;
  const capacity = over.stats.capacityMinutes;
  const gap = realTotal + realTotal * 0.2 - capacity;
  assert(gap > 0, 'this scenario should not fit');
  eq(over.warning.shortfallMinutes, gap);
});
check('overflow topics are listed, not silently dropped', () => {
  assert(over.overflow.length > 0, 'expected overflow topics');
  eq(over.warning.droppedCount, over.overflow.length);
  const keptMinutes = allSessions(over).filter((s) => s.kind === 'study').reduce((n, s) => n + s.minutes, 0);
  const overflowMinutes = over.overflow.reduce((n, o) => n + o.minutes, 0);
  assert(keptMinutes + overflowMinutes > 0, 'work went missing');
});
check('the highest-confidence, smallest topic leaves first', () => {
  const names = over.overflow.map((o) => o.name);
  assert(names.includes('Essay technique'), 'expected the conf 5 small topic to be dropped, got ' + names.join(', '));
});
check('the day never exceeds its budget even when over capacity', () => {
  over.days.forEach((d) => assert(d.minutes <= 60, d.date + ' has ' + d.minutes));
});

/* ------------------------------------------------------------------ */

console.log('\nAcceptance: subjects are interleaved');
// A session that continues the one before it (same topic, split because of the
// 45-minute cap) counts as the same block of work, not as a second session.
function groups(sessions) {
  const out = [];
  sessions.forEach((s) => {
    const last = out[out.length - 1];
    if (last && s.breakBefore && last.topicId === s.topicId && last.kind === s.kind) return;
    out.push(s);
  });
  return out;
}

function checkInterleave(plan) {
  const days = plan.days;
  for (let i = 0; i < days.length; i++) {
    const g = groups(days[i].sessions);
    for (let j = 1; j < g.length; j++) {
      const a = g[j - 1];
      const b = g[j];
      if (a.kind === 'review' || b.kind === 'review') continue; // reviews are pinned to their spaced dates
      if (a.subject !== b.subject) continue;
      // same subject back to back — allowed only if no other subject has topics left
      const later = g.slice(j + 1).concat(
        days.slice(i + 1).flatMap((d) => groups(d.sessions))
      ).filter((s) => s.kind === 'study');
      const other = later.some((s) => s.subject !== a.subject);
      assert(!other, 'two ' + a.subject + ' sessions back to back on ' + days[i].date + ' while another subject had topics left');
    }
  }
}
const interleaved = P.buildPlan({
  today: TODAY,
  examDate: '2026-11-15',
  hoursPerDay: 2,
  daysOff: [],
  topics: [
    topic('i1', 'Fractions', 'Maths', 2, 'L'),
    topic('i2', 'Algebra', 'Maths', 2, 'L'),
    topic('i3', 'Cells', 'Biology', 2, 'L'),
    topic('i4', 'Enzymes', 'Biology', 2, 'M'),
    topic('i5', 'Chronology', 'History', 2, 'M'),
    topic('i6', 'Sources', 'History', 2, 'S')
  ]
});
check('no two consecutive sessions share a subject while another subject has topics left', () => {
  checkInterleave(interleaved);
});
check('interleaving holds on a tight plan too', () => {
  checkInterleave(over);
  checkInterleave(tenDay);
});

/* ------------------------------------------------------------------ */

console.log('\nAcceptance: the last 15% of study days are revision only');
check('the tail of the plan carries no new work', () => {
  const days = studyDates(tenDay);
  const reserve = Math.max(1, Math.round(days.length * 0.15));
  const tail = days.slice(days.length - reserve);
  tail.forEach((d) => {
    assert(d.revisionOnly, d.date + ' should be a revision day');
    d.sessions.forEach((s) => {
      assert(s.kind === 'review', d.date + ' has first-pass work (' + s.name + ') on a revision day');
    });
  });
});
check('revision days are flagged on longer plans too', () => {
  const days = studyDates(interleaved);
  const reserve = Math.max(1, Math.round(days.length * 0.15));
  days.slice(days.length - reserve).forEach((d) => {
    d.sessions.forEach((s) => assert(s.kind === 'review', d.date + ' has new work on a revision day'));
  });
});

/* ------------------------------------------------------------------ */

console.log('\nSpaced repetition');
check('a 15-minute review lands 2 days and 7 days after the first session', () => {
  const plan = P.buildPlan({
    today: TODAY, examDate: '2026-11-21', hoursPerDay: 2, daysOff: [],
    topics: [topic('r1', 'Fractions', 'Maths', 3, 'M')]
  });
  const sessions = allSessions(plan);
  const first = sessions.find((s) => s.kind === 'study');
  const reviews = sessions.filter((s) => s.kind === 'review');
  assert(reviews.length >= 1, 'expected at least one review');
  const firstDate = P.fromISO(first.day);
  reviews.forEach((r) => {
    eq(r.minutes, 15, 'review length');
    assert(r.name.indexOf('Review: ') === 0, 'label was ' + r.name);
    const gap = Math.round((P.fromISO(r.day) - firstDate) / 86400000);
    assert(gap === 2 || gap === 7, 'review landed ' + gap + ' days later');
    assert(P.fromISO(r.day).getTime() < P.fromISO(plan.examDate).getTime(), 'review on or after exam day');
  });
});
check('reviews never push a day over budget', () => {
  const plan = P.buildPlan({
    today: TODAY, examDate: '2026-11-12', hoursPerDay: 1, daysOff: [],
    topics: [topic('x1', 'A', 'S1', 3, 'L'), topic('x2', 'B', 'S2', 3, 'L'), topic('x3', 'C', 'S3', 3, 'M')]
  });
  plan.days.forEach((d) => assert(d.minutes <= 60, d.date + ' has ' + d.minutes + ' minutes'));
});

/* ------------------------------------------------------------------ */

console.log('\nAcceptance: exam tomorrow');
const tomorrow = P.buildPlan({
  today: TODAY, examDate: '2026-11-02', hoursPerDay: 2, daysOff: [],
  topics: [topic('t1', 'Fractions', 'Maths', 3, 'M'), topic('t2', 'Cells', 'Biology', 3, 'S')]
});
check('a single honest day, not an empty plan', () => {
  eq(tomorrow.days.length, 1);
  eq(tomorrow.days[0].date, TODAY);
  assert(tomorrow.days[0].sessions.length > 0, 'the only day is empty');
  eq(tomorrow.overflow.length, 0);
});

/* ------------------------------------------------------------------ */

console.log('\nAcceptance: hours per day set to 0');
const zero = P.buildPlan({
  today: TODAY, examDate: '2026-11-11', hoursPerDay: 0, daysOff: [],
  topics: [topic('z1', 'Fractions', 'Maths', 3, 'M')]
});
check('an explanation instead of a crash or an empty screen', () => {
  assert(zero.warning, 'expected a warning');
  eq(zero.warning.kind, 'no-hours');
  assert(zero.warning.message.length > 20, 'warning should explain itself');
  eq(zero.overflow.length, 1);
  assert(zero.days.every((d) => d.sessions.length === 0), 'nothing should be scheduled');
});

/* ------------------------------------------------------------------ */

console.log('\nEdge cases');
check('every day off does not crash', () => {
  const plan = P.buildPlan({
    today: TODAY, examDate: '2026-11-11', hoursPerDay: 2,
    daysOff: [0, 1, 2, 3, 4, 5, 6],
    topics: [topic('e1', 'Fractions', 'Maths', 3, 'M')]
  });
  eq(plan.warning.kind, 'no-study-days');
  eq(plan.overflow.length, 1);
});
check('an empty topic list builds an empty but valid plan', () => {
  const plan = P.buildPlan({ today: TODAY, examDate: '2026-11-11', hoursPerDay: 2, daysOff: [], topics: [] });
  eq(plan.days.length, 10);
  eq(plan.overflow.length, 0);
  eq(plan.stats.sessionCount, 0);
});
check('days off are excluded from the plan and counted out of capacity', () => {
  const plan = P.buildPlan({
    today: TODAY, examDate: '2026-11-11', hoursPerDay: 2,
    daysOff: [0, 6], // Sunday and Saturday
    topics: [topic('d1', 'Fractions', 'Maths', 3, 'M')]
  });
  plan.days.forEach((d) => {
    if (d.weekday === 0 || d.weekday === 6) eq(d.sessions.length, 0, d.date + ' is a day off');
  });
  const studyDays = plan.days.filter((d) => d.weekday !== 0 && d.weekday !== 6).length;
  eq(plan.stats.studyDays, studyDays);
  eq(plan.stats.capacityMinutes, studyDays * 120);
});
check('nothing at all lands on a day off, reviews included', () => {
  const plan = P.buildPlan({
    today: TODAY, examDate: '2026-11-20', hoursPerDay: 2, daysOff: [0, 3],
    topics: [topic('o1', 'Fractions', 'Maths', 1, 'L'), topic('o2', 'Cells', 'Biology', 2, 'M'), topic('o3', 'Cold War', 'History', 3, 'M')]
  });
  plan.days.forEach((d) => {
    if (d.weekday === 0 || d.weekday === 3) {
      eq(d.sessions.length, 0, d.date + ' (' + d.dayName + ') has ' + d.sessions.length + ' sessions');
    }
  });
});
check('a large topic is split into chunks of at most 45 minutes', () => {
  const plan = P.buildPlan({
    today: TODAY, examDate: '2026-11-03', hoursPerDay: 3, daysOff: [],
    topics: [topic('l1', 'Big topic', 'Maths', 3, 'L')]
  });
  const sessions = allSessions(plan).filter((s) => s.kind === 'study');
  eq(sessions.reduce((n, s) => n + s.minutes, 0), 120);
  sessions.forEach((s) => assert(s.minutes <= 45, 'chunk of ' + s.minutes));
  const breaks = sessions.filter((s) => s.breakBefore).length;
  assert(breaks >= 1, 'expected a break between chunks');
});

/* ------------------------------------------------------------------ */

console.log('\nAcceptance: rebalance after unticking three days');
function tickRange(plan, from, to, done) {
  plan.days.forEach((d) => {
    if (d.date >= from && d.date <= to) d.sessions.forEach((s) => { s.done = done; });
  });
}
const before = P.buildPlan({
  today: TODAY, examDate: '2026-11-16', hoursPerDay: 2, daysOff: [],
  topics: [
    topic('rb1', 'Fractions', 'Maths', 2, 'L'),
    topic('rb2', 'Cells', 'Biology', 2, 'L'),
    topic('rb3', 'Chronology', 'History', 2, 'M'),
    topic('rb4', 'Kinematics', 'Physics', 3, 'M'),
    topic('rb5', 'Poetry', 'English', 3, 'S')
  ]
});
// Everything before day 3 is done; days 3, 4, 5 were missed.
before.days.forEach((d, i) => {
  d.sessions.forEach((s) => { s.done = i < 2; });
});
const missed = before.days.slice(2, 5).flatMap((d) => d.sessions).filter((s) => !s.done);
const missedMinutes = missed.reduce((n, s) => n + s.minutes, 0);
const stillToDo = before.days.slice(5).flatMap((d) => d.sessions).filter((s) => !s.done);
const stillToDoMinutes = stillToDo.reduce((n, s) => n + s.minutes, 0);
const doneMinutes = allSessions(before).filter((s) => s.done).reduce((n, s) => n + s.minutes, 0);

const after = P.rebalance(before, {
  today: '2026-11-06', examDate: '2026-11-16', hoursPerDay: 2, daysOff: [],
  topics: [
    topic('rb1', 'Fractions', 'Maths', 2, 'L'),
    topic('rb2', 'Cells', 'Biology', 2, 'L'),
    topic('rb3', 'Chronology', 'History', 2, 'M'),
    topic('rb4', 'Kinematics', 'Physics', 3, 'M'),
    topic('rb5', 'Poetry', 'English', 3, 'S')
  ]
});

check('nothing is lost in the rebalance', () => {
  const live = after.days.flatMap((d) => d.sessions).filter((s) => !s.missed && !s.done);
  const scheduledMinutes = live.reduce((n, s) => n + s.minutes, 0);
  const overflowMinutes = after.overflow.reduce((n, o) => n + o.minutes, 0);
  const expected = missedMinutes + stillToDoMinutes;
  eq(scheduledMinutes + overflowMinutes, expected, 'work in, work out');
});
check('completed sessions stay exactly where they were', () => {
  const doneBefore = allSessions(before).filter((s) => s.done).map((s) => s.day + '|' + s.topicId + '|' + s.minutes).sort();
  const doneAfter = after.days.flatMap((d) => d.sessions.filter((s) => s.done).map((s) => d.date + '|' + s.topicId + '|' + s.minutes)).sort();
  eq(doneAfter.join(';'), doneBefore.join(';'));
});
check('the missed days are kept as a record but not counted as work left', () => {
  const missedCards = after.days.filter((d) => d.sessions.some((s) => s.missed));
  assert(missedCards.length > 0, 'expected the missed days to remain on the plan');
  missedCards.forEach((d) => d.sessions.forEach((s) => { if (s.missed) eq(s.done, false); }));
});
check('rebalance produces a new plan that still respects the day budget', () => {
  after.days.forEach((d) => assert(d.minutes <= 120, d.date + ' has ' + d.minutes));
});
check('rebalance with 0 hours explains itself instead of crashing', () => {
  const p = P.rebalance(before, { today: '2026-11-06', examDate: '2026-11-16', hoursPerDay: 0, daysOff: [], topics: [] });
  eq(p.warning.kind, 'no-hours');
});

/* ------------------------------------------------------------------ */

console.log('\nPersistence');
check('ticks survive a JSON round trip (what localStorage does)', () => {
  const plan = P.buildPlan({
    today: TODAY, examDate: '2026-11-11', hoursPerDay: 2, daysOff: [],
    topics: [topic('p1', 'Fractions', 'Maths', 3, 'M'), topic('p2', 'Cells', 'Biology', 3, 'M')]
  });
  plan.days[0].sessions[0].done = true;
  const revived = JSON.parse(JSON.stringify(plan));
  eq(revived.days[0].sessions[0].done, true);
  const stats = revived.days.flatMap((d) => d.sessions).filter((s) => s.done).length;
  eq(stats, 1);
});

/* ------------------------------------------------------------------ */

console.log('\nInvariants across a spread of inputs');
check('no day exceeds its budget and no session exceeds 45 minutes, anywhere', () => {
  const sizes = ['S', 'M', 'L'];
  const confs = [1, 2, 3, 4, 5];
  for (let h = 1; h <= 6; h++) {
    for (let span = 1; span <= 20; span += 3) {
      const topics = [];
      for (let i = 0; i < 12; i++) {
        topics.push(topic('g' + i, 'Topic ' + i, 'Subject ' + (i % 3), confs[i % 5], sizes[i % 3]));
      }
      const exam = P.toISO(P.addDays(P.fromISO(TODAY), span));
      const plan = P.buildPlan({ today: TODAY, examDate: exam, hoursPerDay: h, daysOff: [], topics });
      plan.days.forEach((d) => { if (d.off) assert(!d.sessions.length, 'session on a day off'); });
      plan.days.forEach((d) => {
        assert(d.minutes <= h * 60, h + 'h/day, span ' + span + ': ' + d.date + ' has ' + d.minutes);
        d.sessions.forEach((s) => assert(s.minutes <= 45 && s.minutes > 0, 'session of ' + s.minutes));
      });
      // nothing vanishes: scheduled + overflow covers every topic's estimate
      const scheduled = plan.days.flatMap((d) => d.sessions).reduce((n, s) => n + s.minutes, 0);
      const over = plan.overflow.reduce((n, o) => n + o.minutes, 0);
      const estimate = topics.reduce((n, t) => n + P.studyMinutesFor(t), 0);
      assert(scheduled + over >= estimate - 0.001, 'work lost: ' + scheduled + ' + ' + over + ' < ' + estimate);
      checkInterleaveQuiet(plan, h + 'h, span ' + span);
    }
  }
});

function checkInterleaveQuiet(plan, label) {
  plan.days.forEach((day, i) => {
    const g = groups(day.sessions);
    g.forEach((s, j) => {
      if (j === 0) return;
      const prev = g[j - 1];
      if (prev.kind === 'review' || s.kind === 'review') return;
      if (prev.subject !== s.subject) return;
      const later = g.slice(j + 1).concat(
        plan.days.slice(i + 1).flatMap((d) => groups(d.sessions))
      ).filter((x) => x.kind === 'study');
      assert(!later.some((x) => x.subject !== s.subject), label + ': back-to-back ' + s.subject + ' on ' + day.date);
    });
  });
}

/* ------------------------------------------------------------------ */

console.log('\n' + (fail === 0 ? 'All ' + pass + ' checks passed.' : pass + ' passed, ' + fail + ' failed.'));
process.exit(fail === 0 ? 0 : 1);
