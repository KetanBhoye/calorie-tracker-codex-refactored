<script setup lang="ts">
import { computed, ref } from 'vue';
import type { FoodEntry, MealType } from '../api';

const props = defineProps<{ entry: FoodEntry }>();
const emit = defineEmits<{
  save: [changes: Partial<FoodEntry>];
  remove: [];
  cancel: [];
}>();

const MEALS: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];

const editing = ref(false);
const confirmingDelete = ref(false);

const form = ref({
  food_name: props.entry.food_name,
  calories: props.entry.calories,
  protein_g: props.entry.protein_g,
  carbs_g: props.entry.carbs_g,
  fat_g: props.entry.fat_g,
  meal_type: props.entry.meal_type ?? ('snack' as MealType),
});

const derivedCalories = computed(() => {
  const { protein_g, carbs_g, fat_g } = form.value;
  if (protein_g === null && carbs_g === null && fat_g === null) return null;
  return Math.round((protein_g ?? 0) * 4 + (carbs_g ?? 0) * 4 + (fat_g ?? 0) * 9);
});

/** Same 4/4/9 check used elsewhere — catches a typo before it's saved. */
const mismatch = computed(() => {
  const derived = derivedCalories.value;
  if (derived === null || derived === 0) return false;
  return Math.abs(form.value.calories - derived) / derived > 0.3;
});

const valid = computed(
  () =>
    form.value.food_name.trim().length > 0 &&
    Number.isFinite(form.value.calories) &&
    form.value.calories >= 0
);

function save(): void {
  if (!valid.value) return;
  emit('save', {
    food_name: form.value.food_name.trim(),
    calories: Math.round(form.value.calories),
    protein_g: form.value.protein_g,
    carbs_g: form.value.carbs_g,
    fat_g: form.value.fat_g,
    meal_type: form.value.meal_type,
  });
}
</script>

<template>
  <div class="backdrop" @click.self="emit('cancel')">
    <div class="sheet" role="dialog" aria-label="Entry details">
      <div class="grabber"></div>

      <div class="spread" style="margin-bottom: 16px">
        <button class="link" @click="emit('cancel')">Close</button>
        <strong>{{ editing ? 'Edit entry' : 'Entry' }}</strong>
        <button v-if="!editing" class="link right" @click="editing = true">Edit</button>
        <span v-else style="width: 44px"></span>
      </div>

      <template v-if="!editing">
        <h3 class="name">{{ entry.food_name }}</h3>
        <p class="muted meta">
          {{ entry.meal_type }}
          <template v-if="entry.quantity && entry.unit">
            · {{ entry.quantity }}{{ entry.unit }}
          </template>
          · {{ entry.entry_date }}
        </p>

        <div class="macro-grid">
          <div class="macro-cell">
            <div class="macro-value">{{ entry.calories }}</div>
            <div class="muted macro-label">kcal</div>
          </div>
          <div class="macro-cell">
            <div class="macro-value">{{ entry.protein_g ?? '—' }}</div>
            <div class="muted macro-label">protein</div>
          </div>
          <div class="macro-cell">
            <div class="macro-value">{{ entry.carbs_g ?? '—' }}</div>
            <div class="muted macro-label">carbs</div>
          </div>
          <div class="macro-cell">
            <div class="macro-value">{{ entry.fat_g ?? '—' }}</div>
            <div class="muted macro-label">fat</div>
          </div>
        </div>

        <div v-if="!confirmingDelete" class="row" style="margin-top: 20px">
          <button class="btn btn-ghost" style="flex: 1" @click="editing = true">Edit</button>
          <button class="btn danger" style="flex: 1" @click="confirmingDelete = true">
            Delete
          </button>
        </div>

        <div v-else class="confirm-box">
          <p style="margin: 0 0 12px">Delete this entry? This can't be undone.</p>
          <div class="row">
            <button class="btn btn-ghost" style="flex: 1" @click="confirmingDelete = false">
              Keep
            </button>
            <button class="btn danger" style="flex: 1" @click="emit('remove')">
              Delete
            </button>
          </div>
        </div>
      </template>

      <template v-else>
        <div class="field">
          <label>Name</label>
          <input v-model="form.food_name" type="text" />
        </div>

        <div class="field">
          <label>Meal</label>
          <select v-model="form.meal_type">
            <option v-for="meal in MEALS" :key="meal" :value="meal">{{ meal }}</option>
          </select>
        </div>

        <div class="grid2">
          <div class="field">
            <label>Calories</label>
            <input v-model.number="form.calories" type="number" inputmode="decimal" min="0" />
          </div>
          <div class="field">
            <label>Protein (g)</label>
            <input v-model.number="form.protein_g" type="number" inputmode="decimal" min="0" />
          </div>
          <div class="field">
            <label>Carbs (g)</label>
            <input v-model.number="form.carbs_g" type="number" inputmode="decimal" min="0" />
          </div>
          <div class="field">
            <label>Fat (g)</label>
            <input v-model.number="form.fat_g" type="number" inputmode="decimal" min="0" />
          </div>
        </div>

        <p v-if="mismatch" class="warn-note">
          Those macros work out to about {{ derivedCalories }} kcal, not {{ form.calories }}.
        </p>

        <div class="row" style="margin-top: 16px">
          <button class="btn btn-ghost" style="flex: 1" @click="editing = false">Cancel</button>
          <button class="btn" style="flex: 2" :disabled="!valid" @click="save">Save</button>
        </div>
      </template>
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

.link.right {
  text-align: right;
}

.name {
  font-size: 18px;
  margin: 0 0 4px;
}

.meta {
  font-size: 13px;
  margin: 0 0 18px;
  text-transform: capitalize;
}

.macro-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

.macro-cell {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 12px 4px;
  text-align: center;
}

.macro-value {
  font-size: 19px;
  font-weight: 600;
}

.macro-label {
  font-size: 11px;
  margin-top: 2px;
}

.danger {
  background: transparent;
  border: 1px solid var(--danger);
  color: var(--danger);
}

.confirm-box {
  margin-top: 20px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 14px;
  font-size: 14px;
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

.warn-note {
  color: var(--warn);
  font-size: 13px;
  background: rgba(251, 191, 36, 0.1);
  border-radius: 10px;
  padding: 10px 12px;
  margin: 4px 0 0;
}

@keyframes slide {
  from {
    transform: translateY(100%);
  }
}
</style>
