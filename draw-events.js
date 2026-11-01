/**
 * Ивенты во время рисования — тосты и лёгкие эффекты для всей комнаты.
 */
(function (global) {
  const COOLDOWN_MS = 7000;
  const MAX_EVENTS_PER_ROUND = 6;

  let roundEventCount = 0;
  let lastEventAt = 0;
  let strokeCount = 0;
  let eraseStrokeCount = 0;
  let recentStrokeTimes = [];
  let strokeStart = null;
  let lastColor = null;
  let colorChanges = [];
  const firedOnce = new Set();

  const EVENTS = {
    first_stroke: { text: "Первый мазок — поехали!", fx: "fx-ink" },
    speed_sketch: { text: "⚡ Скоростной скетч!", fx: "fx-speed" },
    strokes_100: { text: "Сотня штрихов. Холст страдает.", fx: "fx-milestone" },
    strokes_250: { text: "Картина разрастается…", fx: "fx-milestone" },
    long_line: { text: "Линия через весь холст!", fx: "fx-long" },
    mega_brush: { text: "Жирная кисть — жирный замысел.", fx: "fx-thick" },
    eraser_storm: { text: "Ластик правит бал.", fx: "fx-erase" },
    fill_splash: { text: "Бульк! Заливка.", fx: "fx-fill" },
    clean_slate: { text: "Чистый лист — заново!", fx: "fx-clear" },
    edge_walk: { text: "Осторожно, самый край!", fx: "fx-edge" },
    rainbow_hands: { text: "Радуга на пальцах.", fx: "fx-rainbow" },
    time_travel: { text: "Шаг назад во времени.", fx: "fx-undo" }
  };

  function resetDrawEvents() {
    roundEventCount = 0;
    lastEventAt = 0;
    strokeCount = 0;
    eraseStrokeCount = 0;
    recentStrokeTimes = [];
    strokeStart = null;
    lastColor = null;
    colorChanges = [];
    firedOnce.clear();
    hideDrawEventToast();
  }

  function canFire(id) {
    if (roundEventCount >= MAX_EVENTS_PER_ROUND) return false;
    if (Date.now() - lastEventAt < COOLDOWN_MS) return false;
    if (id && firedOnce.has(id)) return false;
    return true;
  }

  function emitDrawEvent(id) {
    const def = EVENTS[id];
    if (!def || !canFire(id)) return;
    firedOnce.add(id);
    roundEventCount++;
    lastEventAt = Date.now();
    showDrawEventUi(def.text, def.fx);
    if (typeof broadcastPacket === "function") {
      broadcastPacket({
        type: "DRAW_EVENT",
        eventId: id,
        text: def.text,
        fx: def.fx
      });
    }
  }

  function showDrawEventUi(text, fxClass) {
    const toast = document.getElementById("canvasEventToast");
    const board = document.getElementById("containerBoard");
    const layer = document.getElementById("canvasEventLayer");
    if (toast) {
      toast.textContent = text;
      toast.classList.remove("hidden");
      toast.classList.add("canvas-event-toast-show");
      clearTimeout(showDrawEventUi._hideT);
      showDrawEventUi._hideT = setTimeout(() => {
        toast.classList.add("hidden");
        toast.classList.remove("canvas-event-toast-show");
      }, 2800);
    }
    if (board && fxClass) {
      board.classList.remove(
        "fx-ink", "fx-speed", "fx-milestone", "fx-long", "fx-thick",
        "fx-erase", "fx-fill", "fx-clear", "fx-edge", "fx-rainbow", "fx-undo"
      );
      board.classList.add(fxClass);
      clearTimeout(showDrawEventUi._fxT);
      showDrawEventUi._fxT = setTimeout(() => {
        board.classList.remove(fxClass);
      }, 650);
    }
    if (layer && fxClass === "fx-fill") {
      spawnCanvasSparkles(6);
    } else if (layer && (fxClass === "fx-speed" || fxClass === "fx-milestone")) {
      spawnCanvasSparkles(4);
    }
  }

  function hideDrawEventToast() {
    const toast = document.getElementById("canvasEventToast");
    if (toast) toast.classList.add("hidden");
  }

  function spawnCanvasSparkles(n) {
    const layer = document.getElementById("canvasEventLayer");
    if (!layer) return;
    const glyphs = ["✦", "✧", "·", "◦", "★"];
    for (let i = 0; i < n; i++) {
      const el = document.createElement("span");
      el.className = "canvas-event-spark";
      el.textContent = glyphs[Math.floor(Math.random() * glyphs.length)];
      el.style.left = 8 + Math.random() * 84 + "%";
      el.style.top = 10 + Math.random() * 70 + "%";
      el.style.animationDelay = Math.random() * 0.2 + "s";
      layer.appendChild(el);
      setTimeout(() => el.remove(), 1200);
    }
  }

  function onRemoteDrawEvent(packet) {
    if (!packet || !packet.text) return;
    showDrawEventUi(packet.text, packet.fx || "");
  }

  function noteStrokeStart(x, y) {
    strokeStart = { x, y };
  }

  function noteStrokeEnd(x, y) {
    if (!strokeStart) return;
    const dx = x - strokeStart.x;
    const dy = y - strokeStart.y;
    const len = Math.hypot(dx, dy);
    strokeStart = null;
    if (len >= 140 && canFire("long_line")) emitDrawEvent("long_line");
  }

  function noteDrawSegment(prevX, prevY, currX, currY, opts) {
    if (typeof gameState === "undefined") return;
    if (gameState.currentDrawerId !== myPlayerId || gameState.status !== "DRAWING") return;

    strokeCount++;
    const now = Date.now();
    recentStrokeTimes.push(now);
    recentStrokeTimes = recentStrokeTimes.filter(t => now - t < 1500);

    if (strokeCount === 1) emitDrawEvent("first_stroke");

    if (recentStrokeTimes.length >= 10) emitDrawEvent("speed_sketch");
    if (strokeCount === 100) emitDrawEvent("strokes_100");
    if (strokeCount === 250) emitDrawEvent("strokes_250");

    const isErase = opts && opts.erase;
    if (isErase) {
      eraseStrokeCount++;
      if (eraseStrokeCount === 18) emitDrawEvent("eraser_storm");
    }

    const size = (opts && opts.size) || 3;
    if (size >= 28 && canFire("mega_brush")) emitDrawEvent("mega_brush");

    if (canvas) {
      const margin = 18;
      const nearEdge =
        currX < margin || currY < margin ||
        currX > canvas.width - margin || currY > canvas.height - margin;
      if (nearEdge) emitDrawEvent("edge_walk");
    }
  }

  function noteDrawFill() {
    emitDrawEvent("fill_splash");
  }

  function noteDrawClear() {
    emitDrawEvent("clean_slate");
  }

  function noteDrawUndo() {
    emitDrawEvent("time_travel");
  }

  function noteDrawColorChange(color) {
    if (!color || color === lastColor) return;
    lastColor = color;
    const now = Date.now();
    colorChanges.push(now);
    colorChanges = colorChanges.filter(t => now - t < 12000);
    if (colorChanges.length >= 5) emitDrawEvent("rainbow_hands");
  }

  global.resetDrawEvents = resetDrawEvents;
  global.noteDrawStrokeStart = noteStrokeStart;
  global.noteDrawStrokeEnd = noteStrokeEnd;
  global.noteDrawSegment = noteDrawSegment;
  global.noteDrawFill = noteDrawFill;
  global.noteDrawClear = noteDrawClear;
  global.noteDrawUndo = noteDrawUndo;
  global.noteDrawColorChange = noteDrawColorChange;
  global.onRemoteDrawEvent = onRemoteDrawEvent;
  global.showDrawEventUi = showDrawEventUi;
})(window);
