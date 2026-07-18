<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { api, type MealType, type Suggestion } from '../api';

defineProps<{
  meal: MealType;
  suggestions: Suggestion[];
  loading: boolean;
}>();

const emit = defineEmits<{
  select: [suggestion: Suggestion];
  adjust: [suggestion: Suggestion];
  addNew: [query: string];
  close: [];
}>();

const query = ref('');
const results = ref<Suggestion[]>([]);
const searching = ref(false);
const searchError = ref<string | null>(null);

let searchTimer: ReturnType<typeof setTimeout> | undefined;

watch(query, (value) => {
  clearTimeout(searchTimer);
  searchError.value = null;

  if (value.trim().length < 2) {
    results.value = [];
    searching.value = false;
    return;
  }

  searching.value = true;
  // Debounced so typing doesn't fire a request per keystroke.
  searchTimer = setTimeout(async () => {
    try {
      const data = await api.searchFoods(value.trim());
      results.value = data.foods;
    } catch {
      searchError.value = 'Search failed — check your connection.';
      results.value = [];
    } finally {
      searching.value = false;
    }
  }, 250);
});

/** How long ago a food was last eaten, for the suggestion subtitle. */
function relativeDay(date: string): string {
  const days = Math.round(
    (Date.now() - new Date(`${date}T00:00:00`).getTime()) / 86_400_000
  );
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.round(days / 7)}w ago`;
  return `${Math.round(days / 30)}mo ago`;
}

/**
 * Canonical names come from logging history and often carry a quantity
 * ("Cooked White Rice (150g)"). The portion is shown separately and may differ
 * from the one in the name, so strip it rather than display a contradiction
 * like "Chicken Breast 165g raw" next to "200g".
 */
function displayName(food: Suggestion): string {
  if (food.reference_unit === 'serving') return food.canonical_name;

  return (
    food.canonical_name
      .replace(/\(\s*~?\s*\d+(\.\d+)?\s*[a-z]*\s*\)/gi, '')
      .replace(/\b~?\d+(\.\d+)?\s*(g|ml|kg|scoops?|pcs?|pieces?|slices?|cans?)\b/gi, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+([,)])/g, '$1')
      .replace(/[\s(,-]+$/, '')
      .trim() || food.canonical_name
  );
}

function macroLine(food: Suggestion): string {
  const quantity = food.default_quantity;
  const calories = Math.round(food.calories_per_unit * quantity);
  const protein = food.protein_g_per_unit
    ? `${Math.round(food.protein_g_per_unit * quantity)}g P`
    : null;
  const portion =
    food.reference_unit === 'serving' ? '' : `${quantity}${food.reference_unit} · `;
  return [`${portion}${calories} kcal`, protein].filter(Boolean).join(' · ');
}

const sheet = ref<HTMLElement | null>(null);
onMounted(() => sheet.value?.focus());
</script>

<template>
  <div class="backdrop" @click.self="emit('close')">
    <div ref="sheet" class="sheet" role="dialog" :aria-label="`Log ${meal}`" tabindex="-1">
      <div class="grabber"></div>

      <div class="spread" style="margin-bottom: 14px">
        <strong style="text-transform: capitalize">{{ meal }}</strong>
        <button class="close" aria-label="Close" @click="emit('close')">Done</button>
      </div>

      <input
        v-model="query"
        type="search"
        placeholder="Search your foods…"
        autocomplete="off"
        autocapitalize="none"
      />

      <div class="list">
        <template v-if="query.trim().length >= 2">
          <p v-if="searching" class="muted hint">Searching…</p>
          <p v-else-if="searchError" class="hint" style="color: var(--danger)">
            {{ searchError }}
          </p>
          <div v-else-if="results.length === 0" class="empty">
            <p class="muted hint" style="padding-bottom: 8px">
              "{{ query.trim() }}" isn't in your library yet.
            </p>
            <button class="btn wide" @click="emit('addNew', query.trim())">
              Add "{{ query.trim() }}"
            </button>
          </div>
          <div v-for="food in results" :key="food.id" class="item-row">
            <button class="item" @click="emit('select', food)">
              <span class="item-name">{{ displayName(food) }}</span>
              <span class="muted item-sub">{{ macroLine(food) }}</span>
            </button>
            <button
              class="portion"
              :aria-label="`Change portion for ${displayName(food)}`"
              @click="emit('adjust', food)"
            >
              {{ food.default_quantity }}{{ food.reference_unit === 'serving' ? '' : food.reference_unit }}
              <span class="pencil">edit</span>
            </button>
          </div>
        </template>

        <template v-else>
          <template v-if="loading">
            <div v-for="n in 5" :key="n" class="skeleton" style="height: 56px; margin-bottom: 8px"></div>
          </template>

          <p v-else-if="suggestions.length === 0" class="muted hint">
            Nothing logged for {{ meal }} yet — search above, or add a new food.
          </p>

          <div v-for="food in suggestions" :key="food.id" class="item-row">
            <button class="item" @click="emit('select', food)">
              <span class="item-name">{{ displayName(food) }}</span>
              <span class="muted item-sub">
                {{ macroLine(food) }} · {{ food.times_logged }}× · {{ relativeDay(food.last_logged) }}
              </span>
            </button>
            <button
              class="portion"
              :aria-label="`Change portion for ${displayName(food)}`"
              @click="emit('adjust', food)"
            >
              {{ food.default_quantity }}{{ food.reference_unit === 'serving' ? '' : food.reference_unit }}
              <span class="pencil">edit</span>
            </button>
          </div>
        </template>

        <button
          v-if="query.trim().length < 2"
          class="btn btn-ghost wide add-new"
          @click="emit('addNew', '')"
        >
          + Add a food that isn't listed
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  z-index: 50;
  display: flex;
  align-items: flex-end;
  animation: fade 0.15s ease;
}

.sheet {
  width: 100%;
  max-height: 88dvh;
  background: var(--surface);
  border-radius: 20px 20px 0 0;
  border-top: 1px solid var(--border);
  padding: 10px 16px calc(20px + env(safe-area-inset-bottom));
  outline: none;
  animation: slide 0.22s cubic-bezier(0.32, 0.72, 0, 1);
  display: flex;
  flex-direction: column;
}

.grabber {
  width: 38px;
  height: 4px;
  background: var(--border);
  border-radius: 999px;
  margin: 0 auto 14px;
}

.close {
  color: var(--accent);
  font-size: 15px;
  font-weight: 600;
  min-height: auto;
  padding: 4px;
}

.list {
  overflow-y: auto;
  margin-top: 14px;
  -webkit-overflow-scrolling: touch;
}

.item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  width: 100%;
  text-align: left;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 10px 14px;
  margin-bottom: 8px;
  transition: transform 0.1s ease;
}

.item:active {
  transform: scale(0.985);
  border-color: var(--accent-dim);
}

.item-row {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}

.item-row .item {
  flex: 1;
  margin-bottom: 0;
  min-width: 0;
}

/* Separate target so the common case (log the usual amount) stays one tap,
   while changing the portion is still reachable without a hidden gesture. */
.portion {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  min-width: 64px;
  padding: 6px 10px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 12px;
  font-size: 13px;
  color: var(--text);
}

.portion:active {
  border-color: var(--accent-dim);
}

.pencil {
  font-size: 10px;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.wide {
  width: 100%;
}

.add-new {
  margin-top: 4px;
}

.empty {
  padding-top: 8px;
}

.item-name {
  font-size: 15px;
}

.item-sub {
  font-size: 12.5px;
}

.hint {
  font-size: 14px;
  padding: 20px 4px;
  text-align: center;
}

@keyframes slide {
  from {
    transform: translateY(100%);
  }
}

@keyframes fade {
  from {
    opacity: 0;
  }
}
</style>
