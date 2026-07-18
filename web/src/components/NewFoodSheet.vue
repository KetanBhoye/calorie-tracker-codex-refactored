<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { api, type LookupResult, type Suggestion } from '../api';

const props = defineProps<{ initialQuery: string }>();
const emit = defineEmits<{ created: [food: Suggestion]; cancel: [] }>();

const query = ref(props.initialQuery);
const results = ref<LookupResult[]>([]);
const searching = ref(false);
const searched = ref(false);
const saveError = ref<string | null>(null);
const saving = ref(false);

/** Manual entry, used when lookup finds nothing or the numbers look wrong. */
const manual = ref(false);
const form = ref({
  name: props.initialQuery,
  unit: 'g',
  quantity: 100,
  calories: null as number | null,
  protein: null as number | null,
  carbs: null as number | null,
  fat: null as number | null,
});

async function search(): Promise<void> {
  const term = query.value.trim();
  if (term.length < 2) return;

  searching.value = true;
  searched.value = false;
  try {
    const data = await api.lookupFood(term);
    results.value = data.results;
  } catch {
    results.value = [];
  } finally {
    searching.value = false;
    searched.value = true;
  }
}

watch(
  () => props.initialQuery,
  (value) => {
    query.value = value;
    form.value.name = value;
  },
  { immediate: true }
);

/** Macros the manual form implies, for the 4/4/9 sanity hint. */
const derivedCalories = computed(() => {
  const { protein, carbs, fat } = form.value;
  if (protein === null && carbs === null && fat === null) return null;
  return Math.round((protein ?? 0) * 4 + (carbs ?? 0) * 4 + (fat ?? 0) * 9);
});

const manualMismatch = computed(() => {
  const derived = derivedCalories.value;
  const stated = form.value.calories;
  if (derived === null || stated === null || derived === 0) return false;
  return Math.abs(stated - derived) / derived > 0.3;
});

const manualValid = computed(
  () =>
    form.value.name.trim().length > 0 &&
    form.value.quantity > 0 &&
    form.value.calories !== null &&
    form.value.calories >= 0
);

function toSuggestion(id: string, food: {
  name: string;
  unit: string;
  quantity: number;
  perUnit: { calories: number; protein: number | null; carbs: number | null; fat: number | null };
}): Suggestion {
  return {
    id,
    canonical_name: food.name,
    reference_unit: food.unit,
    calories_per_unit: food.perUnit.calories,
    protein_g_per_unit: food.perUnit.protein,
    carbs_g_per_unit: food.perUnit.carbs,
    fat_g_per_unit: food.perUnit.fat,
    default_quantity: food.quantity,
    times_logged: 0,
    last_logged: new Date().toISOString().split('T')[0]!,
  };
}

async function useResult(result: LookupResult): Promise<void> {
  saving.value = true;
  saveError.value = null;
  try {
    const name = result.brand ? `${result.brand} ${result.name}` : result.name;
    const { food_id } = await api.createFood({
      canonical_name: name,
      reference_unit: result.reference_unit,
      calories_per_unit: result.calories_per_unit,
      protein_g_per_unit: result.protein_g_per_unit ?? undefined,
      carbs_g_per_unit: result.carbs_g_per_unit ?? undefined,
      fat_g_per_unit: result.fat_g_per_unit ?? undefined,
      default_quantity: result.default_quantity,
      source: result.source,
    });

    emit(
      'created',
      toSuggestion(food_id, {
        name,
        unit: result.reference_unit,
        quantity: result.default_quantity,
        perUnit: {
          calories: result.calories_per_unit,
          protein: result.protein_g_per_unit,
          carbs: result.carbs_g_per_unit,
          fat: result.fat_g_per_unit,
        },
      })
    );
  } catch {
    saveError.value = "Couldn't save that food. Check your connection.";
  } finally {
    saving.value = false;
  }
}

async function saveManual(): Promise<void> {
  if (!manualValid.value) return;

  saving.value = true;
  saveError.value = null;
  try {
    // The form captures macros for the whole portion; the library stores
    // per-unit values, so divide before saving.
    const q = form.value.quantity;
    const perUnit = {
      calories: form.value.calories! / q,
      protein: form.value.protein === null ? null : form.value.protein / q,
      carbs: form.value.carbs === null ? null : form.value.carbs / q,
      fat: form.value.fat === null ? null : form.value.fat / q,
    };

    const { food_id } = await api.createFood({
      canonical_name: form.value.name.trim(),
      reference_unit: form.value.unit,
      calories_per_unit: perUnit.calories,
      protein_g_per_unit: perUnit.protein ?? undefined,
      carbs_g_per_unit: perUnit.carbs ?? undefined,
      fat_g_per_unit: perUnit.fat ?? undefined,
      default_quantity: q,
      source: 'manual',
    });

    emit('created', toSuggestion(food_id, { name: form.value.name.trim(), unit: form.value.unit, quantity: q, perUnit }));
  } catch {
    saveError.value = "Couldn't save that food. Check your connection.";
  } finally {
    saving.value = false;
  }
}

function per100(value: number | null): string {
  return value === null ? '—' : String(Math.round(value * 100 * 10) / 10);
}
</script>

<template>
  <div class="backdrop" @click.self="emit('cancel')">
    <div class="sheet" role="dialog" aria-label="Add a new food">
      <div class="grabber"></div>

      <div class="spread" style="margin-bottom: 14px">
        <button class="link" @click="emit('cancel')">Back</button>
        <strong>Add a food</strong>
        <span style="width: 44px"></span>
      </div>

      <template v-if="!manual">
        <div class="row">
          <input
            v-model="query"
            type="search"
            placeholder="Search food databases…"
            @keyup.enter="search"
          />
          <button class="btn search-btn" :disabled="query.trim().length < 2" @click="search">
            Find
          </button>
        </div>

        <div class="list">
          <div v-if="searching" class="skeleton" style="height: 64px; margin-top: 12px"></div>

          <template v-else-if="searched">
            <p v-if="results.length === 0" class="muted hint">
              Nothing found in Open Food Facts. Most home-cooked Indian dishes aren't in it —
              enter the macros yourself below.
            </p>

            <button
              v-for="(result, index) in results"
              :key="index"
              class="item"
              :disabled="saving"
              @click="useResult(result)"
            >
              <span class="item-name">
                {{ result.brand ? `${result.brand} — ` : '' }}{{ result.name }}
              </span>
              <span class="muted item-sub">
                per 100{{ result.reference_unit }}:
                {{ Math.round(result.calories_per_unit * 100) }} kcal ·
                P{{ per100(result.protein_g_per_unit) }} ·
                C{{ per100(result.carbs_g_per_unit) }} ·
                F{{ per100(result.fat_g_per_unit) }}
              </span>
              <span v-if="result.suspect" class="warn-chip">
                ⚠ these numbers don't add up — check before using
              </span>
            </button>
          </template>

          <p v-else class="muted hint">
            Search a packaged product by name, or enter macros manually.
          </p>
        </div>

        <button class="btn btn-ghost wide" @click="manual = true">Enter macros manually</button>
      </template>

      <template v-else>
        <div class="field">
          <label>Name</label>
          <input v-model="form.name" type="text" placeholder="e.g. Masoor ki sabji" />
        </div>

        <div class="grid2">
          <div class="field">
            <label>Portion</label>
            <input v-model.number="form.quantity" type="number" inputmode="decimal" min="0" />
          </div>
          <div class="field">
            <label>Unit</label>
            <select v-model="form.unit">
              <option value="g">g</option>
              <option value="ml">ml</option>
              <option value="piece">piece</option>
              <option value="scoop">scoop</option>
              <option value="serving">serving</option>
            </select>
          </div>
        </div>

        <p class="muted note">Macros for that whole portion:</p>

        <div class="grid2">
          <div class="field">
            <label>Calories</label>
            <input v-model.number="form.calories" type="number" inputmode="decimal" min="0" />
          </div>
          <div class="field">
            <label>Protein (g)</label>
            <input v-model.number="form.protein" type="number" inputmode="decimal" min="0" />
          </div>
          <div class="field">
            <label>Carbs (g)</label>
            <input v-model.number="form.carbs" type="number" inputmode="decimal" min="0" />
          </div>
          <div class="field">
            <label>Fat (g)</label>
            <input v-model.number="form.fat" type="number" inputmode="decimal" min="0" />
          </div>
        </div>

        <p v-if="manualMismatch" class="warn-note">
          Those macros work out to about {{ derivedCalories }} kcal, not
          {{ form.calories }}. Worth a second look — one of them is probably a typo.
        </p>

        <div class="row" style="margin-top: 16px">
          <button class="btn btn-ghost" style="flex: 1" @click="manual = false">Back</button>
          <button
            class="btn"
            style="flex: 2"
            :disabled="!manualValid || saving"
            @click="saveManual"
          >
            {{ saving ? 'Saving…' : 'Save & log' }}
          </button>
        </div>
      </template>

      <p v-if="saveError" class="error">{{ saveError }}</p>
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 60;
  display: flex;
  align-items: flex-end;
}

.sheet {
  width: 100%;
  max-height: 92dvh;
  overflow-y: auto;
  background: var(--surface);
  border-radius: 20px 20px 0 0;
  border-top: 1px solid var(--border);
  padding: 10px 16px calc(20px + env(safe-area-inset-bottom));
  animation: slide 0.22s cubic-bezier(0.32, 0.72, 0, 1);
}

.grabber {
  width: 38px;
  height: 4px;
  background: var(--border);
  border-radius: 999px;
  margin: 0 auto 14px;
}

.link {
  color: var(--accent);
  font-size: 15px;
  min-height: auto;
  padding: 4px;
  width: 44px;
  text-align: left;
}

.search-btn {
  flex-shrink: 0;
  padding: 12px 20px;
}

.list {
  margin: 14px 0;
}

.item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  width: 100%;
  text-align: left;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 10px 14px;
  margin-bottom: 8px;
}

.item:active {
  border-color: var(--accent-dim);
}

.item-name {
  font-size: 15px;
}

.item-sub {
  font-size: 12px;
}

.warn-chip {
  color: var(--warn);
  font-size: 12px;
  margin-top: 2px;
}

.wide {
  width: 100%;
}

.field {
  margin-bottom: 12px;
}

.field label {
  display: block;
  font-size: 12.5px;
  color: var(--text-dim);
  margin-bottom: 5px;
}

.grid2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 12px;
}

.note {
  font-size: 13px;
  margin: 4px 0 10px;
}

.warn-note {
  color: var(--warn);
  font-size: 13px;
  background: rgba(251, 191, 36, 0.1);
  border-radius: 10px;
  padding: 10px 12px;
  margin: 4px 0 0;
}

.error {
  color: var(--danger);
  font-size: 13px;
  text-align: center;
  margin-top: 10px;
}

.hint {
  font-size: 14px;
  padding: 16px 4px;
  text-align: center;
}

@keyframes slide {
  from {
    transform: translateY(100%);
  }
}
</style>
