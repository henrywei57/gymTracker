# Iron Log — gym schedule

A single-page weekly gym planner that runs in the browser on a phone or a laptop.
No build step, no backend: plain HTML, CSS and JavaScript, with everything stored
in the browser's `localStorage`, so each browser keeps its own copy.

**Live site:** https://henrywei57.github.io/gymTracker/

## What it does

- **Today** — shows the session planned for the current weekday and lets you mark each
  exercise **Done**, **Partial** or **Skipped**. Marks are stored per date, so each week
  keeps its own record.
- **Schedule** — a Mon–Sun plan. Each day gets a session name, an optional time and a list
  of exercises with target sets, reps and weight. Templates for Push/Pull/Legs,
  Upper/Lower and Full Body fill the week in one click.
- **History** — every day you marked off, plus the calendar and training streak.
- **Exercises & PRs** — your exercise list and personal records.
- **Stats** — streaks, days trained and estimated 1RM progress.

## Importing a plan

The Schedule tab imports a session — or a whole week — from plain text you paste or
upload as a `.txt` file:

```
Monday - Push Day
Bench Press/4/8/60
Overhead Press/3/10/35

Tuesday: Pull Day
Barbell Row/4/8/60
Lat Pulldown/3/10/45

Wednesday - Rest

Thursday - Leg Day
Back Squat/5/5/100
```

- A line naming a weekday starts that day; the rest of the line becomes the session name.
- `Wednesday - Rest` clears a day.
- Exercise lines are `Name/sets/reps/weight`. `|`, `,` and tabs work as separators too, and
  `Bench Press 3x8 @ 60` is understood.
- Weight is optional, units are ignored, and exercises you don't have yet are created
  automatically with a guessed category.

## Running it locally

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>. It also installs as a PWA from the browser's
"Add to Home Screen".
