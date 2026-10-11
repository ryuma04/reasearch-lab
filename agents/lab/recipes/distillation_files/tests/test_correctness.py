"""Correctness tests: parts of the code do the right thing."""
import os
import sys

import pytest
import torch
import yaml

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
from distill import distillation_loss, softmax_t  # noqa: E402
from models import MLP, count_parameters  # noqa: E402

CFG = yaml.safe_load(open(os.path.join(os.path.dirname(__file__), "..", "configs", "config.yaml")))


@pytest.mark.parametrize("T", [1.0, 2.0, 5.0, 20.0])
def test_softened_probabilities_sum_to_one(T):
    p = softmax_t(torch.randn(16, 10), T)
    assert torch.allclose(p.sum(-1), torch.ones(16), atol=1e-5)


def test_higher_temperature_is_softer():
    z = torch.randn(32, 10) * 5
    ent = lambda p: -(p * p.clamp_min(1e-12).log()).sum(-1).mean()  # noqa: E731
    assert ent(softmax_t(z, 20.0)) > ent(softmax_t(z, 1.0))


def test_soft_loss_is_zero_when_student_matches_teacher():
    z = torch.randn(8, 10)
    y = torch.randint(0, 10, (8,))
    loss = distillation_loss(z, z, y, temperature=20.0, alpha=1.0)
    # The soft loss is scaled by T^2 = 400, so float32 rounding (~1e-8) shows up as ~1e-5; a real bug is orders larger.
    assert abs(float(loss)) < 1e-4


def test_parameter_counts_match_paper_architecture():
    h, s = int(CFG["model"]["teacher_hidden"]), int(CFG["model"]["student_hidden"])
    teacher = MLP(784, h, 2, 0.5)
    student = MLP(784, s, 2, 0.0)
    assert count_parameters(teacher) == 784 * h + h + h * h + h + h * 10 + 10
    assert count_parameters(student) == 784 * s + s + s * s + s + s * 10 + 10


def test_train_and_test_data_do_not_overlap():
    if not os.path.isdir(os.path.join(os.path.dirname(__file__), "..", "data")):
        pytest.skip("dataset not downloaded")
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
    cwd = os.getcwd()
    os.chdir(os.path.join(os.path.dirname(__file__), ".."))
    try:
        from train import load_data
        tx, _, vx, _ = load_data(CFG)
    finally:
        os.chdir(cwd)
    train_hashes = {hash(r.numpy().tobytes()) for r in tx[:5000]}
    overlap = sum(hash(r.numpy().tobytes()) in train_hashes for r in vx[:2000])
    assert overlap <= 2  # MNIST has a handful of exact duplicates across splits at most
