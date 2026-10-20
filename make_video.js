#!/usr/bin/env node
/*
 * make_video.js — render the cinematic carousel walkthrough to an MP4.
 *
 * Primary path: puppeteer drives one headless Chrome, opens cinematic.html,
 * waits for window.READY, then for each frame i in 0..round(fps*TOTAL_DURATION)
 * calls window.seek(i/fps), lets layout settle, and screenshots the #stage
 * element (clipped to its 1080x1350 box) into .video_frames/frame-%05d.png.
 *
 * Fallback path (puppeteer unavailable / won't launch): spawn Google Chrome
 * --headless --screenshot once per frame against cinematic.html?t=<seconds>.
 *
 * Then encode with ffmpeg (libx264, yuv420p, crf 18, preset slow) at 30fps.
 * On success .video_frames is removed; on failure it is left for debugging.
 *
 * Run from anywhere: all paths resolve from __dirname.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = __dirname;
const HTML = path.join(ROOT, 'cinematic.html');
const FRAMES_DIR = path.join(ROOT, '.video_frames');
const OUTPUT = path.join(ROOT, 'carousel_walkthrough.mp4');
const FFMPEG = '/opt/homebrew/bin/ffmpeg';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const FPS = 30;
const WIDTH = 1080;
const HEIGHT = 1350;

function log() {
  console.log.apply(console, ['[make_video]'].concat([].slice.call(arguments)));
}

function frameUrl(withQuery) {
  // Build a proper file:// URL (handles spaces in the path).
  const base = 'file://' + encodeURI(HTML);
  return withQuery != null ? base + '?t=' + withQuery : base;
}

function freshFramesDir() {
  if (fs.existsSync(FRAMES_DIR)) {
    fs.rmSync(FRAMES_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(FRAMES_DIR, { recursive: true });
}

function framePath(i) {
  return path.join(FRAMES_DIR, 'frame-' + String(i).padStart(5, '0') + '.png');
}

/* ---------------- primary capture: puppeteer ---------------- */
async function captureWithPuppeteer() {
  let puppeteer;
  try {
    puppeteer = require('puppeteer');
  } catch (e) {
    throw new Error('puppeteer not installed: ' + e.message);
  }

  log('launching headless Chrome via puppeteer...');
  // Prefer the system Google Chrome (already trusted / not Gatekeeper-quarantined)
  // when present; puppeteer's freshly downloaded Chrome-for-Testing can stall on
  // macOS first-launch security verification. Fall back to puppeteer's bundled
  // browser if the system one isn't there.
  const launchOpts = {
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--force-color-profile=srgb']
  };
  if (fs.existsSync(CHROME)) launchOpts.executablePath = CHROME;
  const browser = await puppeteer.launch(launchOpts);

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
    // domcontentloaded (not networkidle0): the Google Fonts stylesheet can keep
    // the network "busy" in headless; we gate on window.READY which itself waits
    // for document.fonts.ready, so fonts are guaranteed loaded before capture.
    await page.goto(frameUrl(null), { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Wait until the engine finished font load + measurement.
    await page.waitForFunction('window.READY === true', { timeout: 60000 });

    const total = await page.evaluate('window.TOTAL_DURATION');
    if (typeof total !== 'number' || !(total > 0)) {
      throw new Error('bad TOTAL_DURATION: ' + total);
    }
    log('READY. TOTAL_DURATION =', total.toFixed(2), 's');

    const stage = await page.$('#stage');
    const frameCount = Math.round(FPS * total);
    log('capturing', frameCount + 1, 'frames at', FPS, 'fps...');

    for (let i = 0; i <= frameCount; i++) {
      const t = i / FPS;
      await page.evaluate('window.seek(' + t + ')');
      // Let the style write flush: wait one rAF tick.
      await page.evaluate(
        'new Promise(function(r){requestAnimationFrame(function(){requestAnimationFrame(r);});})'
      );
      await stage.screenshot({
        path: framePath(i),
        clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT }
      });
      if (i % 30 === 0 || i === frameCount) {
        log('  frame', i + '/' + frameCount);
      }
    }

    log('captured', frameCount + 1, 'frames.');
    return frameCount + 1;
  } finally {
    await browser.close();
  }
}

/* ---------------- fallback capture: Chrome CLI --screenshot ---------------- */
function captureWithChromeCli(total) {
  if (typeof total !== 'number' || !(total > 0)) {
    throw new Error('fallback needs a known TOTAL_DURATION; got ' + total);
  }
  const frameCount = Math.round(FPS * total);
  log('FALLBACK: capturing', frameCount + 1, 'frames via Chrome CLI (one process per frame)...');
  for (let i = 0; i <= frameCount; i++) {
    const t = i / FPS;
    const out = framePath(i);
    const res = spawnSync(CHROME, [
      '--headless',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-color-profile=srgb',
      '--screenshot=' + out,
      '--window-size=' + WIDTH + ',' + HEIGHT,
      '--default-background-color=0',
      '--virtual-time-budget=1500',
      frameUrl(t)
    ], { stdio: 'ignore' });
    if (res.status !== 0 || !fs.existsSync(out)) {
      throw new Error('Chrome CLI failed on frame ' + i + ' (status ' + res.status + ')');
    }
    if (i % 30 === 0 || i === frameCount) log('  frame', i + '/' + frameCount);
  }
  log('captured', frameCount + 1, 'frames via fallback.');
  return frameCount + 1;
}

/* ---------------- encode ---------------- */
function encode() {
  log('encoding started (ffmpeg libx264 yuv420p crf18 preset slow)...');
  execFileSync(FFMPEG, [
    '-y',
    '-framerate', String(FPS),
    '-i', path.join(FRAMES_DIR, 'frame-%05d.png'),
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-crf', '18',
    '-preset', 'slow',
    OUTPUT
  ], { stdio: ['ignore', 'inherit', 'inherit'] });
}

/* ---------------- main ---------------- */
async function main() {
  if (!fs.existsSync(HTML)) throw new Error('missing cinematic.html at ' + HTML);
  freshFramesDir();

  let captured = 0;
  try {
    captured = await captureWithPuppeteer();
  } catch (e) {
    log('puppeteer path failed:', e.message);
    log('attempting Chrome CLI fallback. Determining TOTAL_DURATION via one headless run...');
    // We need TOTAL_DURATION for the fallback. Try to read it with a single
    // puppeteer-less approach is not possible, so grab it with a quick Chrome
    // CLI dump if puppeteer couldn't even launch. As a safe default we parse it
    // out by loading once; if that fails too, use the documented ~38s timeline.
    let total = 38;
    try {
      // Best-effort: use puppeteer just to read the number if it loads at all.
      const puppeteer = require('puppeteer');
      const probeOpts = { headless: true, args: ['--no-sandbox'] };
      if (fs.existsSync(CHROME)) probeOpts.executablePath = CHROME;
      const b = await puppeteer.launch(probeOpts);
      const p = await b.newPage();
      await p.goto(frameUrl(null), { waitUntil: 'domcontentloaded' });
      await p.waitForFunction('window.READY === true', { timeout: 30000 });
      total = await p.evaluate('window.TOTAL_DURATION');
      await b.close();
    } catch (e2) {
      log('could not read TOTAL_DURATION dynamically (' + e2.message + '); using', total, 's');
    }
    captured = captureWithChromeCli(total);
  }

  if (!captured || captured < 2) {
    throw new Error('no frames captured; leaving .video_frames for debugging');
  }

  encode();

  const stat = fs.statSync(OUTPUT);
  const mb = (stat.size / (1024 * 1024)).toFixed(2);
  log('encode complete.');
  log('output:', OUTPUT);
  log('size:', mb, 'MB');

  // Clean up frames only on success.
  fs.rmSync(FRAMES_DIR, { recursive: true, force: true });
  log('cleaned up', FRAMES_DIR);
}

main().catch(function (err) {
  console.error('[make_video] FAILED:', err && err.stack ? err.stack : err);
  console.error('[make_video] .video_frames left in place for debugging.');
  process.exit(1);
});
