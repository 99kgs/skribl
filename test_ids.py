import re

with open(r'C:\Users\User\Desktop\skribbl-game\index.html', 'r', encoding='utf-8') as f:
    text = f.read()

print('loginAvatarArrowsLeft in index:', 'loginAvatarArrowsLeft' in text)
matches = re.findall(r'id="loginAvatar[^"]*"', text)
print('matches in index:', matches)

matches2 = re.findall(r'id="[^"]*"', text)
print('all ids in index:', matches2)
