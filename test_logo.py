with open(r'C:\Users\User\Desktop\skribbl-game\index.html', 'r', encoding='utf-8') as f:
    text = f.read()

pos = text.find('headerLogo')
print('headerLogo in index:', pos)
pos2 = text.find('containerLogoBig')
print('containerLogoBig in index:', pos2)
pos3 = text.find('logo.gif')
print('logo.gif in index:', pos3)
print(text[pos3-50:pos3+100])
