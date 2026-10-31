with open(r'C:\Users\User\Desktop\skribbl-game\game-engine.js', 'r', encoding='utf-8') as f:
    text = f.read()

# Replace inputHeaderRoomLink with headerInviteLink
new_text = text.replace('inputHeaderRoomLink', 'headerInviteLink')

# Let's ensure window load listener handles both DOMContentLoaded and immediate execution if already loaded
old_start = '''window.addEventListener("DOMContentLoaded", () => {
  canvas = document.getElementById("canvasGame");
  ctx = canvas.getContext("2d");

  initAvatarSprites();
  setupUIEvents();
  parseRoomCode();
});'''

new_start = '''function bootApp() {
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
}'''

new_text = new_text.replace(old_start, new_start)

with open(r'C:\Users\User\Desktop\skribbl-game\game-engine.js', 'w', encoding='utf-8') as f:
    f.write(new_text)
print("GAME-ENGINE.JS BOOTSTRAP UPDATED!")
