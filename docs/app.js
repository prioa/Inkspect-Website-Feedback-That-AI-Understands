/*
 * Bewegung der Inkspect-Website (GSAP 3.15 + ScrollTrigger).
 *
 * Leitidee: die Seite markiert sich selbst. Was das Addon auf einer fremden
 * Website tut — anpinnen, umranden, messen, Werte veraendern, uebergeben —
 * fuehrt die Seite beim Scrollen an einem Mockup vor.
 *
 * Regeln fuer diese Datei:
 *
 * - Faellt das CDN aus, bleibt die Seite lesbar: ohne `gsap` wird `.no-anim`
 *   gesetzt und die Startzustaende aus style.css sind wieder sichtbar.
 * - `prefers-reduced-motion: reduce` schaltet alles ab, nur die Ankerlinks
 *   bleiben verdrahtet.
 * - Alles, was Laenge oder Abstand in Pixeln braucht, steckt in einer
 *   Funktion (`end: () => …`) — ScrollTrigger wertet die bei jedem Refresh
 *   neu aus, sonst stimmen die Strecken nach einem Resize nicht mehr.
 */
(function () {
  'use strict';

  var html = document.documentElement;
  var q = function (sel, ctx) { return (ctx || document).querySelector(sel); };
  var qa = function (sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); };

  /* Ankerlinks laufen ueber den Smoother, sonst springt die Seite. */
  function wireLinks(smoother) {
    qa('a[href^="#"]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        var target = q(a.getAttribute('href'));
        if (!target) return;
        e.preventDefault();
        if (smoother) smoother.scrollTo(target, true, 'top 80px');
        else target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  if (!window.gsap || !window.ScrollTrigger) {
    html.classList.add('no-anim');
    wireLinks(null);
    return;
  }

  /* Jedes Plugin einzeln pruefen: faellt eine CDN-Datei aus, laeuft der Rest
     weiter — jede Stelle, die eines braucht, hat einen Ersatzweg. */
  gsap.registerPlugin(ScrollTrigger);
  var hasSplit = !!window.SplitText;
  var hasDraw = !!window.DrawSVGPlugin;
  var hasPath = !!window.MotionPathPlugin;
  if (window.ScrollSmoother) gsap.registerPlugin(ScrollSmoother);
  if (hasSplit) gsap.registerPlugin(SplitText);
  if (hasDraw) gsap.registerPlugin(DrawSVGPlugin);
  if (hasPath) gsap.registerPlugin(MotionPathPlugin);

  /*
   * Endzustand fuer alles, was sonst ein Scrub setzt. Wird sowohl bei
   * `prefers-reduced-motion` als auch auf schmalen Schirmen gebraucht, wo
   * die gepinnten Abschnitte gar nicht erst entstehen.
   */
  function staticState() {
    gsap.set(['#pickbox', '.logrow', '.padband', '.padtag'], { opacity: 1 });
    gsap.set('#t-pad', { width: '62%' });
    gsap.set('#t-weight', { width: '100%' });
  }

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    html.classList.add('no-anim');
    gsap.set('[data-reveal]', { clearProps: 'all' });
    staticState();
    wireLinks(null);
    return;
  }

  var smoother = null;
  if (window.ScrollSmoother) {
    try {
      smoother = ScrollSmoother.create({
        wrapper: '#smooth-wrapper',
        content: '#smooth-content',
        smooth: 1.1,
        effects: true,        /* data-speed / data-lag */
        smoothTouch: 0,       /* auf Touch nativ scrollen lassen */
        ignoreMobileResize: true
      });
    } catch (err) {
      smoother = null;
    }
  }
  wireLinks(smoother);

  var mm = gsap.matchMedia();
  var WIDE = '(min-width: 900px)';

  /* ───────────────────────── Kopf, Fortschritt, Dock ───────────────────── */

  ScrollTrigger.create({
    start: 0,
    end: 'max',
    onUpdate: function (self) { gsap.set('.ink-bar__fill', { scaleX: self.progress }); }
  });

  ScrollTrigger.create({
    start: 'top -20',
    end: 'max',
    toggleClass: { targets: '.top', className: 'is-stuck' }
  });

  mm.add(WIDE, function () {
    var dock = q('.dock');
    if (!dock) return;

    gsap.to(dock, {
      opacity: 1, x: 0, duration: .5, ease: 'power2.out',
      scrollTrigger: { trigger: '.hero', start: 'bottom 70%', toggleActions: 'play none none reverse' }
    });

    /* Der sichtbare Abschnitt bestimmt, welches Werkzeug leuchtet. */
    qa('section[data-tool]').forEach(function (section) {
      ScrollTrigger.create({
        trigger: section,
        start: 'top 55%',
        end: 'bottom 45%',
        onToggle: function (self) {
          if (!self.isActive) return;
          qa('.dock__tool').forEach(function (t) {
            t.classList.toggle('is-on', t.dataset.tool === section.dataset.tool);
          });
        }
      });
    });
  });

  /* ───────────────────────────── Ueberschriften ────────────────────────── */

  /* Zeilenweise aus einer Maske hochschieben. */
  function revealHeadline(el, trigger) {
    gsap.set(el, { opacity: 1 });
    if (!hasSplit) {
      gsap.from(el, {
        y: 24, opacity: 0, duration: .8, ease: 'power3.out',
        scrollTrigger: { trigger: trigger || el, start: 'top 85%', once: true }
      });
      return;
    }
    SplitText.create(el, {
      type: 'lines',
      mask: 'lines',
      autoSplit: true,   /* neu umbrechen, wenn sich die Breite aendert */
      onSplit: function (self) {
        return gsap.from(self.lines, {
          yPercent: 115, opacity: 0, duration: .85, ease: 'power3.out', stagger: .09,
          scrollTrigger: { trigger: trigger || el, start: 'top 85%', once: true }
        });
      }
    });
  }

  qa('.h2').forEach(function (h) { revealHeadline(h); });

  /* Absaetze, Listen, Buttons: der ruhige Rest. */
  qa('[data-reveal]').forEach(function (el) {
    if (el.closest('.hero') || el.classList.contains('h2')) return;
    gsap.to(el, {
      opacity: 1, y: 0, duration: .7, ease: 'power2.out',
      scrollTrigger: { trigger: el, start: 'top 88%', once: true },
      startAt: { y: 20 }
    });
  });

  /* ──────────────────────────────── Hero ───────────────────────────────── */

  (function hero() {
    var tl = gsap.timeline({ defaults: { ease: 'power3.out' } });

    tl.to('.hero__kicker', { opacity: 1, y: 0, duration: .6, startAt: { y: 12 } });

    if (hasSplit) {
      var split = SplitText.create('.hero__h1 .split', { type: 'chars,words', mask: 'words' });
      tl.from(split.chars, { yPercent: 120, opacity: 0, duration: .7, stagger: .022 }, '-=.35');
    } else {
      tl.from('.hero__h1 .split', { yPercent: 40, opacity: 0, duration: .7 }, '-=.35');
    }

    tl.from('.hero__h1 em', { yPercent: 60, opacity: 0, duration: .7 }, '-=.35');

    /* Der Unterstrich wird gezogen, nicht eingeblendet. */
    if (hasDraw) {
      tl.fromTo('.scribble path',
        { drawSVG: '0%' },
        { drawSVG: '100%', duration: .55, stagger: .12, ease: 'power1.inOut' }, '-=.15');
    } else {
      tl.from('.scribble', { opacity: 0, duration: .4 }, '-=.2');
    }

    tl.to('.hero__lead', { opacity: 1, y: 0, duration: .6, startAt: { y: 16 } }, '-=.5')
      .to('.hero .cta', { opacity: 1, y: 0, duration: .6, startAt: { y: 16 } }, '-=.4')
      .to('.hero__note', { opacity: 1, duration: .6 }, '-=.35')
      .from('.stage--hero', { y: 70, opacity: 0, rotateX: 9, transformPerspective: 1400, duration: 1.1 }, '-=.5')
      .from('.hero__hint', { opacity: 0, duration: .6 }, '-=.4');

    /* Scrollhinweis verschwindet, sobald man ihn befolgt. */
    gsap.to('.hero__hint', {
      opacity: 0, duration: .3,
      scrollTrigger: { trigger: '.hero', start: 'top top-=80', toggleActions: 'play none none reverse' }
    });
  })();

  /* ──────────────── Buehne: die Seite markiert sich selbst ─────────────── */

  (function annotate() {
    var stage = q('#stage-hero');
    if (!stage) return;

    var draw = function (sel, dur) {
      return hasDraw
        ? { targets: sel, from: { drawSVG: '0% 0%' }, to: { drawSVG: '0% 100%', duration: dur } }
        : { targets: sel, from: { opacity: 0 }, to: { opacity: 1, duration: dur } };
    };

    var tl = gsap.timeline({
      defaults: { ease: 'none' },
      scrollTrigger: {
        trigger: stage,
        start: 'top 72%',
        end: 'bottom 55%',
        scrub: .8
      }
    });

    /* 1 · Hilfslinien messen den Abstand zwischen Lead und Button. */
    tl.from('.a-guide', { scaleX: 0, transformOrigin: '0% 50%', duration: 1, stagger: .25 })
      .from('.ann__note--3', { opacity: 0, x: -14, duration: .6 }, '-=.4');

    /* 2 · Freihandstrich im Lead */
    var pen = draw('.a-pen', 1);
    tl.fromTo(pen.targets, pen.from, pen.to, '+=.2');

    /* 3 · Kommentar-Pin an der Headline */
    var pin = draw('.a-pin', .9);
    tl.fromTo(pin.targets, pin.from, pin.to, '+=.2')
      .from('.a-pinno', { opacity: 0, scale: 0, transformOrigin: '50% 50%', duration: .4 }, '-=.3')
      .from('.ann__note--1', { opacity: 0, x: -18, duration: .7 }, '-=.4');

    /* 4 · Rahmen um den Button, dann der Pfeil mit Notiz */
    var rect = draw('.a-rect', 1.4);
    tl.fromTo(rect.targets, rect.from, rect.to, '+=.15');

    var arrow = draw('.a-arrow', 1);
    tl.from('.ann__note--2', { opacity: 0, y: 14, duration: .5 }, '+=.1')
      .fromTo(arrow.targets, arrow.from, arrow.to, '-=.2');

    var head = draw('.a-head', .35);
    tl.fromTo(head.targets, head.from, head.to, '-=.15');

    /* 5 · Element-Auswahl auf der zweiten Karte */
    tl.from('.a-pick', { opacity: 0, scale: 1.09, transformOrigin: '50% 50%', duration: .7, ease: 'power2.out' }, '+=.15')
      .from('.ann__note--4', { opacity: 0, y: -10, duration: .5 }, '-=.35');
  })();

  /* ─────────────── Uebergabe: unscharfe Notiz → Checkliste ─────────────── */

  mm.add(WIDE, function () {
    var stick = q('.handoff__stick');
    var grid = q('.handoff__grid');
    if (!stick || !grid) return;

    var tl = gsap.timeline({
      defaults: { ease: 'none' },
      scrollTrigger: {
        trigger: stick,
        start: 'center center',
        end: '+=110%',
        pin: true,
        scrub: .5,
        anticipatePin: 1,
        invalidateOnRefresh: true
      }
    });

    tl.set('.handoff__seam', { opacity: 1 })
      /* Von links nach rechts aufziehen — die Naht laeuft genau auf der
         Kante des Clips mit, deshalb muessen beide dieselbe Richtung haben. */
      .fromTo('.sharp', { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', duration: 1 }, 0)
      .fromTo('.handoff__seam', { x: 0 }, { x: function () { return grid.offsetWidth; }, duration: 1 }, 0)
      .to('.vague .stage', { opacity: .12, duration: 1 }, 0)
      .to('.vague figcaption', { opacity: .25, scale: .96, duration: 1 }, 0)
      .to('.vague__stamp', { opacity: 0, duration: .3 }, 0)
      .to('.handoff__seam', { opacity: 0, duration: .15 }, .92)
      .from('.sharp__stamp', { opacity: 0, y: 10, duration: .2, ease: 'power2.out' }, .8);
  });

  /* ──────────── Element-Picker: Werte aendern sich beim Scrollen ───────── */

  mm.add(WIDE, function () {
    var cta = q('#edit-cta');
    var label = q('#edit-label');
    if (!cta || !label) return;

    var vPad = q('#v-pad');
    var vWeight = q('#v-weight');
    var vText = q('#v-text');
    var padTag = q('#pad-top');

    /* Zwischenwerte laufen ueber ein Hilfsobjekt: so bleibt der Scrub in
       beide Richtungen deterministisch — auch beim Zuruecktscrollen. */
    var state = { pad: 8, weight: 500, text: 0 };
    var TEXT_A = 'Get started';
    var TEXT_B = 'Start your free trial';

    var applyPad = function () {
      var v = Math.round(state.pad);
      cta.style.setProperty('--pad', state.pad);
      if (vPad) vPad.textContent = v;
      if (padTag) padTag.textContent = v + 'px';
    };
    var applyWeight = function () {
      var v = Math.round(state.weight / 100) * 100;
      cta.style.setProperty('--weight', v);
      if (vWeight) vWeight.textContent = v;
    };
    var applyText = function () {
      var t = state.text > .5 ? TEXT_B : TEXT_A;
      if (label.textContent !== t) label.textContent = t;
      if (vText) vText.textContent = t;
    };

    var tl = gsap.timeline({
      defaults: { ease: 'none' },
      scrollTrigger: {
        trigger: '.inspect__stick',
        start: 'center center',
        end: '+=190%',
        pin: true,
        scrub: .6,
        anticipatePin: 1,
        invalidateOnRefresh: true
      }
    });

    /* Die Protokollzeilen stehen im CSS auf `opacity: 0` — ein `from` wuerde
       von 0 nach 0 animieren. Deshalb ueberall `fromTo`. */
    var logIn = function (nth, at) {
      tl.fromTo('.logrow:nth-child(' + nth + ')',
        { opacity: 0, x: 12 },
        { opacity: 1, x: 0, duration: .3, ease: 'power2.out' }, at);
    };

    /* 1 · Picker rastet auf dem Button ein */
    tl.fromTo('#pickbox',
      { opacity: 0, scale: 1.35, transformOrigin: '50% 50%' },
      { opacity: 1, scale: 1, duration: .5, ease: 'power2.out' })
      .fromTo('#pickbox i', { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: .3 }, '-=.2');

    /* 2 · padding-top wird gezogen — Band und Zahl wachsen mit */
    tl.to(['.padband', padTag], { opacity: 1, duration: .2 }, '+=.15')
      .to(state, { pad: 14, duration: .9, onUpdate: applyPad }, '<')
      .to('#t-pad', { width: '62%', duration: .9 }, '<');
    logIn(1, '-=.2');

    /* 3 · font-weight */
    tl.to(state, { weight: 700, duration: .7, onUpdate: applyWeight }, '+=.2')
      .to('#t-weight', { width: '100%', duration: .7 }, '<');
    logIn(2, '-=.2');

    /* 4 · Text — der Button wird dabei sichtbar breiter */
    tl.to(label, { opacity: .15, filter: 'blur(3px)', duration: .18, ease: 'power1.in' }, '+=.25')
      .to(state, { text: 1, duration: .01, onUpdate: applyText }, '<+.15')
      .to(label, { opacity: 1, filter: 'blur(0px)', duration: .25, ease: 'power1.out' });
    logIn(3, '-=.15');

    /* 5 · Ergebnis kurz stehen lassen */
    tl.to('#pickbox', { borderColor: 'var(--m-green)', duration: .3 }, '+=.1')
      .to({}, { duration: .5 });

    applyPad(); applyWeight(); applyText();
  });

  /* Schmale Schirme: keine Pins, dafuer ein ruhiges Einblenden. */
  mm.add('(max-width: 899px)', function () {
    gsap.set('.sharp', { clipPath: 'none' });
    gsap.from('.sharp', {
      opacity: 0, y: 24, duration: .7, ease: 'power2.out',
      scrollTrigger: { trigger: '.sharp', start: 'top 88%', once: true }
    });
    /* Ohne Scrub steht die Vorfuehrung still — also gleich im Endzustand. */
    staticState();
  });

  /* ─────────────── Geraete: horizontal, alle Rahmen synchron ───────────── */

  mm.add(WIDE, function () {
    var stick = q('.devices__stick');
    var track = q('.devices__track');
    if (!stick || !track) return;

    var dist = function () { return Math.max(0, track.scrollWidth - window.innerWidth); };

    var tl = gsap.timeline({
      defaults: { ease: 'none' },
      scrollTrigger: {
        trigger: stick,
        start: 'center center',
        end: function () { return '+=' + dist(); },
        pin: true,
        scrub: .6,
        anticipatePin: 1,
        invalidateOnRefresh: true
      }
    });

    tl.to(track, { x: function () { return -dist(); }, duration: 1 }, 0)
      /* Der Kern der Vorfuehrung: alle Rahmen scrollen gemeinsam. */
      .to('.mini__page', { yPercent: -62, duration: 1 }, 0);

    gsap.to('.sync i', {
      boxShadow: '0 0 0 7px rgba(62,207,110,0)',
      duration: 1.4, repeat: -1, ease: 'power2.out'
    });
  });

  mm.add('(max-width: 899px)', function () {
    gsap.to('.mini__page', {
      yPercent: -55, ease: 'none',
      scrollTrigger: { trigger: '.devices__stick', start: 'top bottom', end: 'bottom top', scrub: .6 }
    });
  });

  /* ────────────────────────────── Uebergabe ────────────────────────────── */

  (function handover() {
    /* Markdown: Haken setzen sich nacheinander. */
    var tasks = qa('.task');
    if (tasks.length) {
      gsap.set(tasks, { opacity: 0, x: -14 });
      var tlMd = gsap.timeline({
        scrollTrigger: { trigger: '.way[data-way="md"]', start: 'top 78%', once: true }
      });
      tlMd.to(tasks, { opacity: 1, x: 0, duration: .4, stagger: .1, ease: 'power2.out' })
        .add(function () { tasks[0].classList.add('is-done'); }, '+=.25')
        .add(function () { tasks[1].classList.add('is-done'); }, '+=.35');
    }

    /* Share-Link: der Rohtext faellt in die URL zusammen. */
    var squeeze = q('#squeeze');
    if (squeeze) {
      var alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
      var chars = [];
      for (var i = 0; i < 150; i++) {
        var s = document.createElement('span');
        s.textContent = alphabet.charAt((i * 37 + (i % 7) * 11) % alphabet.length);
        squeeze.appendChild(s);
        chars.push(s);
      }
      gsap.set('.linkpill', { opacity: 0, y: 10 });
      gsap.timeline({
        scrollTrigger: { trigger: '.way[data-way="link"]', start: 'top 72%', once: true }
      })
        .to(chars, {
          scaleX: 0, opacity: 0, duration: .5, ease: 'power2.in',
          stagger: { each: .006, from: 'edges' }
        })
        .to('.linkpill', { opacity: 1, y: 0, duration: .5, ease: 'power3.out' }, '-=.3');
    }

    /* PDF: ein Blatt je Viewport faechert auf. */
    var sheets = qa('.sheet');
    if (sheets.length) {
      gsap.set(sheets, { opacity: 0, y: 26, rotate: 0 });
      gsap.to(sheets, {
        opacity: 1, y: 0,
        x: function (i) { return (i - 1) * 34; },
        rotate: function (i) { return (i - 1) * 9; },
        duration: .7, stagger: .12, ease: 'back.out(1.4)',
        scrollTrigger: { trigger: '.way[data-way="pdf"]', start: 'top 78%', once: true }
      });
    }
  })();

  /* ───────────────────────────── Kachelraster ──────────────────────────── */

  (function cards() {
    var items = qa('.more .card');
    if (!items.length) return;
    gsap.set(items, { opacity: 0, y: 30 });
    ScrollTrigger.batch(items, {
      start: 'top 90%',
      onEnter: function (batch) {
        gsap.to(batch, { opacity: 1, y: 0, duration: .6, stagger: .07, ease: 'power2.out', overwrite: true });
      }
    });
  })();

  /* ───────────── Datenschutz: Daten prallen an der Grenze ab ───────────── */

  (function vault() {
    var dots = qa('.vault__dots circle');
    if (!dots.length || !hasPath) return;

    dots.forEach(function (dot, i) {
      var path = '#p' + (i + 1);
      gsap.set(dot, { opacity: 0 });

      var tl = gsap.timeline({
        repeat: -1,
        repeatDelay: .5,
        delay: i * .55,
        scrollTrigger: {
          trigger: '.privacy',
          start: 'top 80%',
          end: 'bottom 20%',
          toggleActions: 'play pause resume pause'
        }
      });

      tl.set(dot, { opacity: 1 })
        .to(dot, { motionPath: { path: path, start: 0, end: 1 }, duration: 1.5, ease: 'power1.in' })
        /* Aufprall: die Wand blitzt, der Punkt staucht sich. */
        .to('.vault__wall', { opacity: 1, duration: .1 }, '-=.06')
        .to(dot, { scale: .55, duration: .1, transformOrigin: '50% 50%' }, '<')
        .to('.vault__wall', { opacity: 0, duration: .55 })
        .to(dot, { scale: 1, duration: .3 }, '<')
        .to(dot, { motionPath: { path: path, start: 1, end: 0 }, duration: 1.2, ease: 'power2.out' }, '<')
        .to(dot, { opacity: 0, duration: .25 }, '-=.2');
    });
  })();

  /* ─────────────────────────── Schluss: Kringel ────────────────────────── */

  (function ring() {
    var ring = q('.ring path');
    if (!ring) return;
    if (hasDraw) {
      gsap.fromTo(ring, { drawSVG: '0%' }, {
        drawSVG: '100%', duration: .9, ease: 'power1.inOut',
        scrollTrigger: { trigger: '.last', start: 'top 70%', once: true }
      });
    } else {
      gsap.from('.ring', {
        opacity: 0, duration: .6,
        scrollTrigger: { trigger: '.last', start: 'top 70%', once: true }
      });
    }
  })();

  /* Bilder koennen die Hoehe aendern, nachdem ScrollTrigger gemessen hat. */
  window.addEventListener('load', function () { ScrollTrigger.refresh(); });
})();
