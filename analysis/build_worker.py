"""Run with the target platform's Python 3.9 after installing requirements.txt."""
import hashlib
import json
from pathlib import Path
import platform
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
ANALYSIS = ROOT / 'analysis'
OUT = ROOT / 'assets' / 'analysis-worker'

def main():
    if sys.version_info[:2] != (3, 9):
        raise SystemExit(
            f'Build requires Python 3.9; running {platform.python_version()} ({sys.executable}). '
            'Create and activate a Python 3.9 environment first; see analysis/README.md.'
        )
    import mediapipe as mp
    import PyInstaller.__main__
    # Fetch only at build time; failure blocks packaging rather than causing a runtime download.
    with mp.solutions.pose.Pose(static_image_mode=True, model_complexity=2):
        pass
    stamp = hashlib.sha256()
    for file in sorted(ANALYSIS.rglob('*'), key=lambda p: p.relative_to(ANALYSIS).as_posix()):
        if file.is_file() and '__pycache__' not in file.parts:
            stamp.update(file.relative_to(ANALYSIS).as_posix().encode())
            stamp.update(file.read_bytes())
    build = ROOT / '.analysis-build'
    PyInstaller.__main__.run([
        str(ANALYSIS / 'worker.py'), '--name', 'kneevid-analysis', '--onedir', '--noconfirm',
        '--distpath', str(OUT), '--workpath', str(build / 'work'), '--specpath', str(build),
        '--paths', str(ANALYSIS / 'reference'),
        '--add-data', str(ANALYSIS / 'reference') + ':reference',
        '--collect-all', 'mediapipe', '--collect-all', 'sklearn',
        '--collect-all', 'imblearn', '--collect-all', 'shap', '--collect-all', 'llvmlite',
        '--exclude-module', 'torch', '--exclude-module', 'tensorflow',
        '--exclude-module', 'jax', '--exclude-module', 'jaxlib',
        '--exclude-module', 'IPython', '--exclude-module', 'pytest',
    ])
    worker = OUT / 'kneevid-analysis' / ('kneevid-analysis.exe' if sys.platform == 'win32' else 'kneevid-analysis')
    smoke = subprocess.run([str(worker), '--self-test'], input='', text=True, capture_output=True, check=True)
    if not json.loads(smoke.stdout).get('selfTest'):
        raise SystemExit('Packaged inference smoke test failed: ' + smoke.stdout + smoke.stderr)
    (OUT / 'manifest.json').write_text(json.dumps({
        'platform': sys.platform, 'machine': platform.machine().lower(),
        'python': platform.python_version(), 'sourceSha256': stamp.hexdigest(),
    }, indent=2))
    print('Offline worker ready:', worker)

if __name__ == '__main__':
    main()
