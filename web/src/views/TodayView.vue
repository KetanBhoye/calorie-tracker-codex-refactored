<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import {
  api,
  pendingCount,
  type FoodEntry,
  type MealType,
  type Suggestion,
  type Totals,
} from '../api';
import MacroBar from '../components/MacroBar.vue';
import NewFoodSheet from '../components/NewFoodSheet.vue';
import PortionSheet from '../components/PortionSheet.vue';
import QuickLogSheet from '../components/QuickLogSheet.vue';

const MEALS: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];

/** Targets from the tracking preferences; the cut goals. */
const GOALS = { calories: 1900, protein_g: 150, carbs_g: 190, fat_g: 63 };

const today = new Date().toISOString().split('T')[0]!;
const entries = ref<FoodEntry[]>([]);
const totals = ref<Totals>({ calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });
const loading = ref(true);
const loadError = ref<string | null>(null);

const activeMeal = ref<MealType | null>(null);
const suggestions = ref<Suggestion[]>([]);
const suggestionsLoading = ref(false);

/** Set while adjusting a portion; null when the quick list is showing. */
const adjusting = ref<Suggestion | null>(null);
/** Set while adding a food that isn't in the library. */
const addingNew = ref<string | null>(null);

/** Meal slot guessed from the clock, so the sheet opens on the likely one. */
function currentMeal(): MealType {
  const hour = new Date().getHours();
  if (hour < 11) return 'breakfast';
  if (hour < 16) return 'lunch';
  if (hour < 21) return 'dinner';
  return 'snack';
}

function recomputeTotals(): void {
  totals.value = entries.value.reduce(
    (acc, entry) => ({
      calories: acc.calories + entry.calories,
      protein_g: acc.protein_g + (entry.protein_g ?? 0),
      carbs_g: acc.carbs_g + (entry.carbs_g ?? 0),
      fat_g: acc.fat_g + (entry.fat_g ?? 0),
    }),
    { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
  );
}

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  try {
    const data = await api.getEntries(today);
    entries.value = data.entries;
    recomputeTotals();
  } catch {
    // The service worker serves the last cached day when offline; a hard
    // failure here means there is nothing cached either.
    loadError.value = "Couldn't load today's entries.";
  } finally {
    loading.value = false;
  }
}

async function openMeal(meal: MealType): Promise<void> {
  activeMeal.value = meal;
  suggestions.value = [];
  suggestionsLoading.value = true;
  try {
    const data = await api.getSuggestions(meal);
    suggestions.value = data.suggestions;
  } catch {
    suggestions.value = [];
  } finally {
    suggestionsLoading.value = false;
  }
}

/**
 * Logs a food at a given portion, defaulting to the usual amount. Writes
 * optimistically; the queue guarantees delivery.
 */
function logSuggestion(
  suggestion: Suggestion,
  meal: MealType,
  portion?: number
): void {
  const quantity = portion ?? suggestion.default_quantity;
  const scale = (value: number | null) =>
    value === null ? null : Math.round(value * quantity * 10) / 10;

  const entry: FoodEntry = {
    id: crypto.randomUUID(),
    food_name: suggestion.canonical_name,
    calories: Math.round(suggestion.calories_per_unit * quantity),
    protein_g: scale(suggestion.protein_g_per_unit),
    carbs_g: scale(suggestion.carbs_g_per_unit),
    fat_g: scale(suggestion.fat_g_per_unit),
    meal_type: meal,
    entry_date: today,
    pending: true,
  };

  entries.value = [entry, ...entries.value];
  recomputeTotals();

  api.createEntry({
    food_name: entry.food_name,
    calories: entry.calories,
    protein_g: entry.protein_g ?? undefined,
    carbs_g: entry.carbs_g ?? undefined,
    fat_g: entry.fat_g ?? undefined,
    meal_type: meal,
    entry_date: today,
    food_id: suggestion.id,
    quantity,
    unit: suggestion.reference_unit,
  });

  activeMeal.value = null;
  adjusting.value = null;
  addingNew.value = null;
  if (navigator.vibrate) navigator.vibrate(8);
}

/** A newly created food goes straight to the portion step, pre-filled. */
function onFoodCreated(food: Suggestion): void {
  addingNew.value = null;
  adjusting.value = food;
}

function removeEntry(entry: FoodEntry): void {
  entries.value = entries.value.filter((candidate) => candidate.id !== entry.id);
  recomputeTotals();
  if (!entry.pending) api.deleteEntry(entry.id);
}

const byMeal = computed(() => {
  const grouped: Record<MealType, FoodEntry[]> = {
    breakfast: [],
    lunch: [],
    dinner: [],
    snack: [],
  };
  for (const entry of entries.value) {
    if (entry.meal_type) grouped[entry.meal_type].push(entry);
  }
  return grouped;
});

const remaining = computed(() => Math.max(0, GOALS.calories - totals.value.calories));

watch(activeMeal, (meal) => {
  document.body.style.overflow = meal ? 'hidden' : '';
});

// Once the write queue drains, nothing on screen is still pending — clear the
// badges rather than leaving rows labelled "queued" after they've synced.
watch(pendingCount, (count) => {
  if (count === 0) {
    entries.value = entries.value.map((entry) =>
      entry.pending ? { ...entry, pending: false } : entry
    );
  }
});

onMounted(load);
</script>

<template>
  <div class="page">
    <header class="spread">
      <div>
        <h1>Today</h1>
        <p class="muted" style="margin: 0; font-size: 14px">
          {{ new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' }) }}
        </p>
      </div>
      <div style="text-align: right">
        <div style="font-size: 26px; font-weight: 700">{{ totals.calories }}</div>
        <div class="muted" style="font-size: 13px">{{ remaining }} left</div>
      </div>
    </header>

    <!-- Primary path: opens straight onto the meal slot the clock implies,
         so a repeat log is two taps from launch. -->
    <button class="btn quick" @click="openMeal(currentMeal())">
      Quick log {{ currentMeal() }}
    </button>

    <div v-if="loading" class="card" style="margin-top: 16px">
      <div class="skeleton" style="height: 18px; width: 45%; margin-bottom: 14px"></div>
      <div class="skeleton" style="height: 10px; margin-bottom: 8px"></div>
      <div class="skeleton" style="height: 10px; width: 70%"></div>
    </div>

    <div v-else-if="loadError" class="card" style="margin-top: 16px">
      <p style="margin: 0 0 12px">{{ loadError }}</p>
      <button class="btn btn-ghost" @click="load">Try again</button>
    </div>

    <template v-else>
      <MacroBar :totals="totals" :goals="GOALS" />

      <section v-for="meal in MEALS" :key="meal">
        <h2>{{ meal }}</h2>

        <TransitionGroup name="fade" tag="div">
          <div v-for="entry in byMeal[meal]" :key="entry.id" class="entry">
            <div style="min-width: 0">
              <div class="entry-name">{{ entry.food_name }}</div>
              <div class="muted" style="font-size: 13px">
                {{ entry.calories }} kcal
                <template v-if="entry.protein_g"> · {{ entry.protein_g }}g protein</template>
                <span v-if="entry.pending" class="pending">queued</span>
              </div>
            </div>
            <button
              class="remove"
              :aria-label="`Remove ${entry.food_name}`"
              @click="removeEntry(entry)"
            >
              ×
            </button>
          </div>
        </TransitionGroup>

        <button class="add" @click="openMeal(meal)">
          + Add {{ meal }}
        </button>
      </section>
    </template>

    <QuickLogSheet
      v-if="activeMeal && !adjusting && addingNew === null"
      :meal="activeMeal"
      :suggestions="suggestions"
      :loading="suggestionsLoading"
      @select="logSuggestion($event, activeMeal!)"
      @adjust="adjusting = $event"
      @add-new="addingNew = $event"
      @close="activeMeal = null"
    />

    <PortionSheet
      v-if="adjusting"
      :food="adjusting"
      @confirm="logSuggestion(adjusting!, activeMeal!, $event)"
      @cancel="adjusting = null"
    />

    <NewFoodSheet
      v-if="addingNew !== null"
      :initial-query="addingNew"
      @created="onFoodCreated"
      @cancel="addingNew = null"
    />
  </div>
</template>

<style scoped>
.quick {
  width: 100%;
  margin-top: 16px;
  font-size: 16px;
  text-transform: capitalize;
}

.entry {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 12px 14px;
  margin-bottom: 8px;
}

.entry-name {
  font-size: 15px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pending {
  margin-left: 8px;
  color: var(--warn);
  font-size: 12px;
}

.remove {
  flex-shrink: 0;
  width: var(--tap);
  height: var(--tap);
  font-size: 24px;
  color: var(--text-dim);
  border-radius: 10px;
}

.remove:active {
  background: var(--surface-2);
}

.add {
  width: 100%;
  border: 1px dashed var(--border);
  border-radius: 12px;
  padding: 12px;
  color: var(--text-dim);
  font-size: 15px;
}

.add:active {
  background: var(--surface-2);
}
</style>
