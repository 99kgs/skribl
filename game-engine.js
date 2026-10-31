/**
 * Skribbl Game Engine — WebSocket relay (recommended) + MQTT fallback
 */

const MQTT_BROKERS = [
  "wss://broker.emqx.io:8084/mqtt",
  "wss://broker.hivemq.com:8884/mqtt",
  "wss://test.mosquitto.org:8081"
];

/** Подключи свой сервер из папки server/ (?server=https://твой-хост) */
function getGameServerUrl() {
  if (typeof window.SKRIBBL_SERVER_URL === "string" && window.SKRIBBL_SERVER_URL.trim()) {
    return window.SKRIBBL_SERVER_URL.trim();
  }
  const q = new URLSearchParams(window.location.search).get("server");
  return q ? q.trim() : "";
}

const ATLAS_COLS = 10;
const ATLAS_ROWS = [18, 31, 24]; // color, eyes, mouth

let myAvatar = [
  Math.floor(Math.random() * ATLAS_ROWS[0]),
  Math.floor(Math.random() * ATLAS_ROWS[1]),
  Math.floor(Math.random() * ATLAS_ROWS[2])
];

const myPlayerId = "p_" + Math.random().toString(36).substring(2, 9);
const myState = {
  id: myPlayerId,
  name: "Игрок",
  avatar: myAvatar,
  score: 0,
  hasGuessed: false
};

let mqttClient = null;
let gameSocket = null;
let useSocketRelay = false;
let mqttConnected = false;
let presenceAnnounced = false;
let currentRoomCode = "";
let roomTopic = "";

// Состояние игры (синхронизируется хостом)
let gameState = {
  players: {}, // id -> { id, name, avatar, score, hasGuessed, lastSeen }
  currentDrawerId: null,
  currentWord: "",
  round: 1,
  maxRounds: 3,
  timeLeft: 60,
  status: "WAITING" // 'WAITING', 'CHOOSING', 'DRAWING'
};

let roundTimerInterval = null;

// Холст
let canvas, ctx;
let isDrawing = false;
let currentColor = "#000000";
let currentBrushSize = 3;
let lastX = 0;
let lastY = 0;
let drawStrokeSeq = 0;
let pendingDrawPoints = [];
let drawFlushScheduled = false;
const processedPacketKeys = new Set();
let remoteBatchBuffer = new Map();
let nextRemoteBatchSeq = 0;
let canvasSnapshotTimer = null;
let lastSnapshotSentAt = 0;
let lastPlayerListSignature = "";
let pendingWordChoices = [];
let currentTool = "pen";
/** ПКМ: временное стирание без смены выбранного инструмента */
let isRightErase = false;
const undoStack = [];
const UNDO_MAX = 40;
let snapshotChunkBuffers = {};
let snapshotFrameCounter = 0;
let lastWordChoicesRequestAt = 0;

function packetDedupeKey(packet) {
  if (packet.nonce != null && packet.senderId) {
    return `${packet.senderId}:${packet.nonce}`;
  }
  return `${packet.senderId}:${packet.type}:${packet.timestamp || 0}`;
}

function shouldProcessPacket(packet) {
  const key = packetDedupeKey(packet);
  if (processedPacketKeys.has(key)) return false;
  processedPacketKeys.add(key);
  if (processedPacketKeys.size > 800) {
    const drop = [...processedPacketKeys].slice(0, 400);
    drop.forEach(k => processedPacketKeys.delete(k));
  }
  return true;
}

function bootApp() {
  canvas = document.getElementById("canvasGame");
  if (canvas) ctx = canvas.getContext("2d");

  initAvatarSprites();
  setupUIEvents();
  parseRoomCode();
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", bootApp);
} else {
  bootApp();
}

// -------------------------------------------------------------
// Аватары и спрайты
// -------------------------------------------------------------

function setSpriteStyle(element, index, size) {
  if (!element) return;
  const col = index % ATLAS_COLS;
  const row = Math.floor(index / ATLAS_COLS);
  element.style.backgroundPosition = `-${col * size}px -${row * size}px`;
  element.style.backgroundSize = `${size * ATLAS_COLS}px auto`;
}

function updateLoginAvatar() {
  const container = document.getElementById("loginAvatar");
  if (!container) return;
  const size = 96;

  setSpriteStyle(container.querySelector(".color"), myAvatar[0], size);
  setSpriteStyle(container.querySelector(".eyes"), myAvatar[1], size);
  setSpriteStyle(container.querySelector(".mouth"), myAvatar[2], size);
}

function initAvatarSprites() {
  updateLoginAvatar();

  document.querySelectorAll("#loginAvatarArrowsLeft .avatarArrowLeft").forEach(arrow => {
    arrow.addEventListener("click", () => {
      const idx = parseInt(arrow.dataset.avatarindex, 10);
      myAvatar[idx]--;
      if (myAvatar[idx] < 0) myAvatar[idx] = ATLAS_ROWS[idx] - 1;
      updateLoginAvatar();
    });
  });

  document.querySelectorAll("#loginAvatarArrowsRight .avatarArrowRight").forEach(arrow => {
    arrow.addEventListener("click", () => {
      const idx = parseInt(arrow.dataset.avatarindex, 10);
      myAvatar[idx]++;
      if (myAvatar[idx] >= ATLAS_ROWS[idx]) myAvatar[idx] = 0;
      updateLoginAvatar();
    });
  });
}

// -------------------------------------------------------------
// Логика комнат и URL
// -------------------------------------------------------------

function parseRoomCode() {
  const urlParams = new URLSearchParams(window.location.search);
  let room = urlParams.get("room");

  if (!room) {
    room = Math.random().toString(36).substring(2, 7);
    const qs = new URLSearchParams(window.location.search);
    qs.set("room", room.toLowerCase());
    window.history.replaceState({}, "", `${window.location.pathname}?${qs.toString()}`);
  }
  currentRoomCode = room.toLowerCase();
  roomTopic = "skribbl_verity_game/" + currentRoomCode;

  const fullLink = `${window.location.origin}${window.location.pathname}?room=${currentRoomCode}`;
  const inputLink = document.getElementById("headerInviteLink");
  if (inputLink) inputLink.value = fullLink;
}

function setupUIEvents() {
  const copyBtn = document.getElementById("btnCopyRoomLink") || document.getElementById("btnHeaderCopyLink");
  if (copyBtn) {
    copyBtn.addEventListener("click", () => {
      const input = document.getElementById("headerInviteLink") || document.getElementById("headerInviteLink");
      if (input) {
        input.select();
        navigator.clipboard.writeText(input.value).then(() => {
          copyBtn.textContent = "Скопировано!";
          setTimeout(() => copyBtn.textContent = "Скопировать", 2000);
        }).catch(() => {
          document.execCommand("copy");
          copyBtn.textContent = "Скопировано!";
          setTimeout(() => copyBtn.textContent = "Скопировать", 2000);
        });
      }
    });
  }

  const playBtn = document.getElementById("btnPlayGame");
  if (playBtn) {
    playBtn.onclick = (e) => {
      if (e) e.preventDefault();
      enterGameSession();
    };
  }

  const formLogin = document.getElementById("formLogin");
  if (formLogin) {
    formLogin.onsubmit = (e) => {
      if (e) e.preventDefault();
      enterGameSession();
      return false;
    };
  }

  const createPrivateBtn = document.getElementById("btnCreatePrivate");
  if (createPrivateBtn) {
    createPrivateBtn.addEventListener("click", () => {
      const newRoom = Math.random().toString(36).substring(2, 7);
      window.location.href = window.location.origin + window.location.pathname + '?room=' + newRoom;
    });
  }

  const formChat = document.getElementById("formChat");
  if (formChat) {
    formChat.addEventListener("submit", handleChatSubmit);
  }

  document.querySelectorAll(".colorItem").forEach(item => {
    item.addEventListener("click", () => {
      currentColor = item.dataset.color;
      setActiveTool("pen");
      const preview = document.getElementById("currentColorPreview");
      if (preview) preview.style.background = currentColor;
    });
  });

  document.querySelectorAll(".containerBrushSizes .brushSize").forEach(item => {
    item.addEventListener("click", () => {
      document.querySelectorAll(".containerBrushSizes .brushSize").forEach(b => {
        b.classList.remove("active", "brushSizeActive");
      });
      item.classList.add("active", "brushSizeActive");
      currentBrushSize = parseInt(item.dataset.size, 10);
      if (currentTool === "fill") setActiveTool("pen");
    });
  });

  document.querySelectorAll(".containerTools .tool[data-tool]").forEach(btn => {
    btn.addEventListener("click", () => {
      const tool = btn.dataset.tool;
      if (tool === "erase" || tool === "eraser") return;
      setActiveTool(tool === "eraser" ? "pen" : tool);
      if (tool === "pen") {
        const preview = document.getElementById("currentColorPreview");
        currentColor = (preview && preview.style.background) ? preview.style.background : "#000000";
      }
    });
  });

  const undoBtn = document.getElementById("buttonUndo");
  if (undoBtn) undoBtn.addEventListener("click", () => undoCanvas());

  const clearBtn = document.getElementById("buttonClearCanvas");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      if (gameState.currentDrawerId === myPlayerId && gameState.status === "DRAWING") {
        pushUndoSnapshot();
        clearCanvasLocal();
        broadcastPacket({ type: "CLEAR" });
        if (useSocketRelay && gameSocket && gameSocket.connected) {
          gameSocket.emit("clear");
        }
      }
    });
  }

  if (canvas) {
    canvas.addEventListener("mousedown", (e) => {
      if (e.button === 2) {
        e.preventDefault();
        if (gameState.currentDrawerId === myPlayerId && gameState.status === "DRAWING") {
          isRightErase = true;
        }
      }
      startDrawing(e);
    });
    canvas.addEventListener("mousemove", draw);
    window.addEventListener("mouseup", (e) => {
      if (e.button === 2) isRightErase = false;
      stopDrawing();
    });

    canvas.addEventListener("contextmenu", (e) => {
      e.preventDefault();
    });

    canvas.addEventListener("touchstart", handleTouchStart, { passive: false });
    canvas.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", stopDrawing);
  }
}

function enterGameSession() {
  const nameInput = document.getElementById("inputName") || document.getElementById("inputPlayerName");
  const chosenName = (nameInput && nameInput.value.trim()) ? nameInput.value.trim() : ("Игрок " + Math.floor(Math.random() * 900 + 100));

  myState.name = chosenName;
  myState.avatar = [...myAvatar];

  const screenLogin = document.getElementById("screenLogin");
  if (screenLogin) screenLogin.style.display = "none";

  const screenGame = document.getElementById("screenGame");
  if (screenGame) {
    screenGame.style.display = "block";
    screenGame.classList.add("screen-game-enter");
  }
  document.body.classList.add("game-active");

  gameState.players[myPlayerId] = {
    ...myState,
    lastSeen: Date.now()
  };
  updatePlayerList();
  updateGameHeader();

  initNetworkConnection();
  initGameSocket();
}

function announcePresence() {
  if (presenceAnnounced) return;
  if (!gameState.players[myPlayerId]) return;
  if (!useSocketRelay && !mqttConnected) return;
  presenceAnnounced = true;
  broadcastPacket({
    type: "PLAYER_JOIN",
    player: gameState.players[myPlayerId]
  });
  broadcastPacket({ type: "REQUEST_SYNC" });
}

function startMqttConnection(brokerIndex = 0) {
  if (brokerIndex >= MQTT_BROKERS.length) brokerIndex = 0;
  const brokerUrl = MQTT_BROKERS[brokerIndex];

  if (!window.mqtt) return;

  try {
    const clientId = "client_" + myPlayerId + "_" + Math.random().toString(16).substring(2, 8);
    mqttClient = mqtt.connect(brokerUrl, {
      clientId: clientId,
      clean: true,
      connectTimeout: 8000,
      reconnectPeriod: 3000
    });

    mqttClient.on("connect", () => {
      mqttConnected = true;
      console.log("MQTT connected:", brokerUrl);

      mqttClient.subscribe(roomTopic, { qos: 0 }, (err) => {
        if (!err) announcePresence();
      });
    });

    mqttClient.on("close", () => {
      mqttConnected = false;
      presenceAnnounced = false;
    });

    mqttClient.on("message", (topic, message) => {
      if (topic === roomTopic) {
        try {
          handleIncomingPacket(JSON.parse(message.toString()));
        } catch (e) {}
      }
    });

    mqttClient.on("error", () => {
      console.warn("MQTT error, try next broker");
    });
  } catch (err) {
    console.error("MQTT Init Error:", err);
  }
}

function initGameSocket() {
  const serverUrl = getGameServerUrl();
  if (!serverUrl || typeof io === "undefined") return;

  gameSocket = io(serverUrl, {
    transports: ["polling", "websocket"],
    reconnection: true,
    reconnectionAttempts: 12,
    timeout: 20000
  });

  gameSocket.on("connect", () => {
    useSocketRelay = true;
    stopCanvasSnapshotLoop();
    const me = gameState.players[myPlayerId];
    gameSocket.emit(
      "join",
      { room: currentRoomCode, playerId: myPlayerId, player: me },
      () => {
        announcePresence();
      }
    );
    console.log("WebSocket connected, room:", currentRoomCode);
  });

  gameSocket.on("connect_error", () => {
    useSocketRelay = false;
    console.warn("WebSocket connect_error, fallback to MQTT:", getGameServerUrl());
  });

  gameSocket.on("disconnect", () => {
    useSocketRelay = false;
    console.warn("WebSocket disconnected, using MQTT snapshots for draw sync");
  });

  gameSocket.on("relay", (packet) => {
    if (!packet || packet.senderId === myPlayerId) return;
    handleIncomingPacket(packet);
  });

  gameSocket.on("draw", (data) => {
    if (!data || data.senderId === myPlayerId) return;
    if (gameState.currentDrawerId === myPlayerId) return;
    applyNormalizedDrawSegment(data);
  });

  gameSocket.on("clear", () => {
    clearCanvasLocal();
    resetRemoteDrawSync();
  });
}

function initNetworkConnection() {
  if (getGameServerUrl()) {
    console.log("Connecting WebSocket + MQTT…");
  } else {
    console.log("Connecting MQTT…");
  }

  startMqttConnection();

  try {
    const localBus = new BroadcastChannel("skribbl_bc_" + currentRoomCode);
    localBus.onmessage = (e) => handleIncomingPacket(e.data);
  } catch (e) {}

  window.addEventListener("storage", (e) => {
    if (e.key === "skribbl_ls_" + currentRoomCode && e.newValue) {
      try {
        handleIncomingPacket(JSON.parse(e.newValue));
      } catch (err) {}
    }
  });

  setInterval(() => {
    if (gameState.players[myPlayerId]) {
      gameState.players[myPlayerId].lastSeen = Date.now();
      gameState.players[myPlayerId].score = gameState.players[myPlayerId].score || 0;
      gameState.players[myPlayerId].hasGuessed = !!gameState.players[myPlayerId].hasGuessed;
      broadcastPacket({
        type: "HEARTBEAT",
        player: gameState.players[myPlayerId]
      });
    }

    removeOfflinePlayers();
    checkGameProgress();
  }, 2000);
}

function broadcastPacket(packet) {
  packet.senderId = myPlayerId;
  packet.nonce = Math.random();
  packet.timestamp = Date.now();

  if (useSocketRelay && gameSocket && gameSocket.connected) {
    gameSocket.emit("relay", packet);
  }

  const qos = (packet.type === "DRAW_BATCH" || packet.type === "DRAW_STROKE" || packet.type === "CLEAR" || packet.type === "SNAP_PART") ? 1 : 0;
  if (mqttClient && mqttClient.connected) {
    try {
      mqttClient.publish(roomTopic, JSON.stringify(packet), { qos });
    } catch (e) {}
  }

  try {
    const localBus = new BroadcastChannel("skribbl_bc_" + currentRoomCode);
    localBus.postMessage(packet);
  } catch (e) {}

  if (packet.type !== "DRAW_BATCH" && packet.type !== "DRAW_STROKE" && packet.type !== "SNAP_PART") {
    try {
      localStorage.setItem("skribbl_ls_" + currentRoomCode, JSON.stringify(packet));
    } catch (e) {}
  }
}

function emitDrawSegment(prevX, prevY, currX, currY, color, size) {
  if (!canvas) return;
  const payload = {
    senderId: myPlayerId,
    x1: prevX / canvas.width,
    y1: prevY / canvas.height,
    x2: currX / canvas.width,
    y2: currY / canvas.height,
    color,
    size
  };
  if (useSocketRelay && gameSocket && gameSocket.connected) {
    gameSocket.emit("draw", payload);
  }
}

function applyNormalizedDrawSegment(data) {
  if (!ctx || !canvas) return;
  drawStrokeLocal(
    data.x1 * canvas.width,
    data.y1 * canvas.height,
    data.x2 * canvas.width,
    data.y2 * canvas.height,
    data.color,
    data.size
  );
}

function handleIncomingPacket(packet) {
  if (!packet || packet.senderId === myPlayerId) return;
  if (!shouldProcessPacket(packet)) return;

  switch (packet.type) {
    case "PLAYER_JOIN":
    case "HEARTBEAT": {
      const p = packet.player;
      if (!p) break;
      const isNew = !gameState.players[p.id];

      const prev = gameState.players[p.id];
      const merged = {
        ...p,
        lastSeen: Date.now()
      };
      if (prev) {
        merged.score = Math.max(prev.score || 0, p.score || 0);
        merged.hasGuessed = !!(prev.hasGuessed || p.hasGuessed);
      }
      gameState.players[p.id] = merged;

      if (isNew && packet.type === "PLAYER_JOIN") {
        addChatMessage("Сеть", `${p.name} присоединился к игре!`, "system");
      }
      if (isNew || (prev && (prev.score !== merged.score || prev.hasGuessed !== merged.hasGuessed))) {
        lastPlayerListSignature = "";
      }
      updatePlayerList();
      updateGameHeader();
      if (isNew && isRoomLeader()) {
        syncStateToAll();
      }
      break;
    }

    case "PLAYER_LEAVE": {
      if (packet.playerId && gameState.players[packet.playerId]) {
        addChatMessage("Сеть", `${gameState.players[packet.playerId].name} вышел.`, "system");
        delete gameState.players[packet.playerId];
        lastPlayerListSignature = "";
        updatePlayerList();
        updateGameHeader();
        if (isRoomLeader()) syncStateToAll();
      }
      break;
    }

    case "REQUEST_SYNC": {
      if (isRoomLeader()) {
        syncStateToAll();
      }
      break;
    }

    case "SYNC_STATE": {
      const statePlayers = packet.state?.players || {};
      const stateLeaderId = getStateLeaderId(statePlayers);
      if (!stateLeaderId || packet.senderId !== stateLeaderId) break;
      if (isRoomLeader() && myPlayerId === stateLeaderId) break;

      gameState.currentDrawerId = packet.state.currentDrawerId;
      gameState.currentWord = packet.state.currentWord;
      gameState.round = packet.state.round;
      gameState.maxRounds = packet.state.maxRounds;
      gameState.timeLeft = packet.state.timeLeft;
      gameState.status = packet.state.status;
      if (packet.state.wordChoices && packet.state.wordChoices.length) {
        pendingWordChoices = packet.state.wordChoices.slice();
      }

      Object.keys(statePlayers).forEach(id => {
        if (id === myPlayerId) {
          const remoteMe = statePlayers[id];
          if (remoteMe && gameState.players[myPlayerId]) {
            gameState.players[myPlayerId].score = remoteMe.score;
            gameState.players[myPlayerId].hasGuessed = remoteMe.hasGuessed;
          }
        } else {
          gameState.players[id] = statePlayers[id];
        }
      });

      lastPlayerListSignature = "";
      updatePlayerList();
      updateGameHeader();
      if (packet.state.status === "DRAWING") {
        hideWordChoices();
      } else if (packet.state.status === "CHOOSING" && gameState.currentDrawerId === myPlayerId && pendingWordChoices.length) {
        showWordChoices(pendingWordChoices);
      }
      break;
    }

    case "CANVAS_SNAPSHOT": {
      if (gameState.currentDrawerId === myPlayerId) break;
      applyCanvasSnapshot(packet.data);
      break;
    }

    case "SNAP_PART": {
      if (gameState.currentDrawerId === myPlayerId) break;
      if (packet.senderId !== gameState.currentDrawerId) break;
      reassembleSnapshotPart(packet);
      break;
    }

    case "SYNC_TIMER": {
      if (!isRoomLeader()) {
        const leaderId = getPlayersList().sort((a, b) => a.id.localeCompare(b.id))[0]?.id;
        if (packet.senderId === leaderId) {
          gameState.timeLeft = packet.timeLeft;
          updateTimerDisplay();
        }
      }
      break;
    }

    case "DRAW_STROKE": {
      applyRemoteStroke(packet.prevX, packet.prevY, packet.currX, packet.currY, packet.color, packet.size);
      break;
    }

    case "DRAW_BATCH": {
      enqueueRemoteDrawBatch(packet);
      break;
    }

    case "CLEAR": {
      clearCanvasLocal();
      resetRemoteDrawSync();
      break;
    }

    case "WORD_SELECT_PROMPT": {
      if (myPlayerId !== packet.drawerId) {
        hideWordChoices();
      }
      break;
    }

    case "WORD_CHOICES": {
      if (packet.targetId === myPlayerId) {
        pendingWordChoices = packet.choices || [];
        showWordChoices(pendingWordChoices);
      } else {
        hideWordChoices();
      }
      break;
    }

    case "REQUEST_WORD_CHOICES": {
      if (isRoomLeader() && pendingWordChoices.length) {
        broadcastPacket({
          type: "WORD_CHOICES",
          targetId: packet.requesterId || gameState.currentDrawerId,
          choices: pendingWordChoices
        });
      }
      break;
    }

    case "WORD_CHOSEN": {
      if (isRoomLeader()) {
        startDrawingRound(packet.word);
      }
      break;
    }

    case "CHAT": {
      if (isRoomLeader()) {
        processIncomingGuess(packet.senderId, packet.text);
      }
      break;
    }

    case "CHAT_BROADCAST": {
      addChatMessage(packet.senderName, packet.text, packet.messageType || "normal", packet.audience);
      break;
    }

    case "GUESS_RESULT": {
      if (packet.targetId === myPlayerId && gameState.players[myPlayerId]) {
        gameState.players[myPlayerId].score = packet.score;
        gameState.players[myPlayerId].hasGuessed = true;
        lastPlayerListSignature = "";
        updatePlayerList();
        updateGameHeader();
      }
      break;
    }
  }
}

const MIN_PLAYERS_TO_START = 2;

function getStateLeaderId(playersObj) {
  const ids = Object.keys(playersObj || {});
  if (!ids.length) return null;
  return ids.sort((a, b) => a.localeCompare(b))[0];
}

function removeOfflinePlayers() {
  const now = Date.now();
  let changed = false;

  Object.keys(gameState.players).forEach(id => {
    if (id !== myPlayerId && (now - gameState.players[id].lastSeen > 6000)) {
      addChatMessage("Сеть", `${gameState.players[id].name} покинул игру.`, "system");
      delete gameState.players[id];
      changed = true;
    }
  });

  if (changed) {
    updatePlayerList();
    updateGameHeader();
    if (isRoomLeader()) syncStateToAll();
  }
}

function getPlayersList() {
  return Object.values(gameState.players);
}

function isRoomLeader() {
  const list = getPlayersList().sort((a,b) => a.id.localeCompare(b.id));
  return list.length > 0 && list[0].id === myPlayerId;
}

function checkGameProgress() {
  if (!isRoomLeader()) return;
  if (!mqttConnected && !useSocketRelay) return;

  const players = getPlayersList();
  if (players.length < MIN_PLAYERS_TO_START) {
    if (gameState.status === "WAITING") {
      const wordTextEl = document.getElementById("currentWordText");
      const wordLabelEl = document.getElementById("wordHintLabel");
      if (wordLabelEl) wordLabelEl.textContent = "Комната";
      if (wordTextEl) {
        wordTextEl.textContent = `Ждём игроков (${players.length}/${MIN_PLAYERS_TO_START})`;
      }
    }
    return;
  }

  if (gameState.status === "WAITING") {
    startNextTurn();
  }
}

function startNextTurn() {
  const players = getPlayersList();
  if (players.length === 0) return;

  // Сброс статуса угадывания
  players.forEach(p => p.hasGuessed = false);
  clearGuessedChatMessages();

  // Выбор следующего рисующего
  let currentIndex = players.findIndex(p => p.id === gameState.currentDrawerId);
  let nextIndex = (currentIndex + 1) % players.length;
  gameState.currentDrawerId = players[nextIndex].id;

  // Случайные слова
  const choices = [];
  const wordsList = (typeof RUSSIAN_WORDS !== "undefined" && RUSSIAN_WORDS.length) ? RUSSIAN_WORDS : ["кот", "дом", "солнце", "дерево", "машина"];
  while (choices.length < 3) {
    const randomWord = wordsList[Math.floor(Math.random() * wordsList.length)].toLowerCase();
    if (!choices.includes(randomWord)) choices.push(randomWord);
  }

  pendingWordChoices = choices.slice();

  gameState.status = "CHOOSING";
  gameState.currentWord = "";
  gameState.timeLeft = 15;
  drawStrokeSeq = 0;
  stopCanvasSnapshotLoop();

  clearCanvasLocal();
  resetRemoteDrawSync();
  broadcastPacket({ type: "CLEAR" });

  if (gameState.currentDrawerId === myPlayerId) {
    showWordChoices(choices);
  } else {
    hideWordChoices();
  }

  broadcastPacket({
    type: "WORD_SELECT_PROMPT",
    drawerId: gameState.currentDrawerId
  });

  broadcastPacket({
    type: "WORD_CHOICES",
    targetId: gameState.currentDrawerId,
    choices: pendingWordChoices
  });

  const drawerName = gameState.players[gameState.currentDrawerId]?.name || "Игрок";
  broadcastChatMessage("Игра", `${drawerName} выбирает слово...`, "system");

  syncStateToAll();

  clearInterval(roundTimerInterval);
  roundTimerInterval = setInterval(() => {
    gameState.timeLeft--;
    if (gameState.timeLeft <= 0) {
      clearInterval(roundTimerInterval);
      if (gameState.status === "CHOOSING") {
        startDrawingRound(choices[0]);
      }
    } else {
      broadcastTimerOnly();
    }
  }, 1000);
}

function startDrawingRound(word) {
  clearInterval(roundTimerInterval);
  hideWordChoices();
  pendingWordChoices = [];
  gameState.status = "DRAWING";
  gameState.currentWord = word.toLowerCase();
  gameState.timeLeft = 60;

  const wLen = gameState.currentWord.length;
  broadcastChatMessage("Игра", `Раунд начался! Слово из ${wLen} ${letterWord(wLen)} — рисуй и угадывай.`, "system");
  syncStateToAll();
  pulseWordBanner();
  startCanvasSnapshotLoop();

  roundTimerInterval = setInterval(() => {
    gameState.timeLeft--;

    if (gameState.timeLeft <= 0) {
      clearInterval(roundTimerInterval);
      stopCanvasSnapshotLoop();
      endTurnTimeUp();
    } else {
      broadcastTimerOnly();
    }
  }, 1000);
}

function levenshteinDistance(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1];
      else dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function processIncomingGuess(playerId, rawText) {
  const text = rawText.trim().toLowerCase();
  const player = gameState.players[playerId];
  if (!player) return;

  if (playerId === gameState.currentDrawerId) {
    if (gameState.status === "DRAWING" && gameState.currentWord) {
      if (text === gameState.currentWord || levenshteinDistance(text, gameState.currentWord) <= 1) {
        addChatMessage("Игра", "Рисующий не может писать загаданное слово в чат.", "system");
        return;
      }
    }
    broadcastChatMessage(player.name, rawText, "normal");
    return;
  }

  if (player.hasGuessed) {
    broadcastGuessedChatMessage(player.name, rawText);
    return;
  }

  if (gameState.status === "DRAWING" && gameState.currentWord) {
    if (text === gameState.currentWord) {
      player.hasGuessed = true;
      const earned = Math.max(50, gameState.timeLeft * 10);
      player.score = (player.score || 0) + earned;

      // Очки рисующему
      const drawer = gameState.players[gameState.currentDrawerId];
      if (drawer) {
        drawer.score = (drawer.score || 0) + 25;
      }

      broadcastChatMessage("Игра", `${player.name} угадал слово (+${earned} очков)!`, "correct");
      updateChatInputPlaceholder();

      broadcastPacket({
        type: "GUESS_RESULT",
        targetId: playerId,
        score: player.score,
        earned
      });

      const guessers = getPlayersList().filter(p => p.id !== gameState.currentDrawerId);
      const allGuessed = guessers.length > 0 && guessers.every(p => p.hasGuessed);

      if (allGuessed) {
        clearInterval(roundTimerInterval);
        endTurnTimeUp();
      } else {
        syncStateToAll();
      }
      return;
    }

    if (levenshteinDistance(text, gameState.currentWord) === 1) {
      broadcastChatMessage("Подсказка", `"${rawText}" очень близко!`, "close");
      return;
    }
  }

  broadcastChatMessage(player.name, rawText, "normal");
}

function endTurnTimeUp() {
  stopCanvasSnapshotLoop();
  broadcastChatMessage("Игра", `Раунд окончен! Загаданное слово было: "${gameState.currentWord.toUpperCase()}".`, "system");
  setTimeout(() => {
    startNextTurn();
  }, 3500);
}

function broadcastChatMessage(senderName, text, messageType) {
  addChatMessage(senderName, text, messageType, "all");
  broadcastPacket({
    type: "CHAT_BROADCAST",
    senderName: senderName,
    text: text,
    messageType: messageType,
    audience: "all"
  });
}

function broadcastGuessedChatMessage(senderName, text) {
  addChatMessage(senderName, text, "guessed", "guessed");
  broadcastPacket({
    type: "CHAT_BROADCAST",
    senderName: senderName,
    text: text,
    messageType: "guessed",
    audience: "guessed"
  });
}

function syncStateToAll() {
  updatePlayerList();
  updateGameHeader();
  broadcastPacket({
    type: "SYNC_STATE",
    state: {
      players: gameState.players,
      currentDrawerId: gameState.currentDrawerId,
      currentWord: gameState.currentWord,
      round: gameState.round,
      maxRounds: gameState.maxRounds,
      timeLeft: gameState.timeLeft,
      status: gameState.status,
      wordChoices: gameState.status === "CHOOSING" ? pendingWordChoices : []
    }
  });
}

function broadcastTimerOnly() {
  updateTimerDisplay();
  broadcastPacket({
    type: "SYNC_TIMER",
    timeLeft: gameState.timeLeft
  });
}

// -------------------------------------------------------------
// Рисование на холсте
// -------------------------------------------------------------

function getCoords(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY
  };
}

function setActiveTool(tool) {
  if (tool === "eraser" || tool === "erase") tool = "pen";
  if (tool === "fillall") tool = "fill";
  currentTool = tool;
  document.querySelectorAll(".containerTools .tool[data-tool]").forEach(el => {
    if (el.dataset.tool === "erase" || el.dataset.tool === "eraser") return;
    el.classList.toggle("toolActive", el.dataset.tool === tool);
  });
}

function isFreehandDrawMode() {
  if (isRightErase) return true;
  return currentTool === "pen" || currentTool === "eraser";
}

function strokeColorForDraw() {
  return isRightErase ? "#ffffff" : currentColor;
}

function pushUndoSnapshot() {
  if (!ctx || !canvas) return;
  try {
    undoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    if (undoStack.length > UNDO_MAX) undoStack.shift();
  } catch (e) {}
}

function broadcastCanvasAfterEdit() {
  if (gameState.currentDrawerId !== myPlayerId || !canvas) return;
  try {
    broadcastSnapshotParts(canvas.toDataURL("image/jpeg", 0.36));
  } catch (e) {}
}

function undoCanvas() {
  if (gameState.currentDrawerId !== myPlayerId || gameState.status !== "DRAWING") return;
  if (!undoStack.length) return;
  const data = undoStack.pop();
  ctx.putImageData(data, 0, 0);
  broadcastCanvasAfterEdit();
}

function fillEntireCanvas(color) {
  if (!ctx || !canvas) return;
  pushUndoSnapshot();
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  broadcastCanvasAfterEdit();
}

function parseColorToRgba(cssColor) {
  const probe = document.createElement("canvas").getContext("2d");
  if (!probe) return [0, 0, 0, 255];
  probe.fillStyle = "#000";
  probe.fillStyle = cssColor;
  const parsed = probe.fillStyle;
  if (parsed.startsWith("#")) {
    const hex = parsed.length === 4
      ? parsed.slice(1).split("").map(c => c + c).join("")
      : parsed.slice(1);
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
      255
    ];
  }
  const m = parsed.match(/rgba?\(([^)]+)\)/);
  if (!m) return [0, 0, 0, 255];
  const p = m[1].split(",").map(v => parseFloat(v.trim()));
  return [p[0], p[1], p[2], p[3] !== undefined ? Math.round(p[3] * 255) : 255];
}

function floodFillAt(x, y, fillCss) {
  if (!ctx || !canvas) return;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  if (ix < 0 || iy < 0 || ix >= canvas.width || iy >= canvas.height) return;

  pushUndoSnapshot();
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = img.data;
  const w = canvas.width;
  const h = canvas.height;
  const startIdx = (iy * w + ix) * 4;
  const target = [data[startIdx], data[startIdx + 1], data[startIdx + 2], data[startIdx + 3]];
  const fill = parseColorToRgba(fillCss);

  if (target[0] === fill[0] && target[1] === fill[1] && target[2] === fill[2] && target[3] === fill[3]) {
    undoStack.pop();
    return;
  }

  const stack = [[ix, iy]];
  const match = (idx) =>
    data[idx] === target[0] && data[idx + 1] === target[1] &&
    data[idx + 2] === target[2] && data[idx + 3] === target[3];

  while (stack.length) {
    const [cx, cy] = stack.pop();
    const idx = (cy * w + cx) * 4;
    if (!match(idx)) continue;
    data[idx] = fill[0];
    data[idx + 1] = fill[1];
    data[idx + 2] = fill[2];
    data[idx + 3] = fill[3];
    if (cx > 0) stack.push([cx - 1, cy]);
    if (cx < w - 1) stack.push([cx + 1, cy]);
    if (cy > 0) stack.push([cx, cy - 1]);
    if (cy < h - 1) stack.push([cx, cy + 1]);
  }

  ctx.putImageData(img, 0, 0);
  broadcastCanvasAfterEdit();
}

function startDrawing(e) {
  if (gameState.currentDrawerId !== myPlayerId || gameState.status !== "DRAWING") return;

  if (currentTool === "fill" && !isRightErase) {
    const coords = getCoords(e);
    floodFillAt(coords.x, coords.y, currentColor);
    return;
  }

  if (!isFreehandDrawMode()) return;

  isDrawing = true;
  pushUndoSnapshot();
  const coords = getCoords(e);
  lastX = coords.x;
  lastY = coords.y;
}

function draw(e) {
  if (!isDrawing || gameState.currentDrawerId !== myPlayerId || gameState.status !== "DRAWING") return;
  if (!isFreehandDrawMode()) return;
  const coords = getCoords(e);
  const color = strokeColorForDraw();

  drawStrokeLocal(lastX, lastY, coords.x, coords.y, color, currentBrushSize);
  emitDrawSegment(lastX, lastY, coords.x, coords.y, color, currentBrushSize);
  if (!useSocketRelay) {
    queueDrawBroadcast(lastX, lastY, coords.x, coords.y, color, currentBrushSize);
  }

  lastX = coords.x;
  lastY = coords.y;
}

function queueDrawBroadcast(prevX, prevY, currX, currY, color, size) {
  pendingDrawPoints.push({ prevX, prevY, currX, currY, color, size });
  if (drawFlushScheduled) return;
  drawFlushScheduled = true;
  requestAnimationFrame(flushDrawBroadcast);
}

function flushDrawBroadcast() {
  drawFlushScheduled = false;
  if (pendingDrawPoints.length === 0) return;
  const points = pendingDrawPoints;
  pendingDrawPoints = [];
  const chunkSize = 20;
  for (let i = 0; i < points.length; i += chunkSize) {
    const chunk = points.slice(i, i + chunkSize);
    broadcastPacket({
      type: "DRAW_BATCH",
      seq: drawStrokeSeq++,
      points: chunk
    });
  }
}

function resetRemoteDrawSync() {
  remoteBatchBuffer = new Map();
  nextRemoteBatchSeq = 0;
}

function enqueueRemoteDrawBatch() {
  /* Зрители на MQTT получают только SNAP_PART, не векторные штрихи */
}

function reassembleSnapshotPart(packet) {
  const frameId = packet.frameId;
  if (!snapshotChunkBuffers[frameId]) {
    snapshotChunkBuffers[frameId] = { total: packet.total, parts: [], count: 0 };
  }
  const buf = snapshotChunkBuffers[frameId];
  if (buf.parts[packet.index]) return;
  buf.parts[packet.index] = packet.data;
  buf.count++;
  if (buf.count < packet.total) return;

  const full = buf.parts.join("");
  delete snapshotChunkBuffers[frameId];
  applyCanvasSnapshot(full);

  const keys = Object.keys(snapshotChunkBuffers);
  if (keys.length > 3) {
    keys.slice(0, keys.length - 2).forEach(k => delete snapshotChunkBuffers[k]);
  }
}

function broadcastSnapshotParts(dataUrl) {
  const frameId = ++snapshotFrameCounter;
  const chunkSize = 5000;
  const total = Math.ceil(dataUrl.length / chunkSize);
  for (let i = 0; i < total; i++) {
    broadcastPacket({
      type: "SNAP_PART",
      frameId,
      index: i,
      total,
      data: dataUrl.slice(i * chunkSize, (i + 1) * chunkSize)
    });
  }
}

function startCanvasSnapshotLoop() {
  stopCanvasSnapshotLoop();
  if (useSocketRelay) return;
  canvasSnapshotTimer = setInterval(() => {
    if (gameState.currentDrawerId !== myPlayerId || gameState.status !== "DRAWING" || !canvas) return;
    const now = Date.now();
    if (now - lastSnapshotSentAt < 100) return;
    lastSnapshotSentAt = now;
    let data;
    try {
      data = canvas.toDataURL("image/jpeg", 0.36);
    } catch (e) {
      return;
    }
    broadcastSnapshotParts(data);
  }, 120);
}

function stopCanvasSnapshotLoop() {
  if (canvasSnapshotTimer) {
    clearInterval(canvasSnapshotTimer);
    canvasSnapshotTimer = null;
  }
}

function applyCanvasSnapshot(dataUrl) {
  if (!ctx || !dataUrl || gameState.currentDrawerId === myPlayerId) return;
  const img = new Image();
  img.onload = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  };
  img.src = dataUrl;
}

function applyRemoteStroke(prevX, prevY, currX, currY, color, size) {
  if (!ctx) return;
  drawStrokeLocal(prevX, prevY, currX, currY, color, size);
}

function stopDrawing() {
  if (isDrawing && pendingDrawPoints.length) {
    flushDrawBroadcast();
  }
  isDrawing = false;
}

function handleTouchStart(e) {
  if (e.touches.length === 1) {
    e.preventDefault();
    const touch = e.touches[0];
    startDrawing(touch);
  }
}

function handleTouchMove(e) {
  if (e.touches.length === 1) {
    e.preventDefault();
    const touch = e.touches[0];
    draw(touch);
  }
}

function drawStrokeLocal(x1, y1, x2, y2, color, size) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = color;
  ctx.lineWidth = size;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.closePath();
}

function clearCanvasLocal() {
  if (!ctx || !canvas) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  undoStack.length = 0;
  if (gameState.currentDrawerId !== myPlayerId) {
    resetRemoteDrawSync();
  }
}

// -------------------------------------------------------------
// Рендеринг интерфейса (UI)
// -------------------------------------------------------------

function getPlayerListSignature() {
  return getPlayersList()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(p => `${p.id}:${p.score || 0}:${p.hasGuessed ? 1 : 0}:${p.id === gameState.currentDrawerId ? 1 : 0}`)
    .join("|");
}

function updatePlayerList() {
  const playerList = document.getElementById("containerGamePlayers");
  if (!playerList) return;

  const signature = getPlayerListSignature();
  if (signature === lastPlayerListSignature) return;
  lastPlayerListSignature = signature;

  const existingIds = new Set();
  playerList.querySelectorAll(".player[data-player-id]").forEach(el => existingIds.add(el.dataset.playerId));

  const list = getPlayersList();
  const nextIds = new Set(list.map(p => p.id));

  list.forEach(p => {
    let card = playerList.querySelector(`.player[data-player-id="${p.id}"]`);
    if (!card) {
      card = document.createElement("div");
      card.className = "player";
      card.dataset.playerId = p.id;

      const avHolder = document.createElement("div");
      avHolder.className = "player-avatar-holder";
      avHolder.innerHTML = '<div class="color"></div><div class="eyes"></div><div class="mouth"></div>';
      card.appendChild(avHolder);

      const info = document.createElement("div");
      info.className = "player-info";
      info.style.cssText = "margin-left: 8px; flex: 1; line-height: 1.2;";
      info.innerHTML = '<div class="player-name" style="font-weight: bold; font-size: 13px;"></div><div class="player-score" style="font-size: 12px; color: #5cb85c; font-weight: bold;"></div>';
      card.appendChild(info);
      playerList.appendChild(card);
    }

    card.style.cssText = `
      display: flex !important;
      align-items: center !important;
      padding: 6px 8px !important;
      background: ${p.hasGuessed ? "#dff0d8" : (p.id === gameState.currentDrawerId ? "#d9edf7" : "#f5f5f5")};
      border-left: 4px solid ${p.hasGuessed ? "#3c763d" : "#337ab7"};
      border-radius: 4px;
    `;

    setSpriteStyle(card.querySelector(".color"), (p.avatar ? p.avatar[0] : 0), 48);
    setSpriteStyle(card.querySelector(".eyes"), (p.avatar ? p.avatar[1] : 0), 48);
    setSpriteStyle(card.querySelector(".mouth"), (p.avatar ? p.avatar[2] : 0), 48);

    card.querySelector(".player-name").innerHTML = `${escapeHtml(p.name)} ${p.id === gameState.currentDrawerId ? "✏️" : ""}`;
    card.querySelector(".player-score").textContent = `${p.score || 0} очков`;
  });

  existingIds.forEach(id => {
    if (!nextIds.has(id)) {
      const el = playerList.querySelector(`.player[data-player-id="${id}"]`);
      if (el) el.remove();
    }
  });
}

function updateTimerDisplay() {
  const timerEl = document.getElementById("timer");
  if (!timerEl) return;
  timerEl.textContent = gameState.timeLeft;
  timerEl.classList.toggle("timer-urgent", gameState.status === "DRAWING" && gameState.timeLeft <= 10);
}

function updateGameHeader() {
  updateTimerDisplay();
  const roundEl = document.getElementById("round");
  if (roundEl) roundEl.textContent = `Раунд ${gameState.round} из ${gameState.maxRounds}`;

  const wordRoot = document.getElementById("currentWord");
  const wordTextEl = document.getElementById("currentWordText");
  const wordLabelEl = document.getElementById("wordHintLabel");
  if (!wordRoot && !wordTextEl) return;
  const isDrawer = (gameState.currentDrawerId === myPlayerId);

  const setBanner = (label, text, modeClass) => {
    if (wordLabelEl) wordLabelEl.textContent = label;
    if (wordTextEl) wordTextEl.textContent = text;
    else if (wordRoot) wordRoot.textContent = text;
    if (wordRoot) {
      wordRoot.classList.remove("word-drawer-mode", "word-hint-mode");
      if (modeClass) wordRoot.classList.add(modeClass);
    }
  };

  if (gameState.status === "DRAWING") {
    hideWordChoices();
    const len = gameState.currentWord ? gameState.currentWord.length : 0;
    if (isDrawer) {
      setBanner("Нарисуй", (gameState.currentWord || "").toUpperCase(), "word-drawer-mode");
    } else if (len > 0) {
      setBanner("Угадай", gameState.currentWord.split("").map(() => "_").join(" "), "word-hint-mode");
    } else {
      setBanner("Угадай", "_ _ _ _", "word-hint-mode");
    }
  } else if (gameState.status === "CHOOSING") {
    setBanner("Раунд", "ВЫБОР СЛОВА…", null);
    if (isDrawer && pendingWordChoices.length) {
      showWordChoices(pendingWordChoices);
    }
  } else {
    setBanner("Ожидание", "…", null);
  }

  const toolbar = document.getElementById("drawingToolbar");
  if (toolbar) {
    const showBar = isDrawer && gameState.status === "DRAWING";
    toolbar.style.display = showBar ? "flex" : "none";
  }

  if (gameState.status === "CHOOSING" && gameState.currentDrawerId === myPlayerId && !pendingWordChoices.length) {
    const now = Date.now();
    if (now - lastWordChoicesRequestAt > 2500) {
      lastWordChoicesRequestAt = now;
      broadcastPacket({ type: "REQUEST_WORD_CHOICES", requesterId: myPlayerId });
    }
  }

  updateChatInputPlaceholder();
  updateGuessedChatPanelVisibility();

  if (gameState.currentDrawerId !== myPlayerId) {
    hideWordChoices();
  }
}

function updateUI() {
  updatePlayerList();
  updateGameHeader();
}

function showWordChoices(words) {
  if (gameState.currentDrawerId !== myPlayerId) {
    hideWordChoices();
    return;
  }
  const modal = document.getElementById("word-select-modal");
  const cont = document.getElementById("word-select-options");
  cont.innerHTML = "";

  words.forEach(w => {
    const btn = document.createElement("button");
    btn.className = "word-btn-opt";
    btn.textContent = w;
    btn.onclick = () => {
      hideWordChoices();
      if (isRoomLeader()) {
        startDrawingRound(w);
      } else {
        broadcastPacket({
          type: "WORD_CHOSEN",
          word: w
        });
      }
    };
    cont.appendChild(btn);
  });

  modal.classList.remove("hidden");
}

function hideWordChoices() {
  document.getElementById("word-select-modal").classList.add("hidden");
}

function handleChatSubmit(e) {
  if (e) e.preventDefault();
  const input = document.getElementById("inputChat");
  const text = input.value.trim();
  if (!text) return;

  if (isRoomLeader()) {
    processIncomingGuess(myPlayerId, text);
  } else {
    broadcastPacket({
      type: "CHAT",
      text: text
    });
  }

  input.value = "";
}

function letterWord(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return "букв";
  if (mod10 === 1) return "буква";
  if (mod10 >= 2 && mod10 <= 4) return "буквы";
  return "букв";
}

function pulseWordBanner() {
  const wordDisplay = document.getElementById("currentWord");
  const board = document.getElementById("containerBoard");
  if (!wordDisplay) return;
  wordDisplay.classList.remove("word-pulse");
  void wordDisplay.offsetWidth;
  wordDisplay.classList.add("word-pulse");
  if (board) {
    board.classList.remove("round-live");
    void board.offsetWidth;
    board.classList.add("round-live");
  }
}

function clearGuessedChatMessages() {
  const box = document.getElementById("boxGuessedMessages");
  if (box) box.innerHTML = "";
}

function canSeeGuessedChat() {
  const me = gameState.players[myPlayerId];
  if (!me) return false;
  return me.hasGuessed || gameState.currentDrawerId === myPlayerId;
}

function updateGuessedChatPanelVisibility() {
  const panel = document.getElementById("boxGuessedChat");
  if (!panel) return;
  const show = canSeeGuessedChat() && gameState.status === "DRAWING";
  panel.classList.toggle("hidden", !show);
}

function updateChatInputPlaceholder() {
  const input = document.getElementById("inputChat");
  if (!input) return;
  const me = gameState.players[myPlayerId];
  if (!me) return;
  if (gameState.currentDrawerId === myPlayerId) {
    input.placeholder = "Сообщение в чат (не пиши загаданное слово)...";
  } else if (me.hasGuessed) {
    input.placeholder = "Чат для угадавших...";
  } else {
    input.placeholder = "Введите догадку...";
  }
}

function addChatMessage(sender, text, type = "normal", audience = "all") {
  if (audience === "guessed" || type === "guessed") {
    if (!canSeeGuessedChat()) return;
    const guessedBox = document.getElementById("boxGuessedMessages");
    if (!guessedBox) return;
    appendChatRow(guessedBox, sender, text, type);
    return;
  }
  const box = document.getElementById("boxMessages");
  if (!box) return;
  appendChatRow(box, sender, text, type);
}

function appendChatRow(box, sender, text, type) {
  const row = document.createElement("div");
  row.className = `chat-row ${type} chat-row-enter`;

  if (type === "system") {
    row.textContent = text;
  } else if (type === "correct" || type === "close") {
    row.textContent = `${sender}: ${text}`;
  } else if (type === "guessed") {
    row.innerHTML = `<strong>${escapeHtml(sender)}:</strong> ${escapeHtml(text)}`;
  } else {
    row.innerHTML = `<strong>${escapeHtml(sender)}:</strong> ${escapeHtml(text)}`;
  }

  box.appendChild(row);
  while (box.children.length > 120) {
    box.removeChild(box.firstChild);
  }
  box.scrollTop = box.scrollHeight;
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, m => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[m]);
}
