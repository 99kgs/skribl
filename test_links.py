with open(r'C:\Users\User\Desktop\skribbl-game\index.html', 'r', encoding='utf-8') as f:
    text = f.read()

pos = text.find('headerInviteLink')
print('headerInviteLink in index:', pos)
pos2 = text.find('inputHeaderRoomLink')
print('inputHeaderRoomLink in index:', pos2)
