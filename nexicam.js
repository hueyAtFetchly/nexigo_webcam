#!/usr/bin/env node
'use strict';

/*
 * nexicam — non-interactive UVC control for the NexiGo N680E webcam.
 * Core logic lives in lib.js; this file is the argument parser / printer.
 *
 * Scale model: every control is on a CENTERED scale where 0 = hardware default
 * ("balanced"), +N moves toward max, -N toward min. Pass --abs for raw values.
 */

const L = require('./lib');
const { CONTROLS, resolveControl, uvc, findCameraIndex, describe,
        toRaw, toCentered, isAutoOn, setAuto, resetAll,
        loadProfiles, saveProfiles, captureProfile, applyProfile, pad } = L;

function cmdList(index) {
  console.log(`Camera index ${index}\n`);
  console.log(pad('Control', 16) + pad('Centered', 14) + pad('Raw', 8) + pad('Range (centered)', 20) + 'Raw range');
  console.log('-'.repeat(74));
  for (const c of CONTROLS) {
    const d = describe(index, c);
    if (!d) { console.log(pad(c.label, 16) + '(not supported)'); continue; }
    if (d.bool) { console.log(pad(c.label, 16) + pad(d.cur ? 'on' : 'off', 14) + pad('', 8) + 'on / off'); continue; }
    const cur = toCentered(d, d.cur);
    const lo = d.min - d.def, hi = d.max - d.def;
    const unit = c.unit ? ` ${c.unit}` : '';
    const autoOn = isAutoOn(index, c);
    console.log(
      pad(c.label, 16) +
      pad(autoOn ? 'auto' : (cur > 0 ? '+' : '') + cur, 14) +
      pad(autoOn ? '' : d.cur + unit, 8) +
      pad(`${lo > 0 ? '+' : ''}${lo} .. +${hi}`, 20) +
      `${d.min} .. ${d.max}${unit}`
    );
    if (c.auto) console.log(pad('  └ auto', 16) + (autoOn ? 'on  (set a value to switch to manual)' : 'off (manual value active)'));
  }
  console.log('\nSet with:  nexicam set brightness=+8 contrast=-5   (centered, 0 = balanced)');
  console.log('Or raw:    nexicam set wb=4200 --abs                (raw hardware value)');
}

function cmdGet(index, tokens) {
  const targets = tokens.length ? tokens : CONTROLS.map((c) => c.key);
  for (const t of targets) {
    const c = resolveControl(t);
    if (!c) { console.error(`unknown control: ${t}`); continue; }
    const d = describe(index, c);
    if (!d) { console.log(`${c.label}: (not supported)`); continue; }
    if (d.bool) { console.log(`${c.label}: ${d.cur ? 'on' : 'off'}`); continue; }
    if (isAutoOn(index, c)) { console.log(`${c.label}: auto`); continue; }
    const cur = toCentered(d, d.cur);
    console.log(`${c.label}: ${(cur > 0 ? '+' : '') + cur} (raw ${d.cur}${c.unit ? ' ' + c.unit : ''})`);
  }
}

function cmdSet(index, args) {
  const abs = args.includes('--abs');
  const pairs = args.filter((a) => a !== '--abs');
  if (!pairs.length) { console.error('nothing to set. e.g. nexicam set brightness=+8'); process.exitCode = 1; return; }

  for (const pair of pairs) {
    const m = pair.match(/^([^=]+)=(.+)$/);
    if (!m) { console.error(`bad argument: "${pair}" (expected name=value)`); process.exitCode = 1; continue; }
    const [, key, rawVal] = m;
    const c = resolveControl(key.trim());
    if (!c) { console.error(`unknown control: ${key}`); process.exitCode = 1; continue; }

    const d = describe(index, c);
    if (!d) { console.error(`${c.label}: not supported by this camera`); process.exitCode = 1; continue; }

    if (d.bool) {
      const v = /^(on|true|1|yes)$/i.test(rawVal.trim()) ? 1 : 0;
      uvc(['-I', String(index), '-s', `${c.name}=${v}`]);
      console.log(`${c.label} -> ${v ? 'on' : 'off'}`);
      continue;
    }

    const n = Number(rawVal);
    if (!Number.isFinite(n)) { console.error(`${c.label}: "${rawVal}" is not a number`); process.exitCode = 1; continue; }
    const raw = abs ? Math.max(d.min, Math.min(d.max, Math.round(n))) : toRaw(d, Math.round(n));

    if (c.auto && isAutoOn(index, c)) {
      setAuto(index, c, false);
      console.log(`(turned ${c.label} auto off so the manual value applies)`);
    }
    uvc(['-I', String(index), '-s', `${c.name}=${raw}`]);
    const centered = toCentered(d, raw);
    console.log(`${c.label} -> ${(centered > 0 ? '+' : '') + centered} (raw ${raw}${c.unit ? ' ' + c.unit : ''})`);
  }
}

function cmdReset(index, tokens) {
  if (tokens.length) {
    for (const t of tokens) {
      const c = resolveControl(t);
      if (!c) { console.error(`unknown control: ${t}`); continue; }
      uvc(['-I', String(index), '-s', `${c.name}=default`]);
      console.log(`${c.label} -> default`);
    }
  } else {
    resetAll(index);
    console.log('All controls reset to default (and auto-white-balance back on).');
  }
}

function cmdSave(index, tokens) {
  const name = tokens[0];
  if (!name) { console.error('usage: nexicam save <name>'); process.exitCode = 1; return; }
  const profiles = loadProfiles();
  profiles[name] = captureProfile(index);
  saveProfiles(profiles);
  console.log(`Saved current settings as "${name}".`);
  cmdGet(index, []);
}

function cmdLoad(index, tokens) {
  const name = tokens[0];
  if (!name) { console.error('usage: nexicam load <name>'); process.exitCode = 1; return; }
  const profiles = loadProfiles();
  if (!(name in profiles)) {
    console.error(`no profile named "${name}". Saved: ${Object.keys(profiles).join(', ') || '(none)'}`);
    process.exitCode = 1; return;
  }
  applyProfile(index, profiles[name]);
  console.log(`Loaded profile "${name}".`);
  cmdGet(index, []);
}

function cmdProfiles() {
  const profiles = loadProfiles();
  const names = Object.keys(profiles);
  if (!names.length) { console.log('No saved profiles yet. Create one with: nexicam save <name>'); return; }
  console.log('Saved profiles:\n');
  for (const name of names) {
    const p = profiles[name];
    const parts = CONTROLS.filter((c) => c.key in p).map((c) => {
      if (c.auto && p[`${c.key}Auto`]) return `${c.key}=auto`;
      const v = p[c.key];
      return `${c.key}=${v > 0 ? '+' : ''}${v}`;
    });
    console.log(`  ${pad(name, 14)} ${parts.join('  ')}`);
  }
}

function cmdDelete(tokens) {
  const name = tokens[0];
  if (!name) { console.error('usage: nexicam delete <name>'); process.exitCode = 1; return; }
  const profiles = loadProfiles();
  if (!(name in profiles)) { console.error(`no profile named "${name}".`); process.exitCode = 1; return; }
  delete profiles[name];
  saveProfiles(profiles);
  console.log(`Deleted profile "${name}".`);
}

function usage() {
  console.log(`nexicam — direct UVC control for the NexiGo N680E webcam

Usage:
  nexicam list                       Show every control: centered value, raw value, ranges
  nexicam get [control ...]          Read current value(s) (default: all)
  nexicam set <name=value> [...]     Set one or more controls (centered: 0 = balanced)
                                       add --abs to pass raw hardware values
  nexicam reset [control ...]        Reset to default(s); no args = reset everything

  nexicam save <name>                Save current settings as a named profile
  nexicam load <name>                Apply a saved profile
  nexicam profiles                   List saved profiles
  nexicam delete <name>              Delete a saved profile

  nexicam devices                    List UVC cameras

Tip: run \`npm start\` for an interactive menu.

Controls: ${CONTROLS.map((c) => c.key).join(', ')}

Examples:
  nexicam set brightness=+8 contrast=-4 saturation=+10
  nexicam set wb=4200 --abs          # white balance in Kelvin (auto-WB disabled automatically)
  nexicam reset
  nexicam save warm
  nexicam load warm

Env:
  NEXICAM_INDEX=<n>   force a specific camera index (see 'nexicam devices')
`);
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === 'help' || cmd === '-h' || cmd === '--help') { usage(); return; }
  if (cmd === 'devices') { console.log(uvc(['-d'])); return; }
  if (cmd === 'profiles') { cmdProfiles(); return; }
  if (cmd === 'delete') { cmdDelete(rest); return; }

  let index;
  try { index = findCameraIndex(); }
  catch (e) { console.error(e.message); process.exitCode = 1; return; }

  switch (cmd) {
    case 'list':  cmdList(index); break;
    case 'get':   cmdGet(index, rest); break;
    case 'set':   cmdSet(index, rest); break;
    case 'reset': cmdReset(index, rest); break;
    case 'save':  cmdSave(index, rest); break;
    case 'load':  cmdLoad(index, rest); break;
    default:
      console.error(`unknown command: ${cmd}\n`);
      usage();
      process.exitCode = 1;
  }
}

try { main(); }
catch (e) { console.error(e.message || e); process.exitCode = 1; }
