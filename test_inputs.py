with open(r'C:\Users\User\Desktop\skribbl-game\index.html', 'r', encoding='utf-8') as f:
    text = f.read()

pos = text.find('input')
while pos != -1:
    print(text[pos-10:pos+80])
    pos = text.find('input', pos+80)
