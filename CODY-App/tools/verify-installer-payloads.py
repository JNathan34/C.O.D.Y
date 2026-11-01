import io, json, mmap, pathlib, struct, sys, zipfile

root = pathlib.Path(__file__).resolve().parent.parent
version = sys.argv[1] if len(sys.argv) > 1 else json.loads((root / 'frontend/original-cody/package.json').read_text(encoding='utf-8-sig'))['version']
installer = root / 'dist' / ('standalone-' + version) / ('C.O.D.Y-Setup-' + version + '.exe')

class Segment(io.IOBase):
    def __init__(self, start, length):
        self.source = installer.open('rb')
        self.start, self.length, self.position = start, length, 0
    def tell(self): return self.position
    def seekable(self): return True
    def seek(self, offset, whence=0):
        self.position = offset if whence == 0 else (self.position if whence == 1 else self.length) + offset
        if not 0 <= self.position <= self.length: raise ValueError('Out of payload bounds')
        return self.position
    def read(self, size=-1):
        self.source.seek(self.start + self.position)
        result = self.source.read(self.length - self.position if size < 0 else min(size, self.length - self.position))
        self.position += len(result)
        return result
    def close(self):
        self.source.close()
        super().close()

results = []
with installer.open('rb') as source, mmap.mmap(source.fileno(), 0, access=mmap.ACCESS_READ) as data:
    position = 0
    while True:
        end = data.find(b'PK\x05\x06', position)
        if end < 0: break
        position = end + 4
        if end + 22 > len(data): continue
        disk, central_disk, count_disk, count, size, offset, comment = struct.unpack_from('<4H2LH', data, end + 4)
        start = end - size - offset
        if disk or central_disk or not count or count != count_disk or start < 0: continue
        if data[start:start+4] != b'PK\x03\x04' or data[end-size:end-size+4] != b'PK\x01\x02': continue
        with Segment(start, end + 22 + comment - start) as segment, zipfile.ZipFile(segment) as archive:
            if 'resources/native-engine/HeyClicky.dll' not in archive.namelist(): continue
            with archive.open('C.O.D.Y.exe') as app:
                header = app.read(4096)
            machine = struct.unpack_from('<H', header, struct.unpack_from('<L', header, 0x3c)[0] + 4)[0]
            bad = archive.testzip()
            results.append({'architecture': {0x8664:'x64', 0xaa64:'arm64'}.get(machine, hex(machine)), 'files':len(archive.infolist()), 'passed':bad is None, 'badFile':bad})
report = {'passed':len(results)==2 and {r['architecture'] for r in results} == {'x64','arm64'} and all(r['passed'] for r in results), 'payloads':results}
(root / 'reports/standalone-installer-payloads.json').write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
sys.exit(0 if report['passed'] else 1)
