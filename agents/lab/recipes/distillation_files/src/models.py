"""Fully connected networks from Hinton, Vinyals & Dean (2015), MNIST experiments."""
import torch.nn as nn


class MLP(nn.Module):
    def __init__(self, in_dim: int = 784, hidden: int = 800, layers: int = 2, dropout: float = 0.0, classes: int = 10):
        super().__init__()
        mods, d = [], in_dim
        for _ in range(layers):
            mods += [nn.Linear(d, hidden), nn.ReLU()]
            if dropout > 0:
                mods.append(nn.Dropout(dropout))
            d = hidden
        mods.append(nn.Linear(d, classes))
        self.net = nn.Sequential(*mods)

    def forward(self, x):
        return self.net(x)


def count_parameters(model: nn.Module) -> int:
    return sum(p.numel() for p in model.parameters())
