from pathlib import Path
import os
root=Path('CODY-App');mapping={'HeyClicky.App':'Cody.Engine','HeyClicky.Core':'Cody.Core','HeyClicky.Contracts':'Cody.Contracts','HeyClicky.Agents':'Cody.Agents','HeyClicky.Platform':'Cody.Platform','HeyClicky.Drawing':'Cody.Drawing','HeyClicky.Drawing3D':'Cody.Drawing3D'}
excluded={'node_modules','bin','obj','pristine','reference','run','dist','reports','wake-dotnet','wake-lab','.git','.venv'}
for current,dirs,files in os.walk(root):
 dirs[:]=[x for x in dirs if x not in excluded]
 for name in files:
  p=Path(current)/name
  if p.suffix.lower() not in {'.cs','.csproj','.js','.cjs','.mjs','.json','.bat','.ps1','.py','.md','.txt'}:continue
  try:s=p.read_text(encoding='utf-8-sig')
  except (UnicodeError,OSError):continue
  revised=s
  for old,new in mapping.items():
   revised=revised.replace(old+'/',new+'/').replace(old+'\\',new+'\\').replace(old+'.csproj',new+'.csproj')
  revised=revised.replace('Cody.Engine.csproj','Cody.Engine.csproj').replace('work/Cody.*','work/Cody.*')
  for segment in ['App','Core','Contracts','Agents','Platform','Drawing','Drawing3D']:
   revised=revised.replace('/HeyClicky/'+segment+'/', '/Cody/'+segment+'/').replace('\\HeyClicky\\'+segment+'\\','\\Cody\\'+segment+'\\')
  if revised!=s:p.write_text(revised,encoding='utf-8')
for old,new in mapping.items():
 folder=root/'work'/old
 for p in folder.glob('*.csproj'):
  target='Cody.Engine.csproj' if old=='HeyClicky.App' else new+'.csproj';p.rename(folder/target)
 source=folder/'HeyClicky'
 if source.exists():source.rename(folder/'Cody')
 folder.rename(root/'work'/new)
