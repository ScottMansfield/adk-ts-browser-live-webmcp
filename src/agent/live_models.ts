/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Live model IDs change often and a wrong ID fails as an opaque WebSocket
 * close, so the demo asks the API which models actually support the Live
 * (bidiGenerateContent) method instead of shipping a hardcoded guess.
 */
export interface LiveModelInfo {
  id: string;
  displayName: string;
}

const LIST_MODELS_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

/** The generation method a model must support to be usable over the Live API. */
const LIVE_METHOD = 'bidiGenerateContent';

/**
 * Fetches every model the key can see that supports bidirectional streaming.
 *
 * @throws If the request fails or the key is rejected.
 */
export async function fetchLiveModels(apiKey: string): Promise<LiveModelInfo[]> {
  const res = await fetch(`${LIST_MODELS_URL}?pageSize=1000&key=${encodeURIComponent(apiKey)}`);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ListModels failed (HTTP ${res.status}): ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  const models: any[] = data.models ?? [];

  return models
    .filter((m) => (m.supportedGenerationMethods ?? []).includes(LIVE_METHOD))
    .map((m) => ({
      // The API returns "models/<id>"; the SDK wants the bare id.
      id: String(m.name ?? '').replace(/^models\//, ''),
      displayName: m.displayName || String(m.name ?? '').replace(/^models\//, ''),
    }))
    .filter((m) => m.id.length > 0)
    .sort((a, b) => b.id.localeCompare(a.id));
}
