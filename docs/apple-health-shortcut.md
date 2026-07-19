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

Shortcuts app → **+** → add these actions in order:

1. **Find Health Samples**
   - Type: `Steps`, Date `is today`, **Sum** results
   - Rename the output variable to `Steps`
2. **Find Health Samples** — `Active Energy`, today, Sum → `ActiveEnergy`
3. **Find Health Samples** — `Exercise Minutes`, today, Sum → `ExerciseMinutes`
4. **Find Health Samples** — `Walking + Running Distance`, today, Sum → `Distance`
5. **Format Date**
   - Date: `Current Date`
   - Format: Custom, `yyyy-MM-dd` → `Today`
   - This is your local calendar day, which is what the app stores.
6. **Get Contents of URL**
   - URL: `https://calorie-tracker-codex-refactored-production.up.railway.app/api/activity`
   - Method: **POST**
   - Headers:
     - `Authorization` → `Bearer <your token>`
     - `Content-Type` → `application/json`
   - Request Body: **JSON**

     | Key | Type | Value |
     |---|---|---|
     | `activity_date` | Text | `Today` |
     | `steps` | Number | `Steps` |
     | `active_energy_kcal` | Number | `ActiveEnergy` |
     | `exercise_minutes` | Number | `ExerciseMinutes` |
     | `distance_km` | Number | `Distance` |

Name it **Push Health to NutriAI**.

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
