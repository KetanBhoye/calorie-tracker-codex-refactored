<script setup lang="ts">
import { ref } from 'vue';

/**
 * API token management.
 *
 * Rebuilt from the old server-rendered dashboard, which had a "Generate API
 * Token" button that was lost when that page was replaced by this app. Without
 * it the only way to get a token is extracting a session cookie from devtools,
 * which is not a reasonable thing to ask of anyone on a phone.
 */

const token = ref<string | null>(null);
const confirming = ref(false);
const working = ref(false);
const error = ref<string | null>(null);
const copied = ref(false);

async function rotate(): Promise<void> {
  working.value = true;
  error.value = null;
  try {
    const response = await fetch('/api/tokens/rotate', {
      method: 'POST',
      credentials: 'same-origin',
    });
    if (response.status === 401) {
      window.location.href = '/login';
      return;
    }
    if (!response.ok) throw new Error('failed');
    const data = (await response.json()) as { token?: string; error?: string };
    if (!data.token) throw new Error(data.error ?? 'failed');
    token.value = data.token;
    confirming.value = false;
  } catch {
    error.value = "Couldn't generate a token. Check your connection.";
  } finally {
    working.value = false;
  }
}

async function copy(): Promise<void> {
  if (!token.value) return;
  try {
    await navigator.clipboard.writeText(token.value);
    copied.value = true;
    setTimeout(() => (copied.value = false), 2000);
  } catch {
    // Clipboard access is blocked in some contexts; the token stays selectable
    // so it can still be copied by hand.
    error.value = 'Copy blocked — select the token and copy it manually.';
  }
}
</script>

<template>
  <div class="card">
    <h3 class="title">API token</h3>
    <p class="muted desc">
      Used by the Apple Health Shortcut and the Claude connector. Send it as
      <code>Authorization: Bearer &lt;token&gt;</code>.
    </p>

    <div v-if="token" class="tokenbox">
      <code class="token mono">{{ token }}</code>
      <button class="btn copy" @click="copy">{{ copied ? 'Copied' : 'Copy' }}</button>
      <p class="warn-note">
        Shown once. Save it now — reopening this page won't show it again, and generating
        another replaces it.
      </p>
    </div>

    <template v-else-if="confirming">
      <p class="warn-note">
        A new token <strong>immediately invalidates the current one</strong>. Anything already
        using it — the Health Shortcut, the Claude connector — stops working until you paste the
        new one in.
      </p>
      <div class="row" style="margin-top: 12px">
        <button class="btn btn-ghost" style="flex: 1" @click="confirming = false">Cancel</button>
        <button class="btn" style="flex: 1" :disabled="working" @click="rotate">
          {{ working ? 'Generating…' : 'Generate' }}
        </button>
      </div>
    </template>

    <button v-else class="btn btn-ghost wide" @click="confirming = true">
      Generate API token
    </button>

    <p v-if="error" class="err">{{ error }}</p>
  </div>
</template>

<style scoped>
.title {
  font-size: 15px;
  margin: 0 0 6px;
}

.desc {
  font-size: 13px;
  margin: 0 0 14px;
}

code {
  font-family: var(--mono);
  font-size: 12px;
}

.tokenbox {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 12px;
}

.token {
  display: block;
  word-break: break-all;
  font-size: 12.5px;
  line-height: 1.5;
  /* Selectable as a unit so it can be copied by hand if the clipboard is blocked. */
  user-select: all;
  -webkit-user-select: all;
}

.copy {
  width: 100%;
  margin-top: 10px;
}

.warn-note {
  color: var(--warn);
  font-size: 12.5px;
  background: rgba(251, 191, 36, 0.1);
  border-radius: 10px;
  padding: 10px 12px;
  margin: 12px 0 0;
  line-height: 1.45;
}

.wide {
  width: 100%;
}

.err {
  color: var(--danger);
  font-size: 13px;
  margin: 10px 0 0;
}
</style>
