/* Cinematic walkthrough engine — deterministic, time-driven.
 *
 * Everything the viewer sees at time t is a pure function of t via window.seek(t).
 * No CSS transitions/animations, no requestAnimationFrame-driven state, no
 * wall-clock reads. The capture driver sets t = i/fps per frame, so identical
 * input t always yields identical output regardless of how fast frames render.
 *
 * Structure: #stage (fixed 1080x1350 viewport) contains #camera, which holds
 * the four slides laid out horizontally (slide n at x = n*1080). We animate the
 * camera with translate()+scale(); zooming is a CSS scale on live vector text,
 * so glyphs stay crisp (never render small then upscale a bitmap).
 */
(function () {
  'use strict';

  var STAGE_W = 1080;
  var STAGE_H = 1350;
  var SLIDE_W = 1080; // horizontal step between slides inside #camera

  // Fraction of the stage kept as padding around a zoom target so the window
  // does not touch the frame edge.
  var PAD = 0.06;
  // Cap the zoom so the short slide-4 C window doesn't blow up absurdly.
  var MAX_ZOOM = 2.4;

  var stage = document.getElementById('stage');
  var camera = document.getElementById('camera');

  // ---- easing -------------------------------------------------------------
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

  function easeInOutCubic(x) {
    x = clamp01(x);
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  }

  function lerp(a, b, p) { return a + (b - a) * p; }

  // ---- geometry -----------------------------------------------------------
  // Full-slide camera framing for slide index n (0-based): scale 1, pan only.
  function fullFrame(n) {
    return { tx: -n * SLIDE_W, ty: 0, scale: 1 };
  }

  // Camera transform that centers a target rect (stage coordinates) in the
  // stage, scaled to fill it minus PAD, clamped to MAX_ZOOM.
  function frameRect(r) {
    var scale = Math.min(
      STAGE_W / (r.w * (1 + 2 * PAD)),
      STAGE_H / (r.h * (1 + 2 * PAD))
    );
    if (scale > MAX_ZOOM) scale = MAX_ZOOM;
    var cx = r.x + r.w / 2;
    var cy = r.y + r.h / 2;
    return {
      tx: STAGE_W / 2 - cx * scale,
      ty: STAGE_H / 2 - cy * scale,
      scale: scale
    };
  }

  // Measure an element's rect in stage coordinates. We read the element's
  // offset within #camera directly (offsetLeft/Top + sizes) rather than
  // getBoundingClientRect so the numbers are independent of the camera's own
  // current transform — i.e. true, untransformed stage coordinates. We still
  // satisfy the brief by deriving framing from the live DOM layout.
  function rectInCamera(el) {
    var x = 0, y = 0, node = el;
    // Accumulate offsets up to #camera (which is positioned, so it terminates
    // the offsetParent chain for its descendants).
    while (node && node !== camera) {
      x += node.offsetLeft;
      y += node.offsetTop;
      node = node.offsetParent;
    }
    return { x: x, y: y, w: el.offsetWidth, h: el.offsetHeight };
  }

  // ---- measured targets (filled on load) ----------------------------------
  // For each case slide we store: full-slide frame, C-window frame,
  // C++-window frame, and the callout element.
  var targets = {}; // keyed by slide index 1..3 (slides 2,3,4)

  function measure() {
    for (var slideIdx = 2; slideIdx <= 4; slideIdx++) {
      var slide = document.getElementById('slide-' + slideIdx);
      var windows = slide.querySelectorAll('.code-window');
      var cWin = windows[0];
      var cppWin = windows[1];
      var callout = cppWin.querySelector('.code-side-callout');
      targets[slideIdx] = {
        n: slideIdx - 1, // 0-based camera index
        full: fullFrame(slideIdx - 1),
        cFrame: frameRect(rectInCamera(cWin)),
        cppFrame: frameRect(rectInCamera(cppWin)),
        callout: callout
      };
    }
  }

  // ---- timeline -----------------------------------------------------------
  // Each segment is {start, end, apply(local, p)} where p = eased progress.
  // We build camera-transform segments plus independent callout-pop segments.
  var SEGMENTS = [];
  var CALLOUT_POPS = [];

  function buildTimeline() {
    var cover = fullFrame(0);
    // A gentle Ken-Burns end state for the cover (slight zoom-in, re-centered).
    var coverKB = (function () {
      var scale = 1.04;
      var cx = STAGE_W / 2, cy = STAGE_H / 2;
      return { tx: STAGE_W / 2 - cx * scale, ty: STAGE_H / 2 - cy * scale, scale: scale };
    })();

    // Helper to push a camera tween segment.
    function tween(start, end, from, to) {
      SEGMENTS.push({ start: start, end: end, from: from, to: to });
    }

    // --- Cover (slide 1): fade/slide in, hold, gentle Ken-Burns -----------
    // 0.0 - 4.5 : cover holds while slowly zooming (fade handled separately).
    tween(0.0, 4.5, cover, coverKB);

    // --- Transition 1 -> 2 -------------------------------------------------
    tween(4.5, 5.5, coverKB, fullFrame(1));

    // Per-case-slide beats. Returns the end time.
    function caseSlide(slideIdx, t0) {
      var T = targets[slideIdx];
      var full = T.full, cF = T.cFrame, cppF = T.cppFrame;

      // settle on full slide
      tween(t0 + 0.0, t0 + 0.8, full, full);
      // zoom to C window
      tween(t0 + 0.8, t0 + 1.6, full, cF);
      // hold on C
      tween(t0 + 1.6, t0 + 3.6, cF, cF);
      // pan/zoom to C++ window
      tween(t0 + 3.6, t0 + 4.5, cF, cppF);
      // hold on C++ (callout pops during this hold, then a long reading pause)
      tween(t0 + 4.5, t0 + 8.6, cppF, cppF);
      // zoom back out to full slide
      tween(t0 + 8.6, t0 + 9.4, cppF, full);

      // Callout pop: starts a short delay after C++ settles ("punchline").
      CALLOUT_POPS.push({
        el: T.callout,
        start: t0 + 4.8,
        end: t0 + 5.6
      });

      return t0 + 9.4;
    }

    var t = 5.5;
    t = caseSlide(2, t);          // slide 2 beats
    tween(t, t + 1.0, targets[2].full, fullFrame(2)); // transition 2 -> 3
    t = t + 1.0;
    t = caseSlide(3, t);          // slide 3 beats
    tween(t, t + 1.0, targets[3].full, fullFrame(3)); // transition 3 -> 4
    t = t + 1.0;
    t = caseSlide(4, t);          // slide 4 beats

    // Final clean, static hold on slide 4.
    var finalEnd = t + 2.6;
    tween(t, finalEnd, targets[4].full, targets[4].full);

    window.TOTAL_DURATION = finalEnd;
  }

  // ---- seek ---------------------------------------------------------------
  function activeSegment(t) {
    // Clamp to timeline bounds.
    if (t <= SEGMENTS[0].start) return { seg: SEGMENTS[0], p: 0 };
    for (var i = 0; i < SEGMENTS.length; i++) {
      var s = SEGMENTS[i];
      if (t >= s.start && t <= s.end) {
        var span = s.end - s.start;
        var p = span <= 0 ? 1 : (t - s.start) / span;
        return { seg: s, p: p };
      }
    }
    // Past the end: hold the last segment's end state.
    return { seg: SEGMENTS[SEGMENTS.length - 1], p: 1 };
  }

  function applyCamera(t) {
    var a = activeSegment(t);
    var p = easeInOutCubic(a.p);
    var from = a.seg.from, to = a.seg.to;
    var tx = lerp(from.tx, to.tx, p);
    var ty = lerp(from.ty, to.ty, p);
    var scale = lerp(from.scale, to.scale, p);
    camera.style.transform =
      'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')';
  }

  function applyCoverFade(t) {
    // Slide 1 gently settles in over the first 0.7s: a subtle upward rise plus
    // a soft fade. We start from a high baseline opacity (not 0) so the very
    // first frame already shows the cover clearly — a clean opening frame, no
    // white flash. Implemented on the slide, not the camera, so it doesn't
    // fight the Ken-Burns zoom. Pure function of t.
    var slide1 = document.getElementById('slide-1');
    var INTRO = 0.7;
    var p = easeInOutCubic(clamp01(t / INTRO));
    var opacity = lerp(0.55, 1, p); // frame 0 is already visible
    var rise = (1 - p) * 18;        // px, subtle settle
    if (t >= INTRO) { opacity = 1; rise = 0; }
    slide1.style.opacity = String(opacity);
    slide1.style.transform = 'translateY(' + rise + 'px)';
  }

  function applyCallouts(t) {
    for (var i = 0; i < CALLOUT_POPS.length; i++) {
      var pop = CALLOUT_POPS[i];
      var el = pop.el;
      var p;
      if (t <= pop.start) p = 0;
      else if (t >= pop.end) p = 1;
      else p = easeInOutCubic((t - pop.start) / (pop.end - pop.start));
      var ty = (1 - p) * 18;          // translate up 18px -> 0
      var scale = lerp(0.96, 1.0, p); // slight scale
      el.style.opacity = String(p);
      el.style.transform = 'translateY(' + ty + 'px) scale(' + scale + ')';
      el.style.transformOrigin = 'center top';
    }
  }

  function seek(t) {
    if (typeof t !== 'number' || isNaN(t)) t = 0;
    applyCamera(t);
    applyCoverFade(t);
    applyCallouts(t);
  }
  window.seek = seek;

  // ---- init ---------------------------------------------------------------
  function init() {
    measure();
    buildTimeline();

    // Set an initial deterministic state.
    seek(0);

    // Support the ?t=<seconds> fallback path (one Chrome --screenshot per frame).
    var qs = new URLSearchParams(window.location.search);
    if (qs.has('t')) {
      seek(Number(qs.get('t')));
    }

    window.READY = true;
  }

  // Only declare READY after fonts are loaded and layout is measured, so the
  // monospace metrics used for framing are final.
  window.READY = false;
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () {
      // Two rAF ticks to let the final font layout flush before measuring.
      requestAnimationFrame(function () {
        requestAnimationFrame(init);
      });
    });
  } else {
    window.addEventListener('load', init);
  }
})();
