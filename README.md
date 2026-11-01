# Plan It

**Live:** https://payrghfgh.github.io/plan-it/ (GitHub Pages, `main` branch, root)

A static study planner for one exam. You give it a date, the hours you can
actually study, your days off, and a list of topics. It gives you a day-by-day
timetable, and it keeps it — ticks, sessions and all — in `localStorage`.

No backend, no API keys, no build step. Plain HTML, CSS and JavaScript. Drop the
folder on any static host and it works.

## Run it locally

Any static file server will do. From this folder:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

Opening `index.html` straight from the file system mostly works too, but some
browsers block `localStorage` on `file://`, which would stop the plan from being
saved between visits. Use the server above.

## Deploy

### GitHub Pages

Already on. Settings → Pages → Deploy from a branch → `main` / `/ (root)`. Every
push to `main` republishes. Pages needs the repository to be public on a free
GitHub plan; on a paid plan a private repository works too.

### Netlify

The repo is deployable as-is.

- **Drag and drop:** run `netlify deploy --dir . --prod`, or drop the folder on
  the Netlify dashboard.
- **From Git:** connect the repo, leave the build command empty, and set the
  publish directory to `.` (already in `netlify.toml`).

## Environment variables

None. There is no `.env` to fill in; `.env.example` is empty on purpose and only
exists so nobody wonders whether something is missing.

## How it looks, and why

The page is set like a printed planner rather than a dashboard: one column of
type with a working margin down the left, hairline rules instead of boxes, dotted
leaders between a topic and its minutes, and amber kept for the day you are
actually on. Three faces do the work — Newsreader for headings and day names,
IBM Plex Sans for running text, IBM Plex Mono for anything countable.

- **The margin.** Steps are numbered in the gutter, and the plan's totals, tick
  strip and session count live there too, so the timetable itself stays clean.
- **Day rows, not cards.** A date in the left column, the day name in serif, and
  the sessions underneath. Today's row is the one amber band on the page.
- **Write-on lines.** Topic and subject are filled in on a single rule, the way
  you would write them on paper. No input boxes.
- **The tick strip.** One thin tick per session rather than a progress bar, so
  you can see the shape of the fortnight at a glance.
- **The line about today.** "1 h 15 m today: Fractions and ratios, then
  Kinematics." Plain, no cheerleading, and it changes as you tick things off.

The nearest alternatives are MyStudyLife (a full school calendar with an AI
coach), Todait (time tracking and analytics), and the various exam-countdown
apps that pair a timer with a syllabus tracker. Most of them are accounts,
sync and a subscription for the part that actually plans anything, and their
interfaces are colour-coded cards with urgency. Plan It is deliberately the
other thing: one exam, one page, no account, and the plan is the whole point.

## Motion

The motion follows the design-engineering rules in the Design skill: quiet,
fast, and only where it earns its place.

- Custom curves, never the built-in easings — `cubic-bezier(0.23, 1, 0.32, 1)`
  for anything entering or responding.
- Exact transition properties, never `transition: all`.
- Nothing over 300ms. Press feedback is 160ms; the tick is 150ms.
- Every pressable thing scales to `0.97` on `:active`, so the interface
  acknowledges the press. Tap highlight is off, because there is real feedback.
- The plan's days rise in 40ms apart when a plan is built or rebalanced, and
  only then — not on every keystroke.
- The check mark is a transition, not a keyframe, so ticking and unticking
  quickly retargets mid-flight instead of restarting.
- Hover states sit behind `@media (hover: hover) and (pointer: fine)` so a tap
  on a phone does not leave a stuck hover.
- `prefers-reduced-motion: reduce` keeps colour and opacity changes and drops
  the movement, including the programmatic scroll.

## Craft floor

The Impeccable pass fixed the things a design-system habit usually skips:

- **Contrast.** `--muted` was 4.15:1 on the sheet, which fails for small text.
  It is now `#5c6a7c` — 5.2:1 on the sheet, 4.5:1 on the page, 5.5:1 on paper.
- **No coloured edge bars.** The today row and the notices used a 2px
  `border-left`. Both are now a tinted surface with a 1px rule, or nothing.
- **Mono is for data, not for costume.** Times, dates, totals and the size
  scale stay in Plex Mono. Step labels, form labels, buttons, weekday toggles
  and subject tags moved to Plex Sans, so the mono reads as measurement rather
  than as "technical".
- **Browser surfaces.** Selection, caret, scrollbar, focus rings and tabular
  numerals are all themed from the palette.
- **States.** Empty (no topics yet), disabled (a finished plan is read-only),
  error (a date in the past, zero hours), success (the rebalance note).
- **Touch targets.** 32–36px for the small controls on a phone, and the session
  row is a 36px-tall target with a 16px box.
- **Long content.** A long subject tag ellipsizes instead of squeezing the topic
  name; a long topic name wraps; nothing scrolls sideways at 360px.
- **Dead code.** Removed the unused `.hint` and `.session-body` rules and the
  `is-revision` class that had no styles behind it.

The mechanical detector (`npx impeccable detect`) is clean on the rendered page.
A file-only scan reports three `cramped-padding` warnings on `.step`, all false
positives: the padding is 34px and the static scan does not resolve it from the
linked stylesheet.

## What it does beyond the plan

- **A first-run welcome** with one honest sentence about what the page does and
  a **See a sample plan** button that loads a realistic eight-topic exam in one
  click, so the planner can be judged before anything is typed.
- **Take it with you** — export from the plan:
  - `.ics` calendar file: **one timed event per session**, laid out through the
    day from the start time set in step 1, with the 10-minute breaks between
    split chunks left as real gaps. Floating local times (no `Z`, no `TZID`), so
    every calendar reads them in the importer's own timezone. Plus an all-day
    event on the exam date carrying the leftover "if you get time" topics in its
    description. Standard iCalendar — Apple Calendar, Google Calendar, Outlook,
    Thunderbird, anything. Folded to RFC 5545 at 75 octets, CRLF line endings,
    commas and semicolons escaped.
  - `.csv`: one row per session, plus the "if you get time" leftovers, ready for
    a spreadsheet.
  - `.json` backup of the whole plan including every tick, and **Restore**, which
    works from the welcome screen too — so a cleared browser is not the end of
    the plan. A file that is not a backup is refused with a plain message.
- **Where each topic stands**: every topic with its sessions, how many are done,
  and how much time is left, including the ones that did not fit at all.

## The calendar file

There is no Google or Apple integration to connect, and nothing to sign into:
the export is a plain `.ics`, which every calendar app already understands.
Import it once and the timetable is yours — Apple Calendar (File → Import),
Google Calendar (Settings → Import & export), Outlook (File → Open & Export).

Because a plan is measured in minutes rather than clock times, step 1 asks when
you start studying (default 09:00). The export lays each day out from that time
in order, so a 45-minute session, a 10-minute break and a 30-minute session come
out as 09:00–09:45, then 09:55–10:25.

## Files

| File | What it is |
| --- | --- |
| `index.html` | The three steps: deadline, topics, plan |
| `styles.css` | Slate and off-white, amber for today, dark mode, print stylesheet |
| `planner.js` | The scheduling engine. Pure functions, no DOM |
| `app.js` | Reads the form, calls the engine, draws the plan, saves to `localStorage` |
| `tests/acceptance.js` | Every check from the brief, runnable with `node` |

## The scheduling rules

`planner.js` implements the brief's algorithm directly, so the numbers can be
argued with in one place.

- **Topic estimate.** `base × (6 − confidence) / 3`, rounded to the nearest 15
  minutes, never below 15. `base` is 30 / 60 / 120 for S / M / L. So a solid
  topic gets a third of the time of a shaky one.
- **Capacity.** Every date from today to the day before the exam, minus your days
  off, multiplied by your hours per day.
- **Feasibility.** If the work plus a 20% revision reserve does not fit, the
  lowest-priority topics — highest confidence first, then smallest — come off the
  plan and appear under "If you get time". Nothing is dropped silently, and the
  warning names the shortfall in hours. At least one topic always stays, so a
  tight plan still schedules something rather than nothing.
- **Order.** Weakest topic first, then largest.
- **Revision reserve.** The last 15% of study days take no new work; only reviews
  land there.
- **Sessions.** Nothing over 45 minutes. A longer topic is split into chunks with
  a 10-minute break between them, and a topic can carry over to the next day.
- **Interleaving.** No two sessions of the same subject back to back while
  another subject still has topics left.
- **Spaced repetition.** A 15-minute review 2 days and 7 days after a topic's
  first session, when that date is before the exam and the day has room.
- **Rebalance.** Ticked sessions stay exactly where they are. Everything unticked
  — including days that have already passed — goes back into the queue and is
  rescheduled into the days that are left. What will not fit goes to "If you get
  time".

### Two judgement calls worth knowing about

- **Breaks are not counted against the daily hours.** The hours you set are study
  hours, so a 2-hour day can hold 120 minutes of sessions plus the 10-minute
  breaks between the chunks of a long topic. The day card shows study minutes
  only, and breaks appear as their own line.
- **The 45-minute cap wins over "split into two sessions".** A two-hour L topic
  splits into three chunks (45 / 45 / 30), not two of 60, because no session is
  allowed past 45 minutes.
- **Interleaving applies to first-pass sessions.** Reviews are pinned to their
  spaced dates, so on a day where one subject is all that is left, a review can
  sit next to a session of the same subject.

## Checks

```bash
node tests/acceptance.js
```

Thirty-four checks covering the brief's acceptance list (10-day plan, over
capacity, interleaving, revision tail, exam tomorrow, zero hours, ticking
survives a reload, rebalance after missing three days) plus invariants swept
across 1–6 hours per day and 1–20 day horizons: no day over budget, no session
over 45 minutes, and nothing lost between the plan and the overflow list.

## Saved data

One key: `planit.v1` in `localStorage`, holding the date, hours, days off,
topics, and the built plan with its ticks. "Start over" clears it. Nothing is
sent anywhere.
