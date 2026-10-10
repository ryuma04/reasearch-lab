"""Recipe: Distilling the Knowledge in a Neural Network (Hinton, Vinyals & Dean, 2015), MNIST."""
from __future__ import annotations

from pathlib import Path

NAME = "distillation_mnist"
TITLE = "Distilling the Knowledge in a Neural Network"
ARXIV = "1503.02531"
FILES_DIR = Path(__file__).parent / "distillation_files"
PRIMARY_METRIC = "student_distilled_test_errors"
FIELD = "edge and efficient ML"
FULL_DATASET_MINUTES = 25  # full MNIST, paper-length training, on a laptop CPU (rough)


def matches(title: str, arxiv_id: str, text: str) -> bool:
    t = (title + " " + text[:4000]).lower()
    return arxiv_id.startswith(ARXIV) or ("distilling the knowledge" in t and "neural network" in t)


# Claims the paper reports on MNIST (Section 3). Values are verified against the paper text
# by the Paper Reader; `quotes` are the exact phrases searched for (page + position).
CLAIMS = [
    {"metric_name": "teacher_test_errors", "description": "Big net (2x1200 ReLU, dropout, jittered input)",
     "value": 67, "unit": "test errors", "higher_is_better": False, "tolerance": 0.10,
     "table_ref": "Section 3", "condition": "MNIST test set (10,000 images), 2 hidden layers of 1200 units",
     "quotes": ["67 test errors", "67 errors"]},
    {"metric_name": "student_baseline_test_errors", "description": "Small net (2x800 ReLU) trained alone",
     "value": 146, "unit": "test errors", "higher_is_better": False, "tolerance": 0.10,
     "table_ref": "Section 3", "condition": "MNIST test set, 2 hidden layers of 800 units, no regularization",
     "quotes": ["146 test errors", "146 errors"]},
    {"metric_name": "student_distilled_test_errors", "description": "Small net distilled from the big net (T=20)",
     "value": 74, "unit": "test errors", "higher_is_better": False, "tolerance": 0.10,
     "table_ref": "Section 3", "condition": "MNIST test set, soft targets at temperature 20",
     "quotes": ["74 test errors", "74 errors"]},
]

SUMMARY = ("A large, well-regularised network (or ensemble) can transfer its knowledge to a small network by training "
           "the small network on the large network's softened output probabilities (soft targets) produced with a high "
           "softmax temperature. On MNIST, a small net trained this way makes almost as few test errors as the big net "
           "and far fewer than the same small net trained alone.")

METHOD = [
    "Train a big net: 2 hidden layers of 1200 ReLU units, dropout, input jittered by up to 2 pixels.",
    "Train a small net (2 hidden layers of 800 ReLU units) on hard labels only, as the baseline.",
    "Train the same small net on a weighted sum of the soft-target loss at temperature T=20 (scaled by T^2) and the hard-label loss.",
    "Count errors on the 10,000 MNIST test images for all three nets.",
]

MISSING = ["number of training epochs", "learning rate and optimizer", "batch size", "dropout rate",
           "relative weight of soft vs hard targets (only 'considerably lower weight' on hard targets)"]


def settings(budget: str) -> list[dict]:
    """Every setting with its source: paper (page) / assumption (reason) / compute_change (reason, paper value)."""
    quick = budget == "quick"
    deep = budget == "deep"
    epochs = 8 if quick else (15 if budget == "standard" else 40)
    return [
        {"name": "data.dataset", "value": "mnist", "source": "paper", "source_ref": "p.3, Section 3", "reason": "MNIST experiments"},
        {"name": "data.train_subset", "value": 20000 if quick else 60000,
         "source": "compute_change" if quick else "paper", "source_ref": "p.3" if not quick else "",
         "paper_value": "60000", "reason": "reduced to a balanced 20,000-image subset to fit the quick budget" if quick else "all 60,000 training cases"},
        {"name": "data.jitter_pixels", "value": 0 if quick else 2,
         "source": "compute_change" if quick else "paper", "source_ref": "p.3" if not quick else "", "paper_value": "2",
         "reason": "input jitter skipped in the quick budget" if quick else "input jittered by up to two pixels"},
        {"name": "model.layers", "value": 2, "source": "paper", "source_ref": "p.3", "reason": "two hidden layers"},
        {"name": "model.teacher_hidden", "value": 1200, "source": "paper", "source_ref": "p.3", "reason": "1200 rectified linear hidden units"},
        {"name": "model.student_hidden", "value": 800, "source": "paper", "source_ref": "p.3", "reason": "800 rectified linear hidden units"},
        {"name": "model.teacher_dropout", "value": 0.5, "source": "assumption", "source_ref": "",
         "reason": "paper says 'strongly regularized using dropout' but gives no rate; 0.5 is the common default for this model type"},
        {"name": "distill.temperature", "value": 20, "source": "paper", "source_ref": "p.3", "reason": "temperature of 20"},
        {"name": "distill.alpha", "value": 0.9, "source": "assumption", "source_ref": "",
         "reason": "paper uses 'a considerably lower weight' on hard targets; 0.9 soft / 0.1 hard"},
        {"name": "train.epochs_teacher", "value": epochs, "source": "compute_change", "paper_value": "not stated (long training)",
         "reason": f"{epochs} epochs to fit the {budget} budget; the paper trained much longer"},
        {"name": "train.epochs_student", "value": epochs, "source": "compute_change", "paper_value": "not stated (long training)",
         "reason": f"{epochs} epochs to fit the {budget} budget"},
        {"name": "train.batch_size", "value": 128, "source": "assumption", "reason": "not stated; common default"},
        {"name": "train.lr", "value": 0.05, "source": "assumption", "reason": "not stated; SGD learning rate that trains these MLPs quickly"},
        {"name": "train.momentum", "value": 0.9, "source": "assumption", "reason": "not stated; standard SGD momentum"},
        {"name": "seed", "value": 0, "source": "assumption", "reason": "fixed seed for repeatable runs"},
    ] if not deep else _deep()


def _deep() -> list[dict]:
    s = settings("standard")
    for x in s:
        if x["name"].startswith("train.epochs"):
            x["value"] = 40
            x["reason"] = "40 epochs on the deep budget; the paper trained much longer"
    return s


# Gap Detective: one-thing-at-a-time experiments, ordered by how likely they matter.
GAP_ABLATIONS = [
    {"setting": "train.epochs_student", "also": ["train.epochs_teacher"], "factor": 3, "max": 40,
     "label": "train longer", "likely": "high", "why": "the paper trained much longer than our budget allows"},
    {"setting": "data.train_subset", "value": 60000, "label": "use all 60,000 training images", "likely": "high",
     "why": "we trained on a subset"},
    {"setting": "data.jitter_pixels", "value": 2, "label": "add the paper's input jitter", "likely": "medium",
     "why": "the paper jittered input images by up to two pixels"},
]

# Ready-made what-if suggestions for this paper.
WHATIF_SUGGESTIONS = [
    "What if the temperature is 2, 5, 10 or 20?",
    "What if we use Fashion-MNIST instead of MNIST?",
    "What if the small model has only 100 hidden units?",
]

REQUIREMENTS = "torch\ntorchvision\nnumpy\npyyaml\npytest\n"


def files() -> dict[str, str]:
    out = {}
    for p in FILES_DIR.rglob("*"):
        if p.is_file() and "__pycache__" not in p.parts:
            out[p.relative_to(FILES_DIR).as_posix()] = p.read_text(encoding="utf-8")
    out["requirements.txt"] = REQUIREMENTS
    return out
