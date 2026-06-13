'use strict';

/*
 * lib.js — shared core for the NexiGo webcam tools.
 * Wraps the vendored `uvc-util` binary and the profile store so both the
 * non-interactive CLI (nexicam.js) and the interactive menu (cli.js) share
 * one source of truth.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const UVC = path.join(__dirname, 'bin', 'uvc-util');
const PROFILES_FILE = path.join(__dirname, 'profiles.json');                  // personal, git-ignored
const DEFAULT_PROFILES_FILE = path.join(__dirname, 'default-profiles.json');  // shipped, committed

// The eight image controls we expose, in display order.
// `name`  — the uvc-util control name
// `auto`  — companion boolean control that must be OFF for manual values to apply
// `unit`  — display unit
// `step`  — increment used by the interactive up/down adjuster
const CONTROLS = [
  { key: 'brightness', label: 'Brightness',     name: 'brightness',              step: 1 },
  { key: 'contrast',   label: 'Contrast',       name: 'contrast',                step: 1 },
  { key: 'hue',        label: 'Hue',            name: 'hue',                     step: 1 },
  { key: 'saturation', label: 'Saturation',     name: 'saturation',              step: 1 },
  { key: 'sharpness',  label: 'Sharpness',      name: 'sharpness',               step: 1 },
  { key: 'gamma',      label: 'Gamma',          name: 'gamma',                   step: 1 },
  { key: 'backlight',  label: 'Backlight Comp', name: 'backlight-compensation',  step: 1 },
  { key: 'wb',         label: 'White Balance',  name: 'white-balance-temp',
    auto: 'auto-white-balance-temp', unit: 'K', step: 100 },
];

const byKey = Object.fromEntries(CONTROLS.map((c) => [c.key, c]));
const byName = Object.fromEntries(CONTROLS.map((c) => [c.name, c]));

function resolveControl(token) {
  return byKey[token] || byName[token] || null;
}

function uvc(args, { quiet = false } = {}) {
  try {
    return execFileSync(UVC, args, { encoding: 'utf8' }).trim();
  } catch (err) {
    if (!quiet) {
      const msg = (err.stderr || err.stdout || err.message || '').toString().trim();
      throw new Error(`uvc-util ${args.join(' ')} failed: ${msg}`);
    }
    return null;
  }
}

// Find the NexiGo camera's device index (honours $NEXICAM_INDEX, else matches by
// name/vendor, else falls back to the first UVC device).
function findCameraIndex() {
  if (process.env.NEXICAM_INDEX) return process.env.NEXICAM_INDEX;
  const out = uvc(['-d']);
  let firstIndex = null;
  for (const line of out.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(0x[0-9a-f]+):(0x[0-9a-f]+).*?\s{2,}(.+?)\s*$/i);
    if (!m) continue;
    const [, idx, vend, , devname] = m;
    if (firstIndex === null) firstIndex = idx;
    if (/nexigo/i.test(devname) || vend.toLowerCase() === '0x3443') return idx;
  }
  if (firstIndex === null) throw new Error('No UVC camera found. Is the webcam plugged in?');
  return firstIndex;
}

// Parse `-S <name>` output into {bool,min,max,def,cur}; null if control absent.
function describe(index, ctrl) {
  const out = uvc(['-I', String(index), '-S', ctrl.name], { quiet: true });
  if (out == null) return null;
  const isBool = /\bboolean\b/.test(out);
  const num = (label) => {
    const m = out.match(new RegExp(`${label}:\\s*(-?\\d+|true|false)`));
    if (!m) return null;
    if (m[1] === 'true') return 1;
    if (m[1] === 'false') return 0;
    return parseInt(m[1], 10);
  };
  return { bool: isBool, min: num('minimum'), max: num('maximum'), def: num('default-value'), cur: num('current-value') };
}

// centered (signed, 0 = default) <-> raw, clamped to [min,max]
const toRaw = (d, centered) => Math.max(d.min, Math.min(d.max, d.def + centered));
const toCentered = (d, raw) => raw - d.def;

// Is this control's auto companion currently on?
function isAutoOn(index, ctrl) {
  if (!ctrl.auto) return false;
  const ad = describe(index, { name: ctrl.auto });
  return !!(ad && ad.cur);
}

// Set one control to a centered value, disabling its auto companion if needed.
// Returns the resulting {raw, centered}.
function setCentered(index, ctrl, centered) {
  const d = describe(index, ctrl);
  if (!d) throw new Error(`${ctrl.label}: not supported by this camera`);
  if (ctrl.auto && isAutoOn(index, ctrl)) uvc(['-I', String(index), '-s', `${ctrl.auto}=0`]);
  const raw = toRaw(d, Math.round(centered));
  uvc(['-I', String(index), '-s', `${ctrl.name}=${raw}`]);
  return { raw, centered: toCentered(d, raw) };
}

function setAuto(index, ctrl, on) {
  if (!ctrl.auto) return;
  uvc(['-I', String(index), '-s', `${ctrl.auto}=${on ? 1 : 0}`]);
}

function resetAll(index) {
  for (const c of CONTROLS) {
    uvc(['-I', String(index), '-s', `${c.name}=default`], { quiet: true });
    if (c.auto) uvc(['-I', String(index), '-s', `${c.auto}=1`], { quiet: true });
  }
}

// ---- profiles --------------------------------------------------------------

function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return {}; }
}

// Built-in profiles shipped with the tool (committed to the repo).
function loadDefaultProfiles() { return readJSON(DEFAULT_PROFILES_FILE); }

// The user's own profiles (profiles.json, git-ignored). Saving/deleting touches
// only this file — built-in defaults are never modified.
function loadUserProfiles() { return readJSON(PROFILES_FILE); }
function saveProfiles(userProfiles) {
  fs.writeFileSync(PROFILES_FILE, JSON.stringify(userProfiles, null, 2) + '\n');
}

// What every consumer sees: defaults, with the user's own profiles taking
// precedence when names collide.
function loadProfiles() {
  return { ...loadDefaultProfiles(), ...loadUserProfiles() };
}

function isDefaultProfile(name) {
  return name in loadDefaultProfiles();
}

// Snapshot current camera state as a profile (centered values + wb-auto flag).
function captureProfile(index) {
  const p = {};
  for (const c of CONTROLS) {
    const d = describe(index, c);
    if (!d || d.bool) continue;
    p[c.key] = toCentered(d, d.cur);
    if (c.auto) p[`${c.key}Auto`] = isAutoOn(index, c);
  }
  return p;
}

// Apply a saved profile to the camera.
function applyProfile(index, p) {
  for (const c of CONTROLS) {
    const d = describe(index, c);
    if (!d || d.bool) continue;
    if (c.auto) {
      if (p[`${c.key}Auto`]) { setAuto(index, c, true); continue; }
      setAuto(index, c, false);
    }
    if (!(c.key in p)) continue;
    uvc(['-I', String(index), '-s', `${c.name}=${toRaw(d, Math.round(p[c.key]))}`]);
  }
}

const pad = (s, n) => { s = String(s); return s + ' '.repeat(Math.max(0, n - s.length)); };
const padl = (s, n) => { s = String(s); return ' '.repeat(Math.max(0, n - s.length)) + s; };

module.exports = {
  UVC, PROFILES_FILE, CONTROLS, byKey, byName,
  resolveControl, uvc, findCameraIndex, describe,
  toRaw, toCentered, isAutoOn, setCentered, setAuto, resetAll,
  loadProfiles, loadUserProfiles, loadDefaultProfiles, isDefaultProfile,
  saveProfiles, captureProfile, applyProfile,
  pad, padl,
};
