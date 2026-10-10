"""Reproduce the MNIST distillation result: teacher, small net alone, small net distilled.

Every result is written to results/metrics.json by this script (the AI never types a number).
Env: LAB_BUDGET_FRACTION scales epochs (what-if early rounds); LAB_MAX_STEPS runs a short
"test drive" that only measures speed and writes results/timing.json.
"""
import json
import os
import random
import sys
import time

import numpy as np
import torch
import torch.nn.functional as F
import torchvision
import yaml

sys.path.insert(0, os.path.dirname(__file__))
from distill import distillation_loss  # noqa: E402
from models import MLP, count_parameters  # noqa: E402

DATASETS = {"mnist": torchvision.datasets.MNIST, "fashion_mnist": torchvision.datasets.FashionMNIST}


def load_cfg(path="configs/config.yaml"):
    with open(path) as f:
        return yaml.safe_load(f)


def set_seed(seed):
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)


def load_data(cfg):
    cls = DATASETS[cfg["data"]["dataset"]]
    train = cls("data", train=True, download=False)
    test = cls("data", train=False, download=False)
    tx = train.data.float().div(255.0).view(-1, 784)
    ty = train.targets.clone()
    vx = test.data.float().div(255.0).view(-1, 784)
    vy = test.targets.clone()
    n = int(cfg["data"].get("train_subset") or len(tx))
    if n < len(tx):
        g = torch.Generator().manual_seed(int(cfg["seed"]))
        per_class = n // 10
        idx = torch.cat([torch.nonzero(ty == c).flatten()[torch.randperm(int((ty == c).sum()), generator=g)[:per_class]]
                         for c in range(10)])
        tx, ty = tx[idx], ty[idx]
    return tx, ty, vx, vy


def jitter(x, max_px):
    """Shift each batch by up to max_px pixels in each direction (the paper jittered the input)."""
    if max_px <= 0:
        return x
    dx, dy = random.randint(-max_px, max_px), random.randint(-max_px, max_px)
    img = x.view(-1, 28, 28)
    img = torch.roll(img, shifts=(dy, dx), dims=(1, 2))
    return img.reshape(-1, 784)


def batches(x, y, bs, shuffle=True):
    idx = torch.randperm(len(x)) if shuffle else torch.arange(len(x))
    for i in range(0, len(x), bs):
        j = idx[i:i + bs]
        yield x[j], y[j]


def test_errors(model, x, y):
    model.eval()
    with torch.no_grad():
        pred = torch.cat([model(x[i:i + 2000]).argmax(1) for i in range(0, len(x), 2000)])
    return int((pred != y).sum())


class StepLimit(Exception):
    pass


def train(model, x, y, cfg, epochs, teacher=None, max_steps=None, counter=None):
    t = cfg["train"]
    opt = torch.optim.SGD(model.parameters(), lr=float(t["lr"]), momentum=float(t["momentum"]))
    T, alpha = float(cfg["distill"]["temperature"]), float(cfg["distill"]["alpha"])
    for epoch in range(epochs):
        model.train()
        total = 0.0
        for bx, by in batches(x, y, int(t["batch_size"])):
            bx = jitter(bx, int(cfg["data"].get("jitter_pixels", 0)))
            logits = model(bx)
            if teacher is None:
                loss = F.cross_entropy(logits, by)
            else:
                with torch.no_grad():
                    tl = teacher(bx)
                loss = distillation_loss(logits, tl, by, T, alpha)
            opt.zero_grad()
            loss.backward()
            opt.step()
            total += loss.item()
            if counter is not None:
                counter[0] += 1
                if max_steps and counter[0] >= max_steps:
                    raise StepLimit()
        print(f"  epoch {epoch + 1}/{epochs} loss {total:.2f}", flush=True)


def main():
    cfg = load_cfg()
    set_seed(int(cfg["seed"]))
    torch.set_num_threads(max(1, int(float(os.environ.get("LAB_CPUS") or os.cpu_count() or 1))))
    frac = float(os.environ.get("LAB_BUDGET_FRACTION", "1") or 1)
    max_steps = int(os.environ.get("LAB_MAX_STEPS", "0") or 0)
    t = cfg["train"]
    ep = lambda e: max(1, round(int(e) * frac))  # noqa: E731
    e_teacher, e_student = ep(t["epochs_teacher"]), ep(t["epochs_student"])

    tx, ty, vx, vy = load_data(cfg)
    print(f"dataset: {cfg['data']['dataset']} train={len(tx)} test={len(vx)}", flush=True)
    m = cfg["model"]
    teacher = MLP(784, int(m["teacher_hidden"]), int(m["layers"]), float(m["teacher_dropout"]))
    os.makedirs("results", exist_ok=True)

    if max_steps:  # test drive: measure seconds per step, estimate the full run
        counter, start = [0], time.time()
        try:
            train(teacher, tx, ty, cfg, 1000, max_steps=max_steps, counter=counter)
        except StepLimit:
            pass
        sec = (time.time() - start) / max(counter[0], 1)
        steps_per_epoch = -(-len(tx) // int(t["batch_size"]))
        # student steps are cheaper; distillation adds a teacher forward pass
        est = sec * steps_per_epoch * (e_teacher + 0.6 * e_student + 0.9 * e_student)
        json.dump({"seconds_per_step": sec, "steps_per_epoch": steps_per_epoch, "estimated_seconds": est,
                   "epochs_teacher": e_teacher, "epochs_student": e_student}, open("results/timing.json", "w"), indent=2)
        print(f"test drive: {sec * 1000:.1f} ms/step, estimated full run {est:.0f} s", flush=True)
        return

    start = time.time()
    print(f"training teacher ({count_parameters(teacher)} parameters, {e_teacher} epochs)", flush=True)
    train(teacher, tx, ty, cfg, e_teacher)
    teacher_err = test_errors(teacher, vx, vy)
    print(f"teacher_test_errors: {teacher_err}", flush=True)

    set_seed(int(cfg["seed"]) + 1)
    baseline = MLP(784, int(m["student_hidden"]), int(m["layers"]), 0.0)
    print(f"training small net alone ({count_parameters(baseline)} parameters, {e_student} epochs)", flush=True)
    train(baseline, tx, ty, cfg, e_student)
    base_err = test_errors(baseline, vx, vy)
    print(f"student_baseline_test_errors: {base_err}", flush=True)

    set_seed(int(cfg["seed"]) + 1)
    student = MLP(784, int(m["student_hidden"]), int(m["layers"]), 0.0)
    teacher.eval()
    print(f"training small net with distillation (T={cfg['distill']['temperature']}, {e_student} epochs)", flush=True)
    train(student, tx, ty, cfg, e_student, teacher=teacher)
    dist_err = test_errors(student, vx, vy)
    print(f"student_distilled_test_errors: {dist_err}", flush=True)

    secs = round(time.time() - start, 1)
    n_test = len(vx)
    metrics = {
        "teacher_test_errors": teacher_err,
        "student_baseline_test_errors": base_err,
        "student_distilled_test_errors": dist_err,
        "teacher_test_accuracy": round(1 - teacher_err / n_test, 4),
        "student_distilled_test_accuracy": round(1 - dist_err / n_test, 4),
        "train_seconds": secs,
    }
    print(f"train_seconds: {secs}", flush=True)
    with open("results/metrics.json", "w") as f:
        json.dump(metrics, f, indent=2)
    print("wrote results/metrics.json", flush=True)


if __name__ == "__main__":
    main()
