/*
 * Plan It — scheduling engine.
 * Pure functions, no DOM, no dependencies, no build step.
 * Loaded in the browser as window.PlanIt, and required directly by the tests.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PlanIt = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var BASE = { S: 30, M: 60, L: 120 }; // minutes of first-pass work
  var MAX_SESSION = 45;               // no session longer than this
  var MIN_SESSION = 15;               // smallest useful block
  var REVIEW_MINUTES = 15;
  var REVIEW_GAPS = [2, 7];           // days after the first session
  var REVISION_SHARE = 0.15;          // tail of study days kept clear of new work
  var REVISION_FACTOR = 0.2;          // revision reserve used in feasibility maths

  var WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /* ---------- date helpers (local time, no timezone drift) ---------- */

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function toISO(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function fromISO(s) {
    var p = String(s).split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }

  function addDays(d, n) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  }

  function todayISO() { return toISO(new Date()); }

  /* ---------- topic maths ---------- */

  function clampConfidence(c) {
    var n = Number(c);
    if (!isFinite(n)) return 3;
    return Math.min(5, Math.max(1, Math.round(n)));
  }

  function sizeKey(s) { return BASE[s] ? s : 'M'; }

  function studyMinutesFor(topic) {
    var base = BASE[sizeKey(topic && topic.size)];
    var factor = (6 - clampConfidence(topic && topic.confidence)) / 3;
    return Math.max(MIN_SESSION, Math.round((base * factor) / 15) * 15);
  }

  function sumMinutes(list) {
    var n = 0;
    for (var i = 0; i < list.length; i++) n += list[i].minutes;
    return n;
  }

  function formatMinutes(mins) {
    mins = Math.round(mins || 0);
    if (mins < 60) return mins + ' min';
    var h = Math.floor(mins / 60);
    var m = mins % 60;
    return m ? h + ' h ' + m + ' m' : h + ' h';
  }

  function hoursWord(mins) {
    var h = Math.max(1, Math.ceil(mins / 60));
    return h + (h === 1 ? ' hour' : ' hours');
  }

  // "about 11 hours short" for a big gap, "about 25 minutes short" for a small one
  function gapPhrase(mins) {
    if (mins < 60) {
      var m = Math.max(5, Math.round(mins / 5) * 5);
      return m + ' minutes';
    }
    return hoursWord(mins);
  }

  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  /* ---------- ordering ---------- */

  // Priority: weakest first, then biggest first.
  function byPriority(a, b) {
    var ca = a.topic ? a.topic.confidence : a.confidence;
    var cb = b.topic ? b.topic.confidence : b.confidence;
    if (ca !== cb) return ca - cb;
    var sa = BASE[a.topic ? a.topic.size : a.size];
    var sb = BASE[b.topic ? b.topic.size : b.size];
    if (sa !== sb) return sb - sa;
    var na = a.topic ? a.topic.name : a.name;
    var nb = b.topic ? b.topic.name : b.name;
    return String(na).localeCompare(String(nb));
  }

  // Lowest priority first: strongest first, then smallest first. These are the
  // topics that leave the plan when there isn't room.
  function byLowestPriority(a, b) {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    var sa = BASE[a.size];
    var sb = BASE[b.size];
    if (sa !== sb) return sa - sb;
    return String(b.name).localeCompare(String(a.name));
  }

  function otherSubjectPending(items, self) {
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it === self || it.remaining <= 0) continue;
      if (it.subject !== self.subject) return true;
    }
    return false;
  }

  /* ---------- normalising input ---------- */

  function normaliseTopics(topics) {
    return (topics || []).map(function (t, i) {
      var name = String(t.name || '').trim() || 'Untitled topic';
      return {
        id: t.id || 't' + i,
        name: name,
        subject: String(t.subject || '').trim() || 'General',
        confidence: clampConfidence(t.confidence),
        size: sizeKey(t.size),
        minutes: studyMinutesFor(t)
      };
    });
  }

  function buildCalendar(today, exam) {
    var out = [];
    var d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    var guard = 0;
    while (d.getTime() < exam.getTime() && guard++ < 4000) {
      out.push(d);
      d = addDays(d, 1);
    }
    return out;
  }

  function makeDay(d, off) {
    return {
      date: toISO(d),
      weekday: d.getDay(),
      dayName: WEEKDAYS[d.getDay()],
      dayShort: WEEKDAYS_SHORT[d.getDay()],
      label: d.getDate() + ' ' + MONTHS_SHORT[d.getMonth()],
      off: !!off,
      revisionOnly: false,
      sessions: [],
      minutes: 0
    };
  }

  function makeSession(day, item, chunk, seq) {
    var last = day.sessions[day.sessions.length - 1];
    return {
      id: (item.kind === 'review' ? 'r-' : 's-') + day.date + '-' + seq,
      topicId: item.topicId,
      name: item.name,
      subject: item.subject,
      minutes: chunk,
      kind: item.kind || 'study',
      done: false,
      missed: false,
      breakBefore: !!(last && last.topicId === item.topicId && last.kind === (item.kind || 'study')),
      date: day.date
    };
  }

  /* ---------- the filler ---------- */

  // Spreads the work evenly over the days that are left instead of cramming the
  // first few days and leaving the rest empty. Never above the daily ceiling.
  function dayTargetFor(items, dayCount, dayCapacity) {
    if (!dayCount) return dayCapacity;
    var total = 0;
    for (var i = 0; i < items.length; i++) total += Math.max(0, items[i].remaining);
    if (total <= 0) return dayCapacity;
    var even = Math.ceil((total / dayCount) / MIN_SESSION) * MIN_SESSION;
    return Math.min(dayCapacity, Math.max(MIN_SESSION, even));
  }

  // Places chunks of work into the given days, in date order, never going over
  // the day's budget, never putting the same subject back to back while another
  // subject still has work left.
  function fillDays(dayMap, dates, dayCapacity, items, dayTarget) {
    var perDay = Math.min(dayCapacity, dayTarget || dayCapacity);
    dates.forEach(function (date) {
      var day = dayMap[toISO(date)];
      if (!day) return;
      var budget = Math.min(perDay, dayCapacity - day.minutes);
      var last = day.sessions[day.sessions.length - 1];
      var lastSubject = last ? last.subject : null;
      var guard = 0;

      while (budget >= MIN_SESSION && guard++ < 400) {
        var pick = null;
        for (var i = 0; i < items.length; i++) {
          var it = items[i];
          if (it.remaining <= 0) continue;
          if (it.subject === lastSubject && otherSubjectPending(items, it)) continue;
          pick = it;
          break;
        }
        if (!pick) break;

        var chunk = Math.min(MAX_SESSION, pick.remaining, budget);
        if (chunk <= 0) break;

        day.sessions.push(makeSession(day, pick, chunk, day.sessions.length + 1));
        day.minutes += chunk;
        budget -= chunk;
        pick.remaining -= chunk;
        if (!pick.firstDate) pick.firstDate = day.date;
        lastSubject = pick.subject;
      }
    });
  }

  function insertSession(day, session) {
    var idx = day.sessions.length;
    for (var i = day.sessions.length; i >= 0; i--) {
      var prev = day.sessions[i - 1];
      var next = day.sessions[i];
      var okPrev = !prev || prev.subject !== session.subject;
      var okNext = !next || next.subject !== session.subject;
      if (okPrev && okNext) { idx = i; break; }
    }
    day.sessions.splice(idx, 0, session);
    day.minutes += session.minutes;
  }

  // Spaced repetition: a 15-minute review 2 days and 7 days after the topic's
  // first session, when the date is before the exam and the day has room.
  function addReviews(dayMap, items, exam, dayCapacity) {
    items.forEach(function (it) {
      if (!it.firstDate) return;
      var first = fromISO(it.firstDate);
      REVIEW_GAPS.forEach(function (gap) {
        var target = addDays(first, gap);
        if (target.getTime() >= exam.getTime()) return;
        var day = dayMap[toISO(target)];
        if (!day || day.off) return;   // a day off is a day off, reviews included
        if (day.minutes + REVIEW_MINUTES > dayCapacity) return;
        var review = {
          id: 'r-' + it.topicId + '-' + gap,
          topicId: it.topicId,
          name: 'Review: ' + it.name,
          subject: it.subject,
          minutes: REVIEW_MINUTES,
          kind: 'review',
          done: false,
          missed: false,
          breakBefore: false,
          date: day.date
        };
        insertSession(day, review);
      });
    });
  }

  /* ---------- stats ---------- */

  function summarise(days) {
    var sessionCount = 0, doneCount = 0, scheduled = 0, reviewMinutes = 0;
    days.forEach(function (day) {
      day.sessions.forEach(function (s) {
        if (s.missed) return;
        sessionCount++;
        scheduled += s.minutes;
        if (s.kind === 'review') reviewMinutes += s.minutes;
        if (s.done) doneCount++;
      });
    });
    return {
      sessionCount: sessionCount,
      doneCount: doneCount,
      scheduledMinutes: scheduled,
      reviewMinutes: reviewMinutes
    };
  }

  /* ---------- build ---------- */

  function buildPlan(input) {
    var today = fromISO(input.today || todayISO());
    var exam = fromISO(input.examDate);
    var hours = Number(input.hoursPerDay);
    if (!isFinite(hours) || hours < 0) hours = 0;
    var dayCapacity = Math.round(hours * 60);

    var daysOff = {};
    (input.daysOff || []).forEach(function (w) { daysOff[Number(w)] = true; });

    var topics = normaliseTopics(input.topics);
    var calendar = buildCalendar(today, exam);
    var studyDates = calendar.filter(function (d) { return !daysOff[d.getDay()]; });
    var capacityMinutes = studyDates.length * dayCapacity;

    var totalStudy = sumMinutes(topics);
    var revisionReserve = totalStudy * REVISION_FACTOR;
    var warning = null;
    var active = topics.slice();
    var overflow = [];
    var dayMap = {};

    calendar.forEach(function (d) { dayMap[toISO(d)] = makeDay(d, daysOff[d.getDay()]); });

    function pushOverflow(list) {
      list.forEach(function (t) {
        overflow.push({ topicId: t.id, name: t.name, subject: t.subject, minutes: t.minutes });
      });
    }

    if (!calendar.length) {
      warning = {
        kind: 'no-days',
        message: 'There are no days left before the exam date, so there is nothing to schedule.'
      };
      active = [];
      pushOverflow(topics);
    } else if (hours === 0) {
      warning = {
        kind: 'no-hours',
        message: "You've set 0 hours a day, so there's no room to put anything in. Give yourself an hour or two and the plan will build."
      };
      active = [];
      pushOverflow(topics);
    } else if (studyDates.length === 0) {
      warning = {
        kind: 'no-study-days',
        message: 'Every day between today and the exam is marked as a day off, so there is no day to study on. Switch one back on and the plan will build.'
      };
      active = [];
      pushOverflow(topics);
    } else if (totalStudy + revisionReserve > capacityMinutes) {
      var shortfall = totalStudy + revisionReserve - capacityMinutes;
      var kept = active.slice();
      while (kept.length > 1 && sumMinutes(kept) * (1 + REVISION_FACTOR) > capacityMinutes) {
        var victim = kept.slice().sort(byLowestPriority)[0];
        kept = kept.filter(function (t) { return t !== victim; });
        overflow.push({ topicId: victim.id, name: victim.name, subject: victim.subject, minutes: victim.minutes });
      }
      active = kept;

      // The revision reserve is a target, not a wall. If there is still room in
      // the calendar after the trim, put the strongest of the dropped topics
      // back rather than leaving study days half empty.
      var spare = capacityMinutes - sumMinutes(active);
      var topicById = {};
      topics.forEach(function (t) { topicById[t.id] = t; });
      for (var k = overflow.length - 1; k >= 0; k--) {
        var entry = overflow[k];
        if (entry.minutes <= spare) {
          spare -= entry.minutes;
          overflow.splice(k, 1);
          var original = topicById[entry.topicId];
          if (original) {
            active.push(Object.assign({}, original, { minutes: entry.minutes }));
          }
        }
      }

      warning = {
        kind: 'over-capacity',
        shortfallMinutes: shortfall,
        droppedCount: overflow.length,
        message: ''
      };
    }

    var reserveCount = studyDates.length <= 1
      ? 0
      : Math.max(1, Math.round(studyDates.length * REVISION_SHARE));
    var firstPassDates = studyDates.slice(0, studyDates.length - reserveCount);

    studyDates.slice(studyDates.length - reserveCount).forEach(function (d) {
      dayMap[toISO(d)].revisionOnly = true;
    });

    var items = active.map(function (t) {
      return {
        topicId: t.id,
        name: t.name,
        subject: t.subject,
        confidence: t.confidence,
        size: t.size,
        remaining: t.minutes,
        firstDate: null,
        kind: 'study'
      };
    });
    items.sort(byPriority);

    fillDays(dayMap, firstPassDates, dayCapacity, items,
      dayTargetFor(items, firstPassDates.length, dayCapacity));

    items.forEach(function (it) {
      if (it.remaining > 0) {
        overflow.push({ topicId: it.topicId, name: it.name, subject: it.subject, minutes: it.remaining });
      }
    });

    if (warning && warning.kind === 'over-capacity') {
      warning.droppedCount = overflow.length;
      warning.message = overflow.length
        ? "You're about " + gapPhrase(warning.shortfallMinutes) + ' short. The last ' +
          plural(overflow.length, 'topic', 'topics') +
          " won't fit unless you add time or drop something."
        : "You're about " + gapPhrase(warning.shortfallMinutes) +
          ' short of the room a revision pass wants. Everything fits, but the days are full, so nothing is held back for reviews.';
    }

    addReviews(dayMap, items, exam, dayCapacity);

    var days = calendar.map(function (d) { return dayMap[toISO(d)]; });

    return {
      builtAt: new Date().toISOString(),
      today: toISO(today),
      examDate: toISO(exam),
      hoursPerDay: hours,
      daysOff: input.daysOff || [],
      days: days,
      overflow: overflow,
      warning: warning,
      stats: Object.assign({
        studyDays: studyDates.length,
        revisionDays: reserveCount,
        capacityMinutes: capacityMinutes,
        totalStudyMinutes: totalStudy,
        revisionMinutes: revisionReserve,
        daysRemaining: days.length
      }, summarise(days))
    };
  }

  /* ---------- rebalance ---------- */

  // Rebuilds everything that is still unticked into the days that are left.
  // Ticked sessions stay exactly where they are. Nothing is dropped: whatever
  // doesn't fit lands in the overflow list.
  function rebalance(plan, input) {
    var today = fromISO(input.today || todayISO());
    var exam = fromISO(input.examDate);
    var hours = Number(input.hoursPerDay);
    if (!isFinite(hours) || hours < 0) hours = 0;
    var dayCapacity = Math.round(hours * 60);
    var todayKey = toISO(today);

    var daysOff = {};
    (input.daysOff || []).forEach(function (w) { daysOff[Number(w)] = true; });

    var dayMap = {};
    var pending = [];
    var pendingIndex = {};

    function queue(session) {
      // reviews are keyed by their own id so two reviews of the same topic stay
      // two reviews instead of merging into one block
      var key = session.topicId + '|' + session.kind +
        (session.kind === 'review' ? '|' + session.id : '');
      if (!pendingIndex[key]) {
        pendingIndex[key] = {
          topicId: session.topicId,
          name: String(session.name || '').replace(/^Review:\s*/, ''),
          subject: session.subject,
          minutes: 0,
          kind: session.kind
        };
        pending.push(pendingIndex[key]);
      }
      pendingIndex[key].minutes += session.minutes;
    }

    (plan.days || []).forEach(function (day) {
      var isFuture = day.date >= todayKey;
      var kept = [];
      (day.sessions || []).forEach(function (s) {
        var copy = Object.assign({}, s);
        if (s.done) { kept.push(copy); return; }
        queue(s);                             // back in the queue either way
        if (isFuture) return;                 // off the plan, to be rescheduled
        copy.missed = true;                   // past day: keep the record of what was missed
        kept.push(copy);
      });
      dayMap[day.date] = Object.assign({}, day, {
        sessions: kept,
        minutes: kept.reduce(function (n, s) { return n + (s.missed ? 0 : s.minutes); }, 0)
      });
    });

    (plan.overflow || []).forEach(function (o) {
      var key = o.topicId + '|study';
      if (!pendingIndex[key]) {
        pendingIndex[key] = { topicId: o.topicId, name: o.name, subject: o.subject, minutes: 0, kind: 'study' };
        pending.push(pendingIndex[key]);
      }
      pendingIndex[key].minutes += o.minutes;
    });

    var topicById = {};
    (input.topics || []).forEach(function (t) { topicById[t.id] = t; });

    // Make sure every day from today to the day before the exam exists.
    var studyDates = [];
    for (var d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      d.getTime() < exam.getTime(); d = addDays(d, 1)) {
      if (daysOff[d.getDay()]) {
        if (!dayMap[toISO(d)]) dayMap[toISO(d)] = makeDay(d, true);
      } else {
        studyDates.push(d);
        if (!dayMap[toISO(d)]) dayMap[toISO(d)] = makeDay(d, false);
      }
    }

    var items = pending.filter(function (p) { return p.minutes > 0; }).map(function (p) {
      var src = topicById[p.topicId] || {};
      return {
        topicId: p.topicId,
        name: p.kind === 'review' ? 'Review: ' + p.name : (src.name || p.name),
        subject: src.subject || p.subject || 'General',
        confidence: src.confidence == null ? 3 : clampConfidence(src.confidence),
        size: sizeKey(src.size),
        remaining: p.minutes,
        firstDate: null,
        kind: p.kind
      };
    });

    var warning = null;
    if (!studyDates.length) {
      warning = {
        kind: 'no-days',
        message: 'There are no study days left before the exam, so nothing can be rescheduled.'
      };
    } else if (hours === 0) {
      warning = {
        kind: 'no-hours',
        message: "You've set 0 hours a day, so there's no room to fit the rest in. Add an hour and rebalance again."
      };
    }

    if (warning) {
      var newPlan = Object.assign({}, plan, {
        today: todayKey,
        examDate: toISO(exam),
        hoursPerDay: hours,
        daysOff: input.daysOff || [],
        days: Object.keys(dayMap).sort().map(function (k) { return dayMap[k]; }),
        overflow: pending.map(function (p) {
          return { topicId: p.topicId, name: p.name, subject: p.subject, minutes: p.minutes };
        }),
        warning: warning,
        rebalancedAt: new Date().toISOString()
      });
      newPlan.stats = Object.assign({
        studyDays: studyDates.length,
        revisionDays: 0,
        capacityMinutes: 0,
        totalStudyMinutes: newPlan.stats ? newPlan.stats.totalStudyMinutes : 0,
        revisionMinutes: 0,
        daysRemaining: newPlan.days.length
      }, summarise(newPlan.days));
      return newPlan;
    }

    var reserveCount = studyDates.length <= 1
      ? 0
      : Math.max(1, Math.round(studyDates.length * REVISION_SHARE));
    var firstPassDates = studyDates.slice(0, studyDates.length - reserveCount);

    studyDates.slice(studyDates.length - reserveCount).forEach(function (d) {
      dayMap[toISO(d)].revisionOnly = true;
    });

    // New work goes first; leftover reviews fill in behind it.
    items.sort(function (a, b) {
      if (a.kind !== b.kind) return a.kind === 'study' ? -1 : 1;
      return byPriority(a, b);
    });

    fillDays(dayMap, firstPassDates, dayCapacity, items,
      dayTargetFor(items, firstPassDates.length, dayCapacity));

    var overflow = [];
    items.forEach(function (it) {
      if (it.remaining > 0) {
        overflow.push({
          topicId: it.topicId,
          name: it.name,
          subject: it.subject,
          minutes: it.remaining
        });
      }
    });

    var days = Object.keys(dayMap).sort().map(function (k) { return dayMap[k]; });

    var capacityMinutes = studyDates.length * dayCapacity;

    var out = Object.assign({}, plan, {
      today: todayKey,
      examDate: toISO(exam),
      hoursPerDay: hours,
      daysOff: input.daysOff || [],
      days: days,
      overflow: overflow,
      warning: null,
      rebalancedAt: new Date().toISOString()
    });

    if (overflow.length) {
      var lost = overflow.reduce(function (n, o) { return n + o.minutes; }, 0);
      out.warning = {
        kind: 'over-capacity',
        shortfallMinutes: lost,
        droppedCount: overflow.length,
        message: "There isn't room for all of it in the days that are left. " +
          hoursWord(lost) + ' of work is in "If you get time" — add a day, add an hour, or let some of it go.'
      };
    }

    out.stats = Object.assign({
      studyDays: studyDates.length,
      revisionDays: reserveCount,
      capacityMinutes: capacityMinutes,
      totalStudyMinutes: plan.stats ? plan.stats.totalStudyMinutes : 0,
      revisionMinutes: plan.stats ? plan.stats.revisionMinutes : 0,
      daysRemaining: days.length
    }, summarise(days));

    return out;
  }

  /* ---------- small helpers the UI wants ---------- */

  function studyDayCount(todayISOStr, examISOStr, daysOff) {
    var today = fromISO(todayISOStr);
    var exam = fromISO(examISOStr);
    var off = {};
    (daysOff || []).forEach(function (w) { off[Number(w)] = true; });
    return buildCalendar(today, exam).filter(function (d) { return !off[d.getDay()]; }).length;
  }

  return {
    BASE: BASE,
    MAX_SESSION: MAX_SESSION,
    MIN_SESSION: MIN_SESSION,
    REVIEW_MINUTES: REVIEW_MINUTES,
    WEEKDAYS: WEEKDAYS,
    WEEKDAYS_SHORT: WEEKDAYS_SHORT,
    MONTHS_SHORT: MONTHS_SHORT,
    studyMinutesFor: studyMinutesFor,
    formatMinutes: formatMinutes,
    hoursWord: hoursWord,
    toISO: toISO,
    fromISO: fromISO,
    addDays: addDays,
    todayISO: todayISO,
    studyDayCount: studyDayCount,
    buildPlan: buildPlan,
    rebalance: rebalance
  };
});
