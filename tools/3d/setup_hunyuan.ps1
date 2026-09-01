$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$toolsRoot = Join-Path $projectRoot '.tools'
$repoPath = Join-Path $toolsRoot 'hunyuan3d-2'
$venvPath = Join-Path $toolsRoot 'hunyuan3d-venv'

$uv = Get-Command uv -ErrorAction SilentlyContinue
if (-not $uv) {
    throw 'uv is required. Install it with: winget install --id astral-sh.uv --exact'
}

if (-not (Test-Path -LiteralPath (Join-Path $repoPath '.git'))) {
    git clone --depth 1 https://github.com/Tencent-Hunyuan/Hunyuan3D-2.git $repoPath
}

& $uv.Source python install 3.10
& $uv.Source venv $venvPath --python 3.10
$python = Join-Path $venvPath 'Scripts\python.exe'

& $uv.Source pip install --python $python torch torchvision --index-url https://download.pytorch.org/whl/cu128
& $uv.Source pip install --python $python -e $repoPath

& $python -c "import torch; assert torch.cuda.is_available(); print(torch.cuda.get_device_name(0))"
