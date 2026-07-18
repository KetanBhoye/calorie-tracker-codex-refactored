<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { Suggestion } from '../api';

const props = defineProps<{ food: Suggestion }>();
const emit = defineEmits<{ confirm: [quantity: number]; cancel: [] }>();

const quantity = ref<number>(props.food.default_quantity);
const input = ref<HTMLInputElement | null>(null);

/** Sensible jumps per unit: 25g at a time, but whole scoops and pieces. */
const step = computed(() => {
  switch (props.food.reference_unit) {
    case 'g':
    case 'ml':
      return 25;
    case 'scoop':
    case 'piece':
    case 'slice':
    case 'can':
      return 1;
    default:
      return 1;
  }
});

const valid = computed(
  () => Number.isFinite(quantity.value) && quantity.value > 0 && quantity.value <= 10000
);

const macros = computed(() => {
  const q = valid.value ? quantity.value : 0;
  const scale = (value: number | null) =>
    value === null ? null : Math.round(value * q * 10) / 10;

  return {
    calories: Math.round(props.food.calories_per_unit * q),
    protein: scale(props.food.protein_g_per_unit),
    carbs: scale(props.food.carbs_g_per_unit),
    fat: scale(props.food.fat_g_per_unit),
  };
});

function nudge(direction: 1 | -1): void {
  const next = (quantity.value || 0) + direction * step.value;
  quantity.value = Math.max(step.value, Math.round(next * 100) / 100);
}

onMounted(() => {
  input.value?.focus();
  input.value?.select();
});
</script>

<template>
  <div class="backdrop" @click.self="emit('cancel')">
    <div class="sheet" role="dialog" aria-label="Adjust portion">
      <div class="grabber"></div>

      <div class="spread" style="margin-bottom: 16px">
        <button class="link" @click="emit('cancel')">Back</button>
        <strong class="title">{{ food.canonical_name }}</strong>
        <span style="width: 44px"></span>
      </div>

      <div class="stepper">
        <button class="step" aria-label="Less" @click="nudge(-1)">−</button>
        <div class="qty">
          <input
            ref="input"
            v-model.number="quantity"
            type="number"
            inputmode="decimal"
            min="0"
            :step="step"
            aria-label="Quantity"
          />
          <span class="unit">{{ food.reference_unit }}</span>
        </div>
        <button class="step" aria-label="More" @click="nudge(1)">+</button>
      </div>

      <div class="preview">
        <div class="kcal">{{ macros.calories }}<span class="kcal-unit">kcal</span></div>
        <div class="macro-row">
          <span>P {{ macros.protein ?? '—' }}g</span>
          <span>C {{ macros.carbs ?? '—' }}g</span>
          <span>F {{ macros.fat ?? '—' }}g</span>
        </div>
      </div>

      <p v-if="!valid" class="error">Enter a quantity between 0 and 10000.</p>

      <button class="btn confirm" :disabled="!valid" @click="emit('confirm', quantity)">
        Log {{ macros.calories }} kcal
      </button>
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

.title {
  font-size: 15px;
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 60vw;
}

.link {
  color: var(--accent);
  font-size: 15px;
  min-height: auto;
  padding: 4px;
  width: 44px;
  text-align: left;
}

.stepper {
  display: flex;
  align-items: center;
  gap: 12px;
}

.step {
  width: 56px;
  height: 56px;
  flex-shrink: 0;
  font-size: 26px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 14px;
}

.step:active {
  border-color: var(--accent-dim);
}

.qty {
  flex: 1;
  position: relative;
}

.qty input {
  text-align: center;
  font-size: 22px;
  font-weight: 600;
  padding-right: 46px;
  height: 56px;
}

/* Native number spinners are unusable at thumb size; the ± buttons replace them. */
.qty input::-webkit-outer-spin-button,
.qty input::-webkit-inner-spin-button {
  appearance: none;
  margin: 0;
}

.unit {
  position: absolute;
  right: 14px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-dim);
  font-size: 14px;
  pointer-events: none;
}

.preview {
  text-align: center;
  margin: 20px 0 4px;
}

.kcal {
  font-size: 34px;
  font-weight: 700;
}

.kcal-unit {
  font-size: 14px;
  color: var(--text-dim);
  margin-left: 6px;
  font-weight: 500;
}

.macro-row {
  display: flex;
  justify-content: center;
  gap: 18px;
  color: var(--text-dim);
  font-size: 14px;
  margin-top: 4px;
}

.error {
  color: var(--danger);
  font-size: 13px;
  text-align: center;
  margin: 8px 0 0;
}

.confirm {
  width: 100%;
  margin-top: 18px;
}

@keyframes slide {
  from {
    transform: translateY(100%);
  }
}
</style>
