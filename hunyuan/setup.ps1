# Creates hunyuan/.venv (Python 3.11) with CUDA PyTorch and Hunyuan3D-2 (shape generation).
# Run from the repo root:  npm run hunyuan:setup
# Needs uv (https://docs.astral.sh/uv/) and an NVIDIA GPU with a recent driver.
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$venv = Join-Path $here '.venv'
$python = Join-Path $venv 'Scripts\python.exe'

if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
  throw 'uv is not installed. Install it with: powershell -c "irm https://astral.sh/uv/install.ps1 | iex"'
}
if (-not (Test-Path $python)) {
  uv venv --python 3.11 $venv
  if ($LASTEXITCODE -ne 0) { throw 'Could not create the Python 3.11 environment.' }
}
uv pip install --python $python torch==2.7.1 torchvision==0.22.1 --index-url https://download.pytorch.org/whl/cu126
if ($LASTEXITCODE -ne 0) { throw 'Installing PyTorch failed.' }
uv pip install --python $python -r (Join-Path $here 'requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'Installing Hunyuan3D failed.' }

& $python -c "import torch, hy3dgen.shapegen; assert torch.cuda.is_available(), 'CUDA is not available to PyTorch'; print('OK:', torch.__version__, torch.cuda.get_device_name(0))"
if ($LASTEXITCODE -ne 0) { throw 'The environment was installed but the GPU check failed.' }

# Setup is the only download step; scan runtime uses local files exclusively.
& $python -c "from huggingface_hub import hf_hub_download; [hf_hub_download('tencent/Hunyuan3D-2mini', name, subfolder=folder) for folder in ('hunyuan3d-dit-v2-mini-turbo', 'hunyuan3d-vae-v2-mini-turbo') for name in ('config.yaml', 'model.fp16.safetensors')]; print('Local shape models ready.')"
if ($LASTEXITCODE -ne 0) { throw 'Downloading the shape model files failed.' }

# Download the small background-removal model during setup as well.
& $python -c "from rembg import new_session; new_session('silueta', providers=['CPUExecutionProvider']); print('Background removal model ready.')"
if ($LASTEXITCODE -ne 0) { throw 'Downloading the background removal model failed.' }
Write-Host 'Scan setup complete. Model files are cached; scanning runs offline without network checks.'
