"""Built-in paper recipes: tested code templates that the Code Writer uses when it recognises a
paper (and the only code source when no AI provider is configured). Lab Memory 'paper_recipe'."""
from __future__ import annotations

from . import distillation

RECIPES = [distillation]


def find(title: str, arxiv_id: str, text: str):
    for r in RECIPES:
        if r.matches(title, arxiv_id, text):
            return r
    return None
