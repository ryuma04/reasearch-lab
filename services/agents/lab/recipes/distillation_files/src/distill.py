"""Soft targets with temperature and the distillation loss (Section 2 of the paper)."""
import torch.nn.functional as F


def softmax_t(logits, temperature: float):
    """Softened class probabilities q_i = exp(z_i/T) / sum_j exp(z_j/T)."""
    return F.softmax(logits / temperature, dim=-1)


def distillation_loss(student_logits, teacher_logits, labels, temperature: float, alpha: float):
    """alpha * soft-target loss (scaled by T^2, as the paper recommends) + (1 - alpha) * hard-label loss."""
    soft = F.kl_div(F.log_softmax(student_logits / temperature, dim=-1),
                    softmax_t(teacher_logits, temperature), reduction="batchmean") * temperature ** 2
    hard = F.cross_entropy(student_logits, labels)
    return alpha * soft + (1 - alpha) * hard
