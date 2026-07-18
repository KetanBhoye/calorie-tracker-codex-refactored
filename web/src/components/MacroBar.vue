<script setup lang="ts">
import { computed } from 'vue';
import type { Totals } from '../api';

const props = defineProps<{
  totals: Totals;
  goals: { calories: number; protein_g: number; carbs_g: number; fat_g: number };
}>();

const macros = computed(() => [
  { label: 'Protein', value: props.totals.protein_g, goal: props.goals.protein_g },
  { label: 'Carbs', value: props.totals.carbs_g, goal: props.goals.carbs_g },
  { label: 'Fat', value: props.totals.fat_g, goal: props.goals.fat_g },
]);

const caloriePct = computed(() =>
  Math.min(100, (props.totals.calories / props.goals.calories) * 100)
);
const over = computed(() => props.totals.calories > props.goals.calories);
</script>

<template>
  <div class="card" style="margin-top: 16px">
    <div class="spread" style="margin-bottom: 8px">
      <span class="muted" style="font-size: 13px">Calories</span>
      <span style="font-size: 13px">
        {{ Math.round(totals.calories) }} / {{ goals.calories }}
      </span>
    </div>
    <div class="track">
      <div class="fill" :class="{ over }" :style="{ width: `${caloriePct}%` }"></div>
    </div>

    <div class="macros">
      <div v-for="macro in macros" :key="macro.label" class="macro">
        <div class="spread" style="margin-bottom: 6px">
          <span class="muted" style="font-size: 12px">{{ macro.label }}</span>
          <span style="font-size: 12px">{{ Math.round(macro.value) }}g</span>
        </div>
        <div class="track thin">
          <div
            class="fill"
            :style="{ width: `${Math.min(100, (macro.value / macro.goal) * 100)}%` }"
          ></div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.track {
  height: 8px;
  background: var(--surface-2);
  border-radius: 999px;
  overflow: hidden;
}

.track.thin {
  height: 5px;
}

.fill {
  height: 100%;
  background: var(--accent);
  border-radius: 999px;
  transition: width 0.3s ease;
}

.fill.over {
  background: var(--warn);
}

.macros {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-top: 16px;
}
</style>
