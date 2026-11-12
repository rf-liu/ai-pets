import fs from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const execute = promisify(execFile);
const desktopNames = {gpt: 'ChatGPT', gemini: 'Antigravity', claude: 'Claude', deepseek: 'DeepSeek Harness'};
export function matchesHost(profile, command, {desktop = true} = {}) {
  // ps's comm column contains the executable, never the shell's arguments.
  const name = path.basename(command);
  if (desktop && name === desktopNames[profile]) return true;
  if (profile === 'gpt') return name === 'codex';
  if (profile === 'claude') return name === 'claude' || /\/share\/claude\/versions\/[^/]+$/.test(command);
  if (profile === 'deepseek') return name === 'dsh' || /\/\.dsh\/dsh-runtimes\//.test(command);
  return false;
}
export function parentIsAlive(pid = Number(process.env.AI_PETS_PARENT_PID)) {
  if (!Number.isInteger(pid) || pid <= 0) return true;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}
export function createHostCheck(profile, {
  stateFile = process.env.AI_PETS_HOST_STATE_FILE,
  parentPid = Number(process.env.AI_PETS_PARENT_PID),
  readProcesses = () => execute('/bin/ps', ['-axo', 'uid=,pid=,comm='], {timeout: 1500, maxBuffer: 4 * 1024 * 1024}),
  now = Date.now, uid = process.getuid?.(), ttl = 5000
} = {}) {
  let checkedAt = -Infinity, previous = false;
  return async () => {
    let desktopKnown = false;
    if (stateFile) {
      try {
        const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        const age = now() - state.at * 1000;
        if (state.pid === parentPid && age >= 0 && age < 10000 && Array.isArray(state.hostsRunning)) {
          desktopKnown = true;
          if (state.hostsRunning.includes(profile)) return true;
        }
      } catch {}
    }
    if (now() - checkedAt < ttl) return previous;
    checkedAt = now();
    try {
      const {stdout} = await readProcesses();
      previous = stdout.split('\n').some(line => {
        const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
        return match && Number(match[1]) === uid && Number(match[2]) !== process.pid &&
          matchesHost(profile, match[3], {desktop: !desktopKnown});
      });
    } catch { previous = false; }
    return previous;
  };
}

export class AdaptivePoller {
  constructor({checkActive, work, onPause = () => {}, onError = () => {},
    activeMs = 2000, inactiveMs = 5000, ownerAlive = parentIsAlive,
    onOrphan = () => {}, schedule = setTimeout, cancel = clearTimeout}) {
    Object.assign(this, {checkActive, work, onPause, onError, activeMs, inactiveMs, ownerAlive, onOrphan, schedule, cancel});
    this.stopped = true; this.timer = null; this.wasActive = false;
  }
  async tick() {
    if (this.stopped) return;
    if (!this.ownerAlive()) { this.stop(); this.onOrphan(); return; }
    let active = false, failed = false;
    try {
      active = await this.checkActive();
      if (this.stopped) return;
      if (active) await this.work();
      else if (this.wasActive) await this.onPause();
    } catch (error) { failed = true; this.onError(error); }
    this.wasActive = active;
    if (!this.stopped) this.timer = this.schedule(() => void this.tick(), active && !failed ? this.activeMs : this.inactiveMs);
  }
  start() {
    if (!this.stopped) return;
    this.stopped = false;
    return this.tick();
  }
  stop() { this.stopped = true; if (this.timer !== null) this.cancel(this.timer); this.timer = null; }
}
export function bindMonitorLifetime(poller) {
  const stop = () => { poller.stop(); process.exit(0); };
  process.stdin.resume(); process.stdin.once('end', stop);
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
}
