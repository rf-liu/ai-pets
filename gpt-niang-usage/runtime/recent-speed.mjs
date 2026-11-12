export const RECENT_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

// Keep numeric measurements only, independently of the latest card's fields.
// Bound long-running sessions and explicitly report incomplete history.
export class RecentSpeedSamples {
  constructor({limit = 4096, partial = false} = {}) {
    this.samples = new Map();
    this.limit = limit;
    this.partial = partial;
  }
  add(id, sample) {
    const {outputTokens, intervalSeconds, sampleAt} = sample ?? {};
    if (!Number.isSafeInteger(outputTokens) || outputTokens < 0 ||
        !Number.isFinite(intervalSeconds) || intervalSeconds <= 0 ||
        !Number.isFinite(sampleAt)) return;
    const modelName = String(sample.modelName ?? '').trim().slice(0, 120) || '未識別模型';
    this.samples.set(String(id), {outputTokens, intervalSeconds, sampleAt, modelName});
    while (this.samples.size > this.limit) {
      this.samples.delete(this.samples.keys().next().value);
      this.partial = true;
    }
  }
  snapshot(now = Date.now()) {
    const groups = new Map(), cutoff = now - RECENT_WINDOW_MS;
    for (const [id, sample] of this.samples) {
      if (sample.sampleAt < cutoff) { this.samples.delete(id); continue; }
      if (sample.sampleAt > now) continue;
      const group = groups.get(sample.modelName) ?? {
        modelName: sample.modelName, outputTokens: 0, intervalSeconds: 0, sampleCount: 0
      };
      group.outputTokens += sample.outputTokens;
      group.intervalSeconds += sample.intervalSeconds;
      group.sampleCount += 1;
      if (!Number.isSafeInteger(group.outputTokens) || !Number.isFinite(group.intervalSeconds)) { group.invalid = true; this.partial = true; }
      groups.set(sample.modelName, group);
    }
    return {recentSamples: [...groups.values()].filter(group => !group.invalid), recentPartial: this.partial};
  }
}
