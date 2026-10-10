# Ready-made sandbox image: common ML libraries pre-installed so runs start fast.
# Build: docker build -t tapu-sena/sandbox-python:latest sandbox-images/python
FROM python:3.11-slim

ENV PIP_NO_CACHE_DIR=1 PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN pip install --index-url https://download.pytorch.org/whl/cpu torch torchvision \
 && pip install numpy pandas scikit-learn xgboost matplotlib pytest pyyaml scipy tqdm requests

# Code runs as a normal user, never as root.
RUN useradd -m -u 1000 lab
USER 1000
WORKDIR /work
