"""Create the release's native build prerequisites, without profiles or caches."""
from pathlib import Path
import hashlib
import json
import zipfile

root = Path(__file__).resolve().parent.parent
version = json.loads((root / 'frontend/original-cody/package.json').read_text(encoding='utf-8'))['version']
output = root / 'dist' / f'standalone-{version}'
output.mkdir(parents=True, exist_ok=True)
archive = output / f'C.O.D.Y-Build-Inputs-{version}.zip'
files = [p for p in (root / 'pristine/windows-1.1.3').rglob('*') if p.is_file() and p.suffix.lower() not in {'.log', '.pdb'}]
files += [root / 'build/installer' / name for name in ('vc_redist.x64.exe', 'MicrosoftEdgeWebview2Setup.exe')]
with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=3, allowZip64=True) as bundle:
    for file in sorted(files):
        bundle.write(file, file.relative_to(root).as_posix())
digest = hashlib.file_digest(archive.open('rb'), 'sha256').hexdigest()
manifest = {'version': version, 'name': archive.name, 'size': archive.stat().st_size, 'sha256': digest,
            'url': f'https://github.com/JNathan34/C.O.D.Y/releases/download/v{version}/{archive.name}'}
(root / 'build-inputs.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'archive': str(archive), 'files': len(files), 'size': archive.stat().st_size, 'sha256': digest}))
