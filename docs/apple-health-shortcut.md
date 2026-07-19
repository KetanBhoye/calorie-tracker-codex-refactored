# Apple Health → NutriAI (daily 11:40 PM push)

## Why a Shortcut and not a direct integration

iOS gives web apps **no HealthKit access**. There is no permission prompt a PWA
can trigger — the API isn't exposed to Safari at all. The only ways to read
Health data are a native app (Mac + Xcode + $99/yr Apple Developer account) or
the Shortcuts app, which can read Health and make HTTP requests.

This uses Shortcuts. Free, no Mac, runs unattended once set up.

## What it sends

`POST /api/activity` upserts one row per day:

| Field | Health source | Used for |
|---|---|---|
| `steps` | Steps | Steps average on the Plan tab, vs your daily step goal |
| `active_energy_kcal` | Active Energy | Recorded, not added to TDEE — see below |
| `resting_energy_kcal` | Resting Energy | Recorded for reference |
| `exercise_minutes` | Exercise Minutes | Training consistency |
| `stand_hours` | Stand Hours | Optional |
| `distance_km` | Walking + Running Distance | Optional |

Every field is optional. Re-running for a day already recorded **corrects** it
rather than duplicating, and a partial push leaves other fields intact — so
you can start with steps alone and add more later.

### Why active energy is not added to your deficit

Your deficit on the Plan tab is `TDEE − intake`. TDEE already includes the
movement you normally do. Adding Apple Health active energy on top would count
that movement twice and inflate the deficit — the single most common way a
tracker like this quietly lies to you. Active energy is stored, and shown, but
never folded into the deficit maths.

Same reason your own notes say not to eat back Watch active calories.

## Setup (about 10 minutes)

### 1. Get an API token

Open the app → **Plan** tab → scroll to **Connections** → **Generate API token**,
then Copy.

The token is shown once. Generating a new one **invalidates the previous
token**, so anything already using it — the Health Shortcut, the Claude
connector — stops working until you paste the new one in.

### 2. Build the Shortcut

Shortcuts app → **+** → add these actions.

**Find Health Samples returns a list of individual samples, not a total**, so
each metric needs a pair of actions: one to find the samples, one to sum them.

For each of the four metrics below, add **three** actions:

1. **Find Health Samples**
   - `Type` is the metric, `Start Date` **is today**
   - Leave Group by / Sort by as `None` and Limit off
2. **Calculate Statistics**
   - Operation: **Sum**, Input: the `Health Samples` from the action above
3. **Set Variable** — store the result under the name in the table

| Metric | Health type | Variable name |
|---|---|---|
| Steps | `Steps` | `Steps` |
| Active energy | `Active Energy` | `ActiveEnergy` |
| Exercise | `Exercise Minutes` | `ExerciseMinutes` |
| Distance | `Walking + Running Distance` | `Distance` |

The `Set Variable` steps are not optional. Without them you end up with four
actions all named "Statistics" and four named "Health Samples", and when
building the JSON body there is no way to tell them apart — sending your step
count as your calorie burn is a very easy mistake to make and a hard one to
notice afterwards.

When adding each `Calculate Statistics`, check it references the `Health
Samples` from the Find directly above it rather than an earlier one.

**Build the steps pair first and run it (▶︎) before adding the rest.** Check the
number against today's figure in the Health app. If it doesn't match, the rest
of the shortcut is built on a broken assumption — fix it here.

Then:

3. **Format Date**
   - Date: `Current Date`
   - Format: Custom, `yyyy-MM-dd` → name it `Today`
   - This is your local calendar day, which is what the app stores.
4. **Get Contents of URL**
   - URL: `https://calorie-tracker-codex-refactored-production.up.railway.app/api/activity`
   - Method: **POST**
   - Headers:
     - `Authorization` → `Bearer <your token>`
       — the literal word `Bearer`, a space, then the token. The token on its
       own returns 401.
     - `Content-Type` → `application/json`
   - Request Body: **JSON**

     | Key | Type | Value |
     |---|---|---|
     | `activity_date` | Text | `Today` |
     | `steps` | Number | `Steps` |
     | `active_energy_kcal` | Number | `ActiveEnergy` |
     | `exercise_minutes` | Number | `ExerciseMinutes` |
     | `distance_km` | Number | `Distance` |

Field names must match exactly — `exercise_minutes`, not `excercise_minutes`.
The endpoint rejects unknown keys and names the offending one, so a typo fails
loudly instead of silently dropping that metric every night.

Name it **Push Health to NutriAI**.

Every field is optional server-side, so if one metric proves awkward, leave it
out and the rest still work.

### 3. Automate at 11:40 PM

Automation tab → **Create Personal Automation** → **Time of Day**
→ `11:40 PM`, **Daily** → **Run Immediately**, and turn **Notify When Run** off.

11:40 PM is late enough to capture nearly the whole day and early enough that
the date hasn't rolled over. Running at midnight risks recording an empty day.

## Verifying it works

After the first run:

```bash
curl -H "Authorization: Bearer <token>" \
  "https://calorie-tracker-codex-refactored-production.up.railway.app/api/activity?days=7"
```

Or open the **Plan** tab in the app — `STEPS AVG` fills in once there's data.

## If a value looks wrong

The endpoint rejects implausible numbers rather than storing them: steps above
200,000, energy above 20,000 kcal, exercise above 1440 minutes. A rejected push
returns `400` and stores nothing, so a bad Health reading can't distort the
charts. Re-run the Shortcut for that day to correct it.
