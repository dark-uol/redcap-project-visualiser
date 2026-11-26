"""A small JSON-in, JSON-out facade over the visibility engine.

The browser reaches Python through Pyodide, where every call across the bridge costs a conversion. So the interface is
coarse: build the engine once from the parsed project metadata, then make one call per evaluation. Nothing crosses the
bridge per lookup.
"""

from __future__ import annotations

import json
from typing import Any, Dict, Mapping, Union

from .visibility import Context, VisibilityInfo, build_model, evaluate_visibility


def _info_to_json(info: VisibilityInfo) -> Dict[str, Any]:
    return {
        "state": info.state,
        "reasons": list(info.reasons),
        "missing": [{"variable": item.variable, "event": item.event} for item in info.missing],
    }


class Engine:
    """Visibility for one project. ``parsed`` is the ``ParsedODM`` that ``src/lib/parser.ts`` produces, as a dict or JSON text."""

    def __init__(self, parsed: Union[str, Mapping[str, Any]]) -> None:
        self._model = build_model(json.loads(parsed) if isinstance(parsed, str) else parsed)

    def evaluate(self, context: Union[str, Mapping[str, Any]]) -> Dict[str, Dict[str, Any]]:
        """``context`` is ``{"values": {event: {variable: value}}, "mode": "form"|"survey", "event": id|null}``."""
        data = json.loads(context) if isinstance(context, str) else context
        result = evaluate_visibility(
            self._model,
            Context(values=data.get("values", {}), mode=data.get("mode", "form"), event=data.get("event")),
        )
        return {key: _info_to_json(info) for key, info in result.items()}

    def evaluate_json(self, context: Union[str, Mapping[str, Any]]) -> str:
        return json.dumps(self.evaluate(context))
