/** Skribbl-style SFX (files in /sounds/) */
const GAME_SOUND_FILES = {
  join: "Join.ogg",
  leave: "Leave.ogg",
  roundStart: "Roundstart.ogg",
  roundSuccess: "Roundendsuccess.ogg",
  roundFailure: "Roundendfailure.ogg",
  guessed: "Playerguessed.ogg",
  tick: "Tick.ogg"
};

const gameSoundCache = {};
let gameSoundsUnlocked = false;

function unlockGameSounds() {
  gameSoundsUnlocked = true;
}

function playGameSound(id, volume = 0.55) {
  if (!gameSoundsUnlocked) return;
  const file = GAME_SOUND_FILES[id];
  if (!file) return;
  try {
    if (!gameSoundCache[id]) {
      gameSoundCache[id] = new Audio("sounds/" + file);
    }
    const base = gameSoundCache[id];
    const clip = base.cloneNode();
    clip.volume = volume;
    clip.play().catch(() => {});
  } catch (e) {}
}

document.addEventListener(
  "click",
  () => {
    unlockGameSounds();
  },
  { once: true, capture: true }
);
