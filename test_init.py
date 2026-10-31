with open(r'C:\Users\User\Desktop\skribbl-game\game-engine.js', 'r', encoding='utf-8') as f:
    text = f.read()

pos = text.find('initAvatarSprites()')
print(text[pos:pos+1200])
