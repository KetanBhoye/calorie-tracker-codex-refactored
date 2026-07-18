# Apple Health → NutriAI

## Why a Shortcut and not a direct integration

iOS gives web apps **no HealthKit access**. There is no permission prompt a PWA
can trigger — the API simply isn't exposed to Safari. The only ways to read
Health data are a native app (Mac + Xcode + $99/yr Apple Developer account) or
the Shortcuts app, which can read Health and make HTTP requests.

This uses Shortcuts. It's free, needs no Mac, and runs unattended once set up.

## What gets stored

`POST /api/activity` upserts one row per day in `daily_activity`:

| Field | Health source |
|---|---|
| `steps` | Steps |
| `active_energy_kcal` | Active Energy |
| `resting_energy_kcal` | Resting Energy |
| `exercise_minutes` | Exercise Minutes |
| `stand_hours` | Stand Hours |
| `distance_km` | Walking + Running Distance |

Every field is optional. Re-running for a day already recorded **corrects** it
rather than duplicating, and a partial push (say, steps only) leaves the other
fields intact — so you can start with steps and add more later.

Active and resting energy are stored separately on purpose. Your TDEE already
includes resting burn, so adding both to it would double-count.

## Setup

### 1. Get an API token

Sign in to the app, then:

```bash
curl -X POST https://calorie-tracker-codex-refactored-production.up.railway.app/api/tokens/rotate \
  -H "Cookie: ct_sid=<your session cookie>"
```

Copy the token. Treat it like a password — it grants full access to your log.
Rotating issues a new token and invalidates the old one.

### 2. Build the Shortcut

In the Shortcuts app, create a new shortcut with these actions in order:

1. **Find Health Samples** — Steps, where Date is Today, **Sum** the results.
   Set variable `Steps`.
2. **Find Health Samples** — Active Energy, Date is Today, Sum → `ActiveEnergy`.
3. **Find Health Samples** — Exercise Minutes, Date is Today, Sum → `ExerciseMinutes`.
4. **Format Date** — Current Date, custom format `yyyy-MM-dd` → `Today`.
   Use the local date, not UTC: a day here is your local calendar day.
5. **Get Contents of URL**:
   - URL: `https://calorie-tracker-codex-refactored-production.up.railway.app/api/activity`
   - Method: **POST**
   - Headers:
     - `Authorization`: `Bearer <your token>`
     - `Content-Type`: `application/json`
   - Request Body: **JSON**
     ```
     activity_date  (Text)   → Today
     steps          (Number) → Steps
     active_energy_kcal (Number) → ActiveEnergy
     exercise_minutes   (Number) → ExerciseMinutes
     ```

### 3. Automate it

Automation tab → **Create Personal Automation** → **Time of Day** → 11:30 PM,
Daily → run this shortcut. Turn **Ask Before Running** off so it runs silently.

Late evening is deliberate: run it at midnight and you risk recording a day
that has just rolled over.

## Verifying

```bash
curl -H "Authorization: Bearer <token>" \
  "https://calorie-tracker-codex-refactored-production.up.railway.app/api/activity?days=7"
```

## Validation

The endpoint rejects implausible values rather than storing them (steps above
200,000, energy above 20,000 kcal, exercise above 1440 minutes). A rejected
push returns 400 and stores nothing, so a bad Health reading can't distort the
charts built on this data.
