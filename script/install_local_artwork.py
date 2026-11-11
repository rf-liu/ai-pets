#!/usr/bin/env python3
"""Download the upstream original art for the user's local widget cache."""
import pathlib, urllib.request, hashlib, tempfile, os
ROOT = pathlib.Path.home() / 'Library/Application Support/AIQuotaCompanion/artwork'
ASSETS = [
 ('gemini-catgirl-hd.webp', 'https://raw.githubusercontent.com/smiththomson580-star/gemini-quota-widget/main/assets/catgirl-hd.webp'),
 ('deepseek-original.png', 'https://raw.githubusercontent.com/MeteorNOX/DeepSeek-Balance-Whale-Widget/main/assets/DSniang1.png'),
]
DS_ART_COMMIT = '61827f675fd3daac011859ad8a12e095af5480db'
for expression in ['main','stroking','angry','disappointed','exhausted','half_closed_eyes','close_eyes','half_open_eyes']:
 ASSETS.append(('ds-desktop/' + expression + '.png', f'https://raw.githubusercontent.com/MeteorNOX/DeepSeek-Balance-Whale-Widget/{DS_ART_COMMIT}/frontend/assets/images/{expression}.png'))

def main():
 ROOT.mkdir(parents=True, exist_ok=True)
 for name, url in ASSETS:
  target = ROOT / name
  target.parent.mkdir(parents=True, exist_ok=True)
  if target.is_file():
   print(f'Already cached: {name}'); continue
  with urllib.request.urlopen(url, timeout=30) as response: data = response.read(10 * 1024 * 1024)
  if not data or not (data.startswith(b'\x89PNG') or data.startswith(b'RIFF')): raise ValueError(f'Invalid artwork: {name}')
  with tempfile.NamedTemporaryFile(dir=ROOT, delete=False) as f:
   f.write(data); temp = f.name
  os.replace(temp, target)
  print(f'Cached: {name} sha256={hashlib.sha256(data).hexdigest()}')
if __name__ == '__main__': main()
