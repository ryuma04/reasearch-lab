# Ready-made sandbox image: common ML libraries pre-installed (pinned) so runs start fast and
# results are repeatable.
# Build: docker build -t tapu-sena/sandbox-python:latest infra/sandbox-images/python
FROM python:3.11.10-slim

ENV PIP_NO_CACHE_DIR=1 PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 MPLBACKEND=Agg
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# CPU-only PyTorch from the official CPU index, then the rest of the stack (versions known to
# work together on Python 3.11; NumPy 1.26 keeps older research code working).
RUN pip install --index-url https://download.pytorch.org/whl/cpu torch==2.5.1 torchvision==0.20.1 \
 && pip install numpy==1.26.4 pandas==2.2.3 scikit-learn==1.5.2 joblib==1.4.2 xgboost==2.1.3 \
      matplotlib==3.9.2 pytest==8.3.3 pyyaml==6.0.2 scipy==1.14.1 tqdm==4.66.5 requests==2.32.3 \
 && python -c "import torch, torchvision, numpy, pandas, sklearn, xgboost, matplotlib, pytest, yaml, scipy; print('torch', torch.__version__, 'numpy', numpy.__version__)"

# Code runs as a normal user, never as root. The sandbox mounts the project at /work.
RUN useradd -m -u 1000 lab
USER 1000
WORKDIR /work
