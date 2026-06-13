#!/usr/bin/env node
'use strict';

/*
 * cli.js — interactive menu for controlling the NexiGo N680E webcam.
 * Run with `npm start`.
 *
 *   1. Set existing profile   2. Create new profile   3. Delete a profile
 *   4. Reset to default       5/Q. Quit
 *
 * In "Create new profile", pick a setting then use ↑/↓ to adjust it — the live
 * camera updates as you go so you can see the result. Saving snapshots the look
 * and returns the camera to default.
 */

const readline = require('readline');
const L = require('./lib');
const {
  CONTROLS, describe, toCentered, isAutoOn, setCentered, resetAll,
  findCameraIndex, loadProfiles, saveProfiles, captureProfile, applyProfile, pad,
} = L;

// ---- terminal / key plumbing ----------------------------------------------

const W = (s) => process.stdout.write(s);
const clear = () => W('\x1b[2J\x1b[H');
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;

let keyResolver = null;
const keyQueue = [];
function onKey(str, key) {
  if (key && key.ctrl && key.name === 'c') { cleanupAndExit(0); }
  if (keyResolver) { const r = keyResolver; keyResolver = null; r({ str, key }); }
  else keyQueue.push({ str, key }); // buffer keys pressed between awaits
}
function nextKey() {
  if (keyQueue.length) return Promise.resolve(keyQueue.shift());
  return new Promise((res) => { keyResolver = res; });
}

function setupInput() {
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('keypress', onKey);
}
function cleanupAndExit(code) {
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdin.removeListener('keypress', onKey);
  process.stdin.pause();
  W('\n');
  process.exit(code);
}

// Read a line of text in raw mode (supports backspace / enter / esc-to-cancel).
async function promptText(question) {
  W(question);
  let buf = '';
  for (;;) {
    const { str, key } = await nextKey();
    if (key && key.name === 'return') { W('\n'); return buf.trim(); }
    if (key && key.name === 'escape') { W('\n'); return null; }
    if (key && key.name === 'backspace') {
      if (buf.length) { buf = buf.slice(0, -1); W('\b \b'); }
      continue;
    }
    if (str && str >= ' ' && str.charCodeAt(0) !== 127) { buf += str; W(str); }
  }
}

// ---- shared rendering ------------------------------------------------------

function controlSnapshot(index, c) {
  const d = describe(index, c);
  if (!d) return { label: c.label, text: '(n/a)' };
  if (c.auto && isAutoOn(index, c)) return { label: c.label, text: 'auto', d };
  const cur = toCentered(d, d.cur);
  return { label: c.label, text: `${cur > 0 ? '+' : ''}${cur}`, d, centered: cur };
}

function bar(centered, lo, hi) {
  const width = 21;
  const span = hi - lo;
  const pos = Math.round(((centered - lo) / span) * (width - 1));
  let s = '';
  for (let i = 0; i < width; i++) s += i === pos ? '●' : '─';
  return s;
}

// ---- screen: main menu -----------------------------------------------------

function renderMenu() {
  clear();
  W(bold('  NexiGo N680E — Webcam Control\n'));
  W(dim('  ────────────────────────────\n\n'));
  W('  ' + cyan('1') + '  Set existing profile\n');
  W('  ' + cyan('2') + '  Create new profile\n');
  W('  ' + cyan('3') + '  Delete a profile\n');
  W('  ' + cyan('4') + '  Reset to default\n');
  W('  ' + cyan('5') + '  Quit  ' + dim('(or Q)') + '\n\n');
  W(dim('  Choose an option: '));
}

async function pause(msg) {
  if (msg) W('\n' + msg + '\n');
  W(dim('\n  (press any key to continue)'));
  await nextKey();
}

// ---- screen: set existing profile -----------------------------------------

async function chooseProfile(index, title) {
  const profiles = loadProfiles();
  const names = Object.keys(profiles);
  clear();
  W(bold(`  ${title}\n`));
  W(dim('  ────────────────────────────\n\n'));
  if (!names.length) {
    await pause('  No profiles saved yet. Use "Create new profile" first.');
    return null;
  }
  names.forEach((n, i) => W(`  ${cyan(String(i + 1))}  ${n}\n`));
  W(dim('\n  Pick a number (or Q to go back): '));
  for (;;) {
    const { str, key } = await nextKey();
    if (key && (key.name === 'escape')) return null;
    if (str && /[qQ]/.test(str)) return null;
    const n = parseInt(str, 10);
    if (n >= 1 && n <= names.length) return { name: names[n - 1], profile: profiles[names[n - 1]] };
  }
}

async function setExistingProfile(index) {
  const choice = await chooseProfile(index, 'Set existing profile');
  if (!choice) return;
  applyProfile(index, choice.profile);
  clear();
  W(bold('  Set existing profile\n\n'));
  W(green(`  Applied "${choice.name}" to the camera.\n`));
  await pause();
}

// ---- screen: delete profile ------------------------------------------------

async function deleteProfile(index) {
  const choice = await chooseProfile(index, 'Delete a profile');
  if (!choice) return;
  const profiles = loadProfiles();
  delete profiles[choice.name];
  saveProfiles(profiles);
  clear();
  W(bold('  Delete a profile\n\n'));
  W(green(`  Deleted "${choice.name}".\n`));
  await pause();
}

// ---- screen: reset ---------------------------------------------------------

async function resetDefault(index) {
  resetAll(index);
  clear();
  W(bold('  Reset to default\n\n'));
  W(green('  Camera reset to default (auto-white-balance back on).\n'));
  await pause();
}

// ---- screen: create profile ------------------------------------------------

// Adjust one control live with ↑/↓; Enter/Esc returns to the setting list.
async function adjustControl(index, c) {
  let snap = controlSnapshot(index, c);
  let d = snap.d || describe(index, c);
  let centered = snap.centered != null ? snap.centered : toCentered(d, d.cur);

  const render = () => {
    clear();
    W(bold(`  Adjust ${c.label}\n`));
    W(dim('  ────────────────────────────\n\n'));
    const lo = d.min - d.def, hi = d.max - d.def;
    const unit = c.unit ? ` ${c.unit}` : '';
    const raw = L.toRaw(d, centered);
    W('  ' + bar(centered, lo, hi) + '\n\n');
    W('  value: ' + bold(`${centered > 0 ? '+' : ''}${centered}`) + dim(`  (raw ${raw}${unit})`) + '\n');
    W(dim(`  range ${lo > 0 ? '+' : ''}${lo} .. +${hi}   step ${c.step}\n\n`));
    W(dim('  ↑ increase   ↓ decrease   Enter/Esc done\n'));
  };
  render();

  for (;;) {
    const { key } = await nextKey();
    if (!key) continue;
    if (key.name === 'return' || key.name === 'escape' || key.name === 'left') return;
    if (key.name === 'up' || key.name === 'right' || key.name === 'down') {
      const delta = (key.name === 'down') ? -c.step : c.step;
      const r = setCentered(index, c, centered + delta); // live-applies to camera (auto-WB off if needed)
      centered = r.centered;
      d = describe(index, c); // refresh in case clamping changed bounds reading
      render();
    }
  }
}

async function createProfile(index) {
  clear();
  W(bold('  Create new profile\n'));
  W(dim('  ────────────────────────────\n\n'));
  const name = await promptText('  Profile name: ');
  if (!name) { return; } // cancelled
  const existing = loadProfiles();
  if (name in existing) {
    W(dim(`\n  "${name}" already exists — saving will overwrite it.\n`));
  }

  // setting-selection loop
  for (;;) {
    clear();
    W(bold(`  Create "${name}" — pick a setting to adjust\n`));
    W(dim('  ────────────────────────────\n\n'));
    CONTROLS.forEach((c, i) => {
      const snap = controlSnapshot(index, c);
      W(`  ${cyan(String(i + 1))}  ${pad(c.label, 16)} ${dim(snap.text)}\n`);
    });
    W('\n  ' + green('S') + '  Save profile     ' + cyan('Q') + '  Cancel\n');
    W(dim('\n  Choose: '));

    const { str, key } = await nextKey();
    if (key && key.name === 'escape') { return cancelCreate(index); }
    if (str && /[qQ]/.test(str)) { return cancelCreate(index); }
    if (str && /[sS]/.test(str)) {
      const profiles = loadProfiles();
      profiles[name] = captureProfile(index);
      saveProfiles(profiles);
      resetAll(index);
      clear();
      W(bold('  Create new profile\n\n'));
      W(green(`  Saved "${name}".\n`));
      W('  To use this profile choose existing profile option in CLI.\n');
      W(dim('  (camera returned to default)\n'));
      await pause();
      return;
    }
    const n = parseInt(str, 10);
    if (n >= 1 && n <= CONTROLS.length) {
      await adjustControl(index, CONTROLS[n - 1]);
    }
  }
}

async function cancelCreate(index) {
  resetAll(index);
  clear();
  W(bold('  Create new profile\n\n'));
  W(dim('  Cancelled. Camera returned to default.\n'));
  await pause();
}

// ---- main loop -------------------------------------------------------------

async function main() {
  let index;
  try { index = findCameraIndex(); }
  catch (e) {
    console.error('\n  ' + e.message + '\n');
    process.exit(1);
  }

  setupInput();
  for (;;) {
    renderMenu();
    const { str, key } = await nextKey();
    if (key && key.name === 'escape') { cleanupAndExit(0); }
    if (str && /[qQ]/.test(str)) { cleanupAndExit(0); }
    switch (str) {
      case '1': await setExistingProfile(index); break;
      case '2': await createProfile(index); break;
      case '3': await deleteProfile(index); break;
      case '4': await resetDefault(index); break;
      case '5': cleanupAndExit(0); break;
      default: break; // ignore unknown keys
    }
  }
}

main().catch((e) => { W('\n' + (e.message || e) + '\n'); cleanupAndExit(1); });
