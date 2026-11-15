"""Install a verified Node 24 runtime inside this workspace, without global changes."""

import hashlib
import io
import platform
import tarfile
import urllib.request
from pathlib import Path

root = Path(__file__).resolve().parents[1]
system = {"Darwin": "darwin", "Linux": "linux"}[platform.system()]
arch = {"arm64": "arm64", "aarch64": "arm64", "x86_64": "x64"}[platform.machine()]
version = (root / ".node-version").read_text().strip()
base = f"https://nodejs.org/dist/v{version}/"
checksums = urllib.request.urlopen(base + "SHASUMS256.txt", timeout=60).read().decode()
match = next(
    line.split() for line in checksums.splitlines() if line.endswith(f"-{system}-{arch}.tar.gz")
)
checksum, filename = match
archive = urllib.request.urlopen(base + filename, timeout=120).read()
if hashlib.sha256(archive).hexdigest() != checksum:
    raise RuntimeError("Node archive checksum mismatch")
destination = root / ".tools"
destination.mkdir(exist_ok=True)
with tarfile.open(fileobj=io.BytesIO(archive)) as bundle:
    bundle.extractall(destination, filter="data")
link = destination / "node"
if link.is_symlink():
    link.unlink()
elif link.exists():
    raise RuntimeError("Refusing to overwrite existing .tools/node directory")
link.symlink_to(filename.removesuffix(".tar.gz"), target_is_directory=True)
print(f"Installed {filename} in {link}")
