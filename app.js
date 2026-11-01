/*
 * Plan It — the page.
 * Reads the three steps, hands the inputs to planner.js, draws the result,
 * and keeps everything in localStorage.
 */
(function () {
  'use strict';

  var P = window.PlanIt;
  var STORE_KEY = 'planit.v1';
  var DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mon → Sun
  var DAY_LABEL = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 0: 'Sun' };
  var WORDS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

  var state = {
    examDate: '',
    hoursPerDay: 2,
    startTime: '09:00',
    daysOff: [],
    topics: [],
    plan: null,
    planSig: ''
  };

  var SAMPLE = {
    offsetDays: 12,
    hoursPerDay: 2,
    daysOff: [6],
    topics: [
      { id: 's1', name: 'Fractions and ratios', subject: 'Maths', confidence: 1, size: 'L' },
      { id: 's2', name: 'Quadratic equations', subject: 'Maths', confidence: 2, size: 'M' },
      { id: 's3', name: 'Photosynthesis', subject: 'Biology', confidence: 2, size: 'M' },
      { id: 's4', name: 'Cell division', subject: 'Biology', confidence: 3, size: 'M' },
      { id: 's5', name: 'Enzymes', subject: 'Biology', confidence: 4, size: 'S' },
      { id: 's6', name: 'The Cold War', subject: 'History', confidence: 3, size: 'L' },
      { id: 's7', name: 'Source analysis', subject: 'History', confidence: 5, size: 'S' },
      { id: 's8', name: 'Kinematics', subject: 'Physics', confidence: 1, size: 'M' }
    ]
  };

  var el = {};
  var lastRowKey = null;

  /* ---------- tiny helpers ---------- */

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function uid() {
    return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function liveTopics() {
    return state.topics.filter(function (t) { return String(t.name || '').trim() !== ''; });
  }

  function signature() {
    return JSON.stringify({
      e: state.examDate,
      h: state.hoursPerDay,
      d: state.daysOff.slice().sort(),
      t: liveTopics().map(function (t) {
        return [t.name.trim(), (t.subject || '').trim(), t.confidence, t.size];
      })
    });
  }

  function totalPhrase(mins) {
    if (mins < 60) return mins + (mins === 1 ? ' minute' : ' minutes');
    var h = Math.round((mins / 60) * 10) / 10;
    var label = h === 1 ? 'hour' : 'hours';
    return (h % 1 === 0 ? h : h.toFixed(1)) + ' ' + label;
  }

  function todayISO() { return P.todayISO(); }

  function scrollBehavior() {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    } catch (err) {
      return 'auto';
    }
  }

  function examIsPast() {
    return !!state.examDate && state.examDate < todayISO();
  }

  function examIsValid() {
    return !!state.examDate && state.examDate > todayISO();
  }

  function listSentence(items) {
    if (!items.length) return '';
    if (items.length === 1) return items[0];
    if (items.length === 2) return items[0] + ', then ' + items[1];
    return items.slice(0, -1).join(', ') + ', then ' + items[items.length - 1];
  }

  /* ---------- persistence ---------- */

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        examDate: state.examDate,
        hoursPerDay: state.hoursPerDay,
        startTime: state.startTime,
        daysOff: state.daysOff,
        topics: state.topics,
        plan: state.plan,
        planSig: state.planSig
      }));
    } catch (err) {
      /* private mode or a full disk — the plan still works for this session */
    }
  }

  function load() {
    var raw;
    try { raw = localStorage.getItem(STORE_KEY); } catch (err) { return false; }
    if (!raw) return false;
    try {
      var data = JSON.parse(raw);
      state.examDate = data.examDate || '';
      state.hoursPerDay = typeof data.hoursPerDay === 'number' ? data.hoursPerDay : 2;
      state.startTime = typeof data.startTime === 'string' && /^\d{2}:\d{2}$/.test(data.startTime) ? data.startTime : '09:00';
      state.daysOff = Array.isArray(data.daysOff) ? data.daysOff : [];
      state.topics = Array.isArray(data.topics) ? data.topics : [];
      state.plan = data.plan || null;
      state.planSig = data.planSig || '';
      return true;
    } catch (err) {
      return false;
    }
  }

  /* ---------- welcome ---------- */

  function isFresh() {
    return !state.examDate && !state.topics.length && !state.plan;
  }

  function renderWelcome() {
    if (!el.welcome) return;
    el.welcome.hidden = !isFresh();
  }

  function loadSample() {
    state.examDate = P.toISO(P.addDays(P.fromISO(todayISO()), SAMPLE.offsetDays));
    state.hoursPerDay = SAMPLE.hoursPerDay;
    state.daysOff = SAMPLE.daysOff.slice();
    state.topics = SAMPLE.topics.map(function (t) { return Object.assign({}, t); });
    state.plan = null;
    state.planSig = '';
    lastRowKey = null;
    el.examDate.value = state.examDate;
    el.hours.value = String(state.hoursPerDay);
    el.startTime.value = state.startTime;
    el.rows.innerHTML = '';
    renderDayToggles();
    renderDeadlineSummary();
    renderTopics();
    buildPlan(true);
    save();
    if (el.stepPlan && el.stepPlan.scrollIntoView) {
      el.stepPlan.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
    }
  }

  /* ---------- step 1 ---------- */

  function renderDayToggles() {
    el.dayToggles.innerHTML = DAY_ORDER.map(function (wd) {
      var on = state.daysOff.indexOf(wd) !== -1;
      return '<button type="button" class="wd' + (on ? ' is-off' : '') + '" data-wd="' + wd +
        '" aria-pressed="' + on + '">' + DAY_LABEL[wd] + '</button>';
    }).join('');
  }

  function renderDeadlineSummary() {
    var out = el.deadlineSummary;
    out.classList.remove('is-warn');

    if (!state.examDate) {
      out.textContent = 'Pick the date you are working towards.';
      return;
    }
    if (examIsPast()) {
      out.classList.add('is-warn');
      out.textContent = 'That date has already gone by. Choose one that is still ahead.';
      return;
    }
    if (state.examDate === todayISO()) {
      out.classList.add('is-warn');
      out.textContent = 'That is today. Choose tomorrow or later so there is a day to plan.';
      return;
    }

    var days = P.studyDayCount(todayISO(), state.examDate, state.daysOff);
    var minutes = days * Math.round(state.hoursPerDay * 60);

    if (state.hoursPerDay <= 0) {
      out.classList.add('is-warn');
      out.textContent = "That's " + days + ' study ' + (days === 1 ? 'day' : 'days') +
        ' with no hours in them. Give yourself an hour a day and there will be room for something.';
      return;
    }

    out.textContent = "That's " + days + ' study ' + (days === 1 ? 'day' : 'days') +
      ' and ' + totalPhrase(minutes) + ' in total.';
  }

  /* ---------- step 2 ---------- */

  function renderTopics() {
    var key = state.topics.map(function (t) { return t.id; }).join(',');
    if (key !== lastRowKey) {
      lastRowKey = key;
      el.rows.innerHTML = state.topics.length
        ? state.topics.map(rowMarkup).join('')
        : '<p class="empty-note">No topics yet. Paste your list above, or add them one at a time.</p>';
    }
    renderSubjectList();
    renderTopicsSummary();
    el.stepTopics.hidden = !examIsValid();
    renderWelcome();
  }

  function rowMarkup(t) {
    var dots = '';
    for (var i = 1; i <= 5; i++) {
      dots += '<button type="button" class="dot' + (i <= t.confidence ? ' is-on' : '') +
        '" data-conf="' + i + '" aria-label="Confidence ' + i + '" aria-pressed="' + (i === t.confidence) + '"></button>';
    }
    var sizes = ['S', 'M', 'L'].map(function (s) {
      return '<button type="button" class="size' + (t.size === s ? ' is-on' : '') + '" data-size="' + s +
        '" aria-pressed="' + (t.size === s) + '" title="' +
        ({ S: 'about 30 minutes', M: 'about an hour', L: 'about two hours' }[s]) + '">' + s + '</button>';
    }).join('');

    return '<div class="topic-row" data-id="' + esc(t.id) + '">' +
      '<div class="row-main">' +
        '<input class="t-name" type="text" value="' + esc(t.name) + '" placeholder="Topic name" aria-label="Topic name">' +
        '<input class="t-subject" type="text" value="' + esc(t.subject || '') + '" placeholder="Subject" aria-label="Subject" list="subject-list" autocomplete="off">' +
      '</div>' +
      '<div class="row-controls">' +
        '<div class="dots" role="group" aria-label="Confidence">' + dots + '</div>' +
        '<div class="sizes" role="group" aria-label="Size">' + sizes + '</div>' +
        '<button type="button" class="row-del" aria-label="Remove ' + esc(t.name || 'this topic') + '">&times;</button>' +
      '</div>' +
    '</div>';
  }

  function renderSubjectList() {
    var seen = {};
    var out = [];
    state.topics.forEach(function (t) {
      var s = String(t.subject || '').trim();
      if (s && !seen[s.toLowerCase()]) { seen[s.toLowerCase()] = true; out.push(s); }
    });
    el.subjectList.innerHTML = out.map(function (s) {
      return '<option value="' + esc(s) + '"></option>';
    }).join('');
  }

  function renderTopicsSummary() {
    var topics = liveTopics();
    if (!topics.length) {
      el.topicsSummary.textContent = 'Nothing yet.';
      return;
    }
    var minutes = topics.reduce(function (n, t) { return n + P.studyMinutesFor(t); }, 0);
    el.topicsSummary.textContent = topics.length + (topics.length === 1 ? ' topic' : ' topics') +
      ', about ' + totalPhrase(minutes);
  }

  /* ---------- step 3 ---------- */

  function input() {
    return {
      today: todayISO(),
      examDate: state.examDate,
      hoursPerDay: state.hoursPerDay,
      daysOff: state.daysOff.slice(),
      topics: liveTopics()
    };
  }

  function buildPlan(quiet) {
    if (!examIsValid() || !liveTopics().length) return;
    state.plan = P.buildPlan(input());
    state.planSig = signature();
    state.enterNext = true;
    save();
    renderPlan();
    if (!quiet) {
      var card = el.stepPlan;
      if (card && card.scrollIntoView) card.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
    }
  }

  function renderPlan() {
    var hasPlan = !!state.plan;
    el.stepPlan.hidden = !hasPlan;

    if (!hasPlan) {
      el.planNotice.innerHTML = '';
      el.weeks.innerHTML = '';
      el.overflow.innerHTML = '';
      el.planStats.innerHTML = '';
      el.topicProgress.hidden = true;
      el.progress.hidden = true;
      el.todayLine.textContent = '';
      el.runninghead.hidden = true;
      return;
    }

    var plan = state.plan;
    var past = examIsPast() || plan.examDate < todayISO();
    var stale = state.planSig && state.planSig !== signature();
    var newDay = plan.today && plan.today !== todayISO() && !past;
    var notices = [];

    if (plan.warning) {
      notices.push('<div class="notice notice-warn">' + esc(plan.warning.message) + '</div>');
    }
    if (past) {
      notices.push('<div class="notice notice-soft">This exam date has passed. The plan below is how it finished, kept as a record. ' +
        'Pick a new date above to start a fresh one.</div>');
    } else if (stale && state.hoursPerDay <= 0) {
      notices.push('<div class="notice notice-warn">You have set 0 hours a day, so there is no room to put anything in. ' +
        'Give yourself an hour or two, then <button type="button" class="btn-inline" id="btn-rebuild">rebuild the plan</button>.</div>');
    } else if (stale) {
      notices.push('<div class="notice notice-soft">Your topics or hours have changed since this plan was built. ' +
        '<button type="button" class="btn-inline" id="btn-rebuild">Rebuild the plan</button></div>');
    } else if (newDay) {
      notices.push('<div class="notice notice-soft">A new day has started since this plan was built. ' +
        'Rebalance to move anything unfinished into the days that are left.</div>');
    }
    el.planNotice.innerHTML = notices.join('');

    renderRunningHead(plan, past);
    renderStats(plan);
    renderProgress();
    renderTodayLine(plan, past);
    renderWeeks(plan, past, !!state.enterNext);
    renderTopicProgress(plan);
    state.enterNext = false;
    renderOverflow(plan);
    el.stepPlan.classList.toggle('is-readonly', past);
  }

  function renderRunningHead(plan, past) {
    var left = daysUntil(plan.examDate);
    el.runninghead.hidden = false;

    if (past) {
      el.rhDays.textContent = '—';
      el.rhUnit.textContent = 'finished';
    } else {
      el.rhDays.textContent = String(Math.max(0, left));
      el.rhUnit.textContent = left === 1 ? 'day to go' : 'days to go';
    }

    var bits = [shortDate(plan.examDate)];
    bits.push(P.formatMinutes(plan.stats.scheduledMinutes || 0));
    bits.push((plan.stats.doneCount || 0) + '/' + (plan.stats.sessionCount || 0) + ' done');
    el.rhMeta.textContent = bits.join(' · ');
  }

  function shortDate(iso) {
    var d = P.fromISO(iso);
    return P.WEEKDAYS_SHORT[d.getDay()] + ' ' + d.getDate() + ' ' + P.MONTHS_SHORT[d.getMonth()];
  }

  function daysUntil(isoDate) {
    var today = P.fromISO(todayISO());
    var target = P.fromISO(isoDate);
    return Math.round((target - today) / 86400000);
  }

  function renderStats(plan) {
    var s = plan.stats || {};
    el.planStats.innerHTML =
      '<div><dt>Days</dt><dd>' + (s.daysRemaining || plan.days.length) + '</dd></div>' +
      '<div><dt>Work</dt><dd>' + P.formatMinutes(s.scheduledMinutes || 0) + '</dd></div>' +
      '<div><dt>Sessions</dt><dd>' + (s.sessionCount || 0) + '</dd></div>';
  }

  function renderProgress() {
    var plan = state.plan;
    var ticks = [];
    var total = 0;
    var done = 0;
    plan.days.forEach(function (d) {
      d.sessions.forEach(function (s) {
        if (s.missed) return;
        total++;
        if (s.done) done++;
        ticks.push('<i' + (s.done ? ' class="on"' : '') + '></i>');
      });
    });
    el.progress.hidden = total === 0;
    el.progressTicks.innerHTML = ticks.join('');
    el.progressText.textContent = done + ' of ' + total + ' done';
  }

  function renderTodayLine(plan, past) {
    if (past) { el.todayLine.textContent = ''; return; }
    var day = plan.days.find(function (d) { return d.date === todayISO(); });
    if (!day) { el.todayLine.textContent = ''; return; }

    if (day.off) {
      el.todayLine.textContent = 'A day off today. Nothing on the list.';
      return;
    }
    if (!day.sessions.length) {
      el.todayLine.textContent = day.revisionOnly
        ? 'Nothing new today. The day is kept clear for review.'
        : 'Nothing scheduled today.';
      return;
    }
    var open = day.sessions.filter(function (s) { return !s.done; });
    if (!open.length) {
      el.todayLine.innerHTML = '<em>' + P.formatMinutes(day.minutes) + '</em> today, and it is done.';
      return;
    }
    var names = open.map(function (s) {
      return s.kind === 'review' ? 'a review of ' + s.name.replace(/^Review:\s*/, '') : s.name;
    });
    el.todayLine.innerHTML = '<em>' + P.formatMinutes(day.minutes) + '</em> today: ' + esc(listSentence(names)) + '.';
  }

  function renderWeeks(plan, past, enter) {
    var today = todayISO();
    var chunks = [];
    for (var i = 0; i < plan.days.length; i += 7) chunks.push(plan.days.slice(i, i + 7));

    el.weeks.classList.toggle('weeks-enter', !!enter);
    if (enter) {
      window.setTimeout(function () { el.weeks.classList.remove('weeks-enter'); }, 900);
    }

    el.weeks.innerHTML = chunks.map(function (chunk, index) {
      var first = P.fromISO(chunk[0].date);
      var last = P.fromISO(chunk[chunk.length - 1].date);
      var range = first.getDate() + ' ' + P.MONTHS_SHORT[first.getMonth()] +
        ' – ' + last.getDate() + ' ' + P.MONTHS_SHORT[last.getMonth()];
      var word = WORDS[index] || String(index + 1);
      return '<section class="week">' +
        '<h3 class="week-head"><span>Week ' + word + '</span><span class="week-range">' + range + '</span></h3>' +
        chunk.map(function (day, i) { return dayMarkup(day, today, past, i); }).join('') +
      '</section>';
    }).join('');
  }

  function dayMarkup(day, today, past, index) {
    var isToday = day.date === today;
    var isPast = day.date < today;
    var classes = ['day'];
    if (isToday) classes.push('is-today');
    if (isPast) classes.push('is-past');
    if (day.off) classes.push('is-off');

    var d = P.fromISO(day.date);
    var when = '<div class="day-when">' +
      '<span class="d-num">' + (d.getDate() < 10 ? '0' : '') + d.getDate() + '</span>' +
      '<span class="d-mon">' + P.MONTHS_SHORT[d.getMonth()] + '</span>' +
    '</div>';

    var head = '<div class="day-head">' +
      '<h4>' + esc(isToday ? 'Today' : day.dayName) + '</h4>' +
      '<span class="day-total">' +
        (day.off ? 'day off' : (day.minutes ? P.formatMinutes(day.minutes) : '—')) +
      '</span>' +
    '</div>';

    var body = '';
    if (!day.sessions.length) {
      body = '<p class="day-empty">' +
        (day.off ? 'Nothing planned.'
          : day.revisionOnly ? 'Kept clear for review.'
            : 'Nothing scheduled.') + '</p>';
    } else {
      body = '<ul class="sessions">' + day.sessions.map(function (s) {
        var li = '';
        if (s.breakBefore) li += '<li class="break" aria-hidden="true">10 min break</li>';
        var cls = 'session';
        if (s.done) cls += ' is-done';
        if (s.missed) cls += ' is-missed';
        if (s.kind === 'review') cls += ' is-review';
        li += '<li class="' + cls + '">' +
          '<label class="session-label">' +
            '<input type="checkbox" data-date="' + esc(day.date) + '" data-session="' + esc(s.id) + '"' +
              (s.done ? ' checked' : '') + (past ? ' disabled' : '') + '>' +
            '<span class="session-subject">' + esc(s.subject) + '</span>' +
            '<span class="session-name">' + esc(s.name) + '</span>' +
            '<span class="leader" aria-hidden="true"></span>' +
            '<span class="session-minutes">' + P.formatMinutes(s.minutes) + '</span>' +
          '</label>' +
        '</li>';
        return li;
      }).join('') + '</ul>';
    }

    return '<article class="' + classes.join(' ') + '" style="--i:' + (index || 0) + '">' + when +
      '<div class="day-body">' + head + body + '</div></article>';
  }

  function renderOverflow(plan) {
    if (!plan.overflow || !plan.overflow.length) {
      el.overflow.innerHTML = '';
      return;
    }
    el.overflow.innerHTML = '<section class="overflow">' +
      '<h3>If you get time</h3>' +
      '<p class="overflow-note">Past what the days can hold. Nothing has been thrown away — it is here if a day frees up.</p>' +
      '<ul>' + plan.overflow.map(function (o) {
        return '<li><span class="session-subject">' + esc(o.subject || 'General') + '</span>' +
          '<span class="overflow-name">' + esc(o.name) + '</span>' +
          '<span class="leader" aria-hidden="true"></span>' +
          '<span class="session-minutes">' + P.formatMinutes(o.minutes) + '</span></li>';
      }).join('') + '</ul></section>';
  }

  /* ---------- export ---------- */

  function download(filename, mime, text) {
    try {
      var blob = new Blob([text], { type: mime });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
      return true;
    } catch (err) {
      return false;
    }
  }

  function setExportStatus(message, isError) {
    [el.exportStatus, el.welcomeStatus].forEach(function (node) {
      if (!node) return;
      node.textContent = message || '';
      node.classList.toggle('is-error', !!isError);
    });
  }

  function icsDate(iso) { return iso.replace(/-/g, ''); }

  function icsEscape(value) {
    return String(value)
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r?\n/g, '\\n');
  }

  // RFC 5545 wants lines folded at 75 octets, continuation indented by a space
  function foldLine(line) {
    var out = [];
    var rest = line;
    while (rest.length > 73) {
      out.push(rest.slice(0, 73));
      rest = ' ' + rest.slice(73);
    }
    out.push(rest);
    return out.join('\r\n');
  }

  function nextDay(iso) {
    return P.toISO(P.addDays(P.fromISO(iso), 1));
  }

  function minutesFromClock(hhmm) {
    var parts = String(hhmm || '09:00').split(':');
    var h = Math.min(23, Math.max(0, parseInt(parts[0], 10) || 0));
    var m = Math.min(59, Math.max(0, parseInt(parts[1], 10) || 0));
    return h * 60 + m;
  }

  // A floating local timestamp: no Z, no TZID. Every calendar app reads it in
  // the timezone of the person importing, which is what "9am" should mean.
  function icsStamp(dateIso, minutes) {
    var d = P.fromISO(dateIso);
    var h = Math.floor(minutes / 60);
    var m = minutes % 60;
    function p2(n) { return (n < 10 ? '0' : '') + n; }
    return '' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) +
      'T' + p2(h) + p2(m) + '00';
  }

  function buildIcs(plan) {
    var stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    var dayStart = minutesFromClock(state.startTime);
    var lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Plan It//Study Planner//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:Plan It'
    ];

    plan.days.forEach(function (day) {
      var cursor = dayStart;

      day.sessions.forEach(function (s, i) {
        if (s.breakBefore) cursor += 10;      // the break between split chunks
        var from = cursor;
        var to = cursor + s.minutes;
        cursor = to;

        var summary = s.subject + ' — ' + s.name;
        var description = P.formatMinutes(s.minutes) +
          (s.kind === 'review' ? ', revision' : ', first pass') +
          ' · from your Plan It timetable';

        lines.push('BEGIN:VEVENT');
        lines.push('UID:planit-' + day.date + '-' + i + '-' + s.topicId + '@plan-it.local');
        lines.push('DTSTAMP:' + stamp);
        lines.push('DTSTART:' + icsStamp(day.date, from));
        lines.push('DTEND:' + icsStamp(day.date, to));
        lines.push(foldLine('SUMMARY:' + icsEscape(summary)));
        lines.push(foldLine('DESCRIPTION:' + icsEscape(description)));
        lines.push('CATEGORIES:' + icsEscape(s.subject));
        lines.push('TRANSP:OPAQUE');
        lines.push('END:VEVENT');
      });
    });

    // the exam itself, all day
    lines.push('BEGIN:VEVENT');
    lines.push('UID:planit-exam-' + plan.examDate + '@plan-it.local');
    lines.push('DTSTAMP:' + stamp);
    lines.push('DTSTART;VALUE=DATE:' + icsDate(plan.examDate));
    lines.push('DTEND;VALUE=DATE:' + icsDate(nextDay(plan.examDate)));

    var leftovers = (plan.overflow || []).map(function (o) {
      return o.subject + ' — ' + o.name + ' (' + P.formatMinutes(o.minutes) + ')';
    });
    var examText = 'Exam day. Planned with Plan It: ' +
      (plan.stats.sessionCount || 0) + ' sessions, ' +
      P.formatMinutes(plan.stats.scheduledMinutes || 0) + ' of work.';
    if (leftovers.length) {
      examText += '\n\nIf you get time:\n' + leftovers.join('\n');
    }
    lines.push(foldLine('DESCRIPTION:' + icsEscape(examText)));
    lines.push('SUMMARY:Exam day');
    lines.push('TRANSP:OPAQUE');
    lines.push('END:VEVENT');

    lines.push('END:VCALENDAR');
    return lines.join('\r\n') + '\r\n';
  }

  function csvCell(value) {
    var s = String(value == null ? '' : value);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function buildCsv(plan) {
    var rows = [['Date', 'Weekday', 'Subject', 'Topic', 'Minutes', 'Type', 'Done']];
    plan.days.forEach(function (day) {
      day.sessions.forEach(function (s) {
        rows.push([
          day.date,
          day.dayName,
          s.subject,
          s.name,
          s.minutes,
          s.kind === 'review' ? 'review' : 'study',
          s.done ? 'yes' : (s.missed ? 'missed' : 'no')
        ]);
      });
    });
    plan.overflow.forEach(function (o) {
      rows.push(['', '', o.subject, o.name, o.minutes, 'not scheduled', '']);
    });
    var body = rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
    return '\ufeff' + body + '\r\n';
  }

  function buildBackup() {
    return JSON.stringify({
      app: 'plan-it',
      version: 1,
      savedAt: new Date().toISOString(),
      state: {
        examDate: state.examDate,
        hoursPerDay: state.hoursPerDay,
        startTime: state.startTime,
        daysOff: state.daysOff,
        topics: state.topics,
        plan: state.plan,
        planSig: state.planSig
      }
    }, null, 2);
  }

  function restoreFrom(text) {
    var data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      return { error: 'That file is not valid JSON.' };
    }
    var s = data && data.state ? data.state : data;
    if (!s || typeof s !== 'object' || !s.examDate || !Array.isArray(s.topics) || !s.plan) {
      return { error: 'That file does not look like a Plan It backup.' };
    }
    if (!s.plan.days || !Array.isArray(s.plan.days)) {
      return { error: 'That backup has a plan in it, but no days to draw.' };
    }

    state.examDate = s.examDate;
    state.hoursPerDay = typeof s.hoursPerDay === 'number' ? s.hoursPerDay : 2;
    state.startTime = typeof s.startTime === 'string' && /^\d{2}:\d{2}$/.test(s.startTime) ? s.startTime : '09:00';
    state.daysOff = Array.isArray(s.daysOff) ? s.daysOff : [];
    state.topics = s.topics;
    state.plan = s.plan;
    state.planSig = s.planSig || signature();
    lastRowKey = null;
    el.examDate.value = state.examDate;
    el.hours.value = String(state.hoursPerDay);
    el.startTime.value = state.startTime;
    el.rows.innerHTML = '';
    renderDayToggles();
    renderDeadlineSummary();
    renderTopics();
    renderPlan();
    save();

    var count = state.plan.stats && state.plan.stats.sessionCount ? state.plan.stats.sessionCount : 0;
    return { ok: 'Restored: ' + state.topics.length + ' topics, ' + count + ' sessions.' };
  }

  function exportName(kind) {
    var base = state.plan && state.plan.examDate ? 'plan-it-' + state.plan.examDate : 'plan-it';
    if (kind === 'json') return 'plan-it-backup-' + todayISO() + '.json';
    return base + '.' + kind;
  }

  /* ---------- where each topic stands ---------- */

  function renderTopicProgress(plan) {
    var map = {};
    var order = [];

    function row(id, name, subject) {
      if (!map[id]) {
        map[id] = { id: id, name: name.replace(/^Review:\s*/, ''), subject: subject, total: 0, done: 0, left: 0, ticks: [] };
        order.push(id);
      }
      return map[id];
    }

    plan.days.forEach(function (day) {
      day.sessions.forEach(function (s) {
        var t = row(s.topicId, s.name, s.subject);
        t.total++;
        t.ticks.push(s.done ? 1 : 0);
        if (s.done) t.done++;
        else if (!s.missed) t.left += s.minutes;
      });
    });

    plan.overflow.forEach(function (o) {
      var t = row(o.topicId, o.name, o.subject);
      t.left += o.minutes;
      t.unscheduled = t.total === 0;
    });

    if (!order.length) {
      el.topicProgress.hidden = true;
      return;
    }
    el.topicProgress.hidden = false;

    var finished = order.filter(function (id) { return map[id].total > 0 && map[id].done === map[id].total; }).length;
    el.topicProgressSummary.textContent = 'Where each topic stands' +
      ' — ' + order.length + (order.length === 1 ? ' topic' : ' topics') +
      (finished ? ', ' + finished + ' finished' : '');

    var sorted = order.map(function (id) { return map[id]; }).sort(function (a, b) {
      return (b.left - a.left) || a.name.localeCompare(b.name);
    });

    el.topicProgressBody.innerHTML = '<ul class="topic-list">' + sorted.map(function (t) {
      var ticks = t.ticks.map(function (on) { return '<i' + (on ? ' class="on"' : '') + '></i>'; }).join('');
      var state_ = t.unscheduled
        ? 'not scheduled'
        : (t.done === t.total ? 'done' : t.left ? P.formatMinutes(t.left) + ' left' : 'done');
      var count = t.unscheduled ? '' : '<span class="topic-count">' + t.done + '/' + t.total + '</span>';
      return '<li class="topic-line' + (t.unscheduled ? ' is-unscheduled' : '') + '">' +
        '<span class="session-subject">' + esc(t.subject) + '</span>' +
        '<span class="topic-name">' + esc(t.name) + '</span>' +
        '<span class="topic-ticks">' + ticks + '</span>' +
        count +
        '<span class="topic-left">' + state_ + '</span>' +
      '</li>';
    }).join('') + '</ul>';
  }

  /* ---------- events ---------- */

  function addTopic(partial) {
    var t = {
      id: uid(),
      name: partial && partial.name ? partial.name : '',
      subject: partial && partial.subject ? partial.subject : '',
      confidence: 3,
      size: 'M'
    };
    state.topics.push(t);
    return t;
  }

  function wire() {
    el.examDate.min = todayISO();
    el.examDate.addEventListener('input', function () {
      state.examDate = el.examDate.value;
      renderDeadlineSummary();
      renderTopics();
      renderPlan();
      save();
    });

    el.startTime.addEventListener('input', function () {
      state.startTime = el.startTime.value || '09:00';
      save();
    });

    el.hours.addEventListener('input', function () {
      var v = parseFloat(el.hours.value);
      state.hoursPerDay = isFinite(v) ? Math.max(0, Math.min(16, v)) : 0;
      renderDeadlineSummary();
      renderPlan();
      save();
    });

    el.dayToggles.addEventListener('click', function (event) {
      var btn = event.target.closest('.wd');
      if (!btn) return;
      var wd = Number(btn.dataset.wd);
      var at = state.daysOff.indexOf(wd);
      if (at === -1) state.daysOff.push(wd); else state.daysOff.splice(at, 1);
      renderDayToggles();
      renderDeadlineSummary();
      renderPlan();
      save();
    });

    el.addPasted.addEventListener('click', function () {
      var lines = el.pasteBox.value.split('\n').map(function (l) { return l.trim(); })
        .filter(function (l) { return l.length > 0; });
      if (!lines.length) {
        el.pasteBox.focus();
        return;
      }
      lines.forEach(function (line) { addTopic({ name: line }); });
      el.pasteBox.value = '';
      renderTopics();
      markNewRows(lines.length);
      maybeFirstPlan();
      save();
    });

    el.addRow.addEventListener('click', function () {
      addTopic();
      renderTopics();
      var rows = el.rows.querySelectorAll('.topic-row');
      var last = rows[rows.length - 1];
      if (last) {
        last.classList.add('is-new');
        last.querySelector('.t-name').focus();
      }
      save();
    });

    el.rows.addEventListener('input', function (event) {
      var row = event.target.closest('.topic-row');
      if (!row) return;
      var topic = state.topics.find(function (t) { return t.id === row.dataset.id; });
      if (!topic) return;
      if (event.target.classList.contains('t-name')) topic.name = event.target.value;
      if (event.target.classList.contains('t-subject')) {
        topic.subject = event.target.value;
        renderSubjectList();
      }
      renderTopicsSummary();
      save();
      maybeFirstPlan();
    });

    el.rows.addEventListener('click', function (event) {
      var row = event.target.closest('.topic-row');
      if (!row) return;
      var topic = state.topics.find(function (t) { return t.id === row.dataset.id; });
      if (!topic) return;

      var dot = event.target.closest('.dot');
      if (dot) {
        topic.confidence = Number(dot.dataset.conf);
        row.querySelectorAll('.dot').forEach(function (d, i) {
          d.classList.toggle('is-on', i < topic.confidence);
          d.setAttribute('aria-pressed', String(i + 1 === topic.confidence));
        });
        renderTopicsSummary();
        save();
        return;
      }

      var size = event.target.closest('.size');
      if (size) {
        topic.size = size.dataset.size;
        row.querySelectorAll('.size').forEach(function (b) {
          var on = b.dataset.size === topic.size;
          b.classList.toggle('is-on', on);
          b.setAttribute('aria-pressed', String(on));
        });
        renderTopicsSummary();
        save();
        return;
      }

      if (event.target.closest('.row-del')) {
        state.topics = state.topics.filter(function (t) { return t.id !== topic.id; });
        renderTopics();
        renderPlan();
        save();
      }
    });

    el.weeks.addEventListener('change', function (event) {
      var box = event.target;
      if (!box.matches('input[type=checkbox]')) return;
      var date = box.dataset.date;
      var id = box.dataset.session;
      var day = state.plan.days.find(function (d) { return d.date === date; });
      if (!day) return;
      var session = day.sessions.find(function (s) { return s.id === id; });
      if (!session) return;
      session.done = box.checked;
      box.closest('.session').classList.toggle('is-done', session.done);
      renderProgress();
      renderRunningHead(state.plan, examIsPast());
      save();
    });

    el.planNotice.addEventListener('click', function (event) {
      if (event.target.id === 'btn-rebuild') buildPlan();
    });

    el.btnPrint.addEventListener('click', function () { window.print(); });

    el.btnSample.addEventListener('click', function () {
      setExportStatus('');
      loadSample();
    });

    el.btnIcs.addEventListener('click', function () {
      if (!state.plan) return;
      var ok = download(exportName('ics'), 'text/calendar;charset=utf-8', buildIcs(state.plan));
      setExportStatus(ok ? 'Calendar file saved. Open it to add the days to your calendar.' : 'The download was blocked by the browser.', !ok);
    });

    el.btnCsv.addEventListener('click', function () {
      if (!state.plan) return;
      var ok = download(exportName('csv'), 'text/csv;charset=utf-8', buildCsv(state.plan));
      setExportStatus(ok ? 'Spreadsheet saved — one row per session.' : 'The download was blocked by the browser.', !ok);
    });

    el.btnJson.addEventListener('click', function () {
      if (!state.plan) return;
      var ok = download(exportName('json'), 'application/json;charset=utf-8', buildBackup());
      setExportStatus(ok ? 'Copy saved. Keep it somewhere that is not this browser.' : 'The download was blocked by the browser.', !ok);
    });

    el.btnRestore.addEventListener('click', function () { el.fileRestore.click(); });
    el.btnRestoreWelcome.addEventListener('click', function () { el.fileRestore.click(); });

    el.fileRestore.addEventListener('change', function () {
      var file = el.fileRestore.files && el.fileRestore.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        var result = restoreFrom(String(reader.result || ''));
        if (result.error) setExportStatus(result.error, true);
        else setExportStatus(result.ok, false);
        el.fileRestore.value = '';
      };
      reader.onerror = function () {
        setExportStatus('That file could not be read.', true);
        el.fileRestore.value = '';
      };
      reader.readAsText(file);
    });

    el.btnRebalance.addEventListener('click', function () {
      if (!state.plan) return;
      var fresh = P.rebalance(state.plan, input());
      state.plan = fresh;
      state.planSig = signature();
      state.enterNext = true;
      save();
      renderPlan();
      if (!fresh.warning) {
        var note = document.createElement('div');
        note.className = 'notice notice-soft';
        note.textContent = 'Rebalanced. Everything still unticked now sits in the days that are left.';
        el.planNotice.insertBefore(note, el.planNotice.firstChild);
      }
    });

    el.btnReset.addEventListener('click', function () {
      var ok = window.confirm('Start over? This clears the topics and the plan saved in this browser.');
      if (!ok) return;
      try { localStorage.removeItem(STORE_KEY); } catch (err) { /* nothing to clear */ }
      state.examDate = '';
      state.hoursPerDay = 2;
      state.startTime = '09:00';
      state.daysOff = [];
      state.topics = [];
      state.plan = null;
      state.planSig = '';
      lastRowKey = null;
      el.examDate.value = '';
      el.hours.value = '2';
      el.startTime.value = '09:00';
      el.pasteBox.value = '';
      el.rows.innerHTML = '';
      renderDayToggles();
      renderDeadlineSummary();
      renderTopics();
      renderPlan();
      setExportStatus('');
      renderWelcome();
      window.scrollTo({ top: 0, behavior: scrollBehavior() });
    });
  }

  function markNewRows(count) {
    var rows = el.rows.querySelectorAll('.topic-row');
    for (var i = Math.max(0, rows.length - count); i < rows.length; i++) {
      rows[i].classList.add('is-new');
    }
  }

  // The plan appears as soon as there is something to plan, so nobody has to
  // hunt for a "build" button. After that, edits show up as a rebuild prompt.
  function maybeFirstPlan() {
    if (state.plan) { renderPlan(); return; }
    if (examIsValid() && liveTopics().length) buildPlan(true);
  }

  /* ---------- boot ---------- */

  function stampToday() {
    var d = new Date();
    el.todayStamp.textContent = P.WEEKDAYS[d.getDay()] + ' ' + d.getDate() + ' ' + P.MONTHS_SHORT[d.getMonth()];
  }

  function boot() {
    el = {
      todayStamp: $('today-stamp'),
      stepTopics: $('step-topics'),
      stepPlan: $('step-plan'),
      examDate: $('exam-date'),
      hours: $('hours'),
      startTime: $('start-time'),
      dayToggles: $('day-toggles'),
      deadlineSummary: $('deadline-summary'),
      pasteBox: $('paste-box'),
      addPasted: $('add-pasted'),
      rows: $('topic-rows'),
      subjectList: $('subject-list'),
      addRow: $('add-row'),
      topicsSummary: $('topics-summary'),
      runninghead: $('runninghead'),
      rhDays: $('rh-days'),
      rhUnit: $('rh-unit'),
      rhMeta: $('rh-meta'),
      planStats: $('plan-stats'),
      progress: $('progress'),
      progressTicks: $('progress-ticks'),
      progressText: $('progress-text'),
      todayLine: $('today-line'),
      planNotice: $('plan-notice'),
      weeks: $('weeks'),
      overflow: $('overflow'),
      btnPrint: $('btn-print'),
      btnRebalance: $('btn-rebalance'),
      btnReset: $('btn-reset'),
      welcome: $('welcome'),
      btnSample: $('btn-sample'),
      btnIcs: $('btn-ics'),
      btnCsv: $('btn-csv'),
      btnJson: $('btn-json'),
      btnRestore: $('btn-restore'),
      fileRestore: $('file-restore'),
      exportStatus: $('export-status'),
      welcomeStatus: $('welcome-status'),
      btnRestoreWelcome: $('btn-restore-welcome'),
      topicProgress: $('topic-progress'),
      topicProgressSummary: $('topic-progress-summary'),
      topicProgressBody: $('topic-progress-body')
    };

    stampToday();

    if (load()) {
      el.examDate.value = state.examDate;
      el.hours.value = String(state.hoursPerDay);
      el.startTime.value = state.startTime;
    }

    wire();
    renderDayToggles();
    renderDeadlineSummary();
    renderTopics();
    renderPlan();
    renderWelcome();

    if (!state.plan && examIsValid() && liveTopics().length) buildPlan(true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
