with open(r'C:\Users\User\Desktop\skribbl-game\index.html', 'r', encoding='utf-8') as f:
    text = f.read()

pos = text.find('loginAvatarArrowsLeft')
print(text[pos-50:pos+800])
