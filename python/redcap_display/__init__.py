"""REDCap display logic: decide which fields and forms a record shows, hides, or cannot be decided.

Pure standard library (Python 3.9+), so the same sources run under CPython and under Pyodide in the browser.
"""

from .engine import Engine
from .logic import ConditionResult, LogicFieldRef, evaluate_condition, parse_logic
from .visibility import Context, MissingInput, VisibilityInfo, build_model, evaluate_visibility

__all__ = [
    "ConditionResult",
    "Context",
    "Engine",
    "LogicFieldRef",
    "MissingInput",
    "VisibilityInfo",
    "build_model",
    "evaluate_condition",
    "evaluate_visibility",
    "parse_logic",
]
