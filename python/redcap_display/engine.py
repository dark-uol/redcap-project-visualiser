"""A small JSON-in, JSON-out facade over the visibility engine.

The browser reaches Python through Pyodide, where every call across the bridge costs a conversion. So the interface is
coarse: build the engine once from the parsed project metadata, then make one call per evaluation. Nothing crosses the
bridge per lookup.
"""

from __future__ import annotations

import json
from typing import Any, Dict, Mapping, Tuple, Union

from .visibility import Context, VisibilityInfo, build_model, evaluate_visibility_with_blank


def _info_to_json(info: VisibilityInfo) -> Dict[str, Any]:
    return {
        "state": info.state,
        "reasons": list(info.reasons),
        # an instance is only named when there is one, so a project without repeating forms gets the output it always did
        "missing": [
            {"variable": item.variable, "event": item.event, **({} if item.instance is None else {"instance": item.instance})}
            for item in info.missing
        ],
    }


class Engine:
    """Visibility for one project. ``parsed`` is the ``ParsedODM`` that ``src/lib/parser.ts`` produces, as a dict or JSON text."""

    def __init__(self, parsed: Union[str, Mapping[str, Any]]) -> None:
        self._model = build_model(json.loads(parsed) if isinstance(parsed, str) else parsed)

    def _run(self, context: Union[str, Mapping[str, Any]]) -> Tuple[Dict[str, Dict[str, Any]], list]:
        data = json.loads(context) if isinstance(context, str) else context
        results, blank = evaluate_visibility_with_blank(
            self._model,
            Context(
                values=data.get("values", {}),
                mode=data.get("mode", "form"),
                event=data.get("event"),
                today=data.get("today"),
                instances=data.get("instances", {}),
            ),
        )
        return {key: _info_to_json(info) for key, info in results.items()}, sorted(blank)

    def evaluate(self, context: Union[str, Mapping[str, Any]]) -> Dict[str, Dict[str, Any]]:
        """``context`` is ``{"values": {event: {variable: value}}, "mode": "form"|"survey", "event": id|null, "today": "YYYY-MM-DD"}``.

        ``today`` is optional and is what ``"today"`` means in logic; without it the system clock's local date is used.

        ``instances`` is optional and holds the values of repeating forms:
        ``{event: {form: {instance: {variable: value}}}}`` (event ``""`` for no events). A field of a repeating form listed there
        gets one result per instance, keyed ``variable#instance``; without it every field has the one result it always had.
        """
        return self._run(context)[0]

    def evaluate_json(self, context: Union[str, Mapping[str, Any]]) -> str:
        """``{"results": <what evaluate returns>, "blank": [fields the evaluation treated as blank]}`` as JSON text."""
        results, blank = self._run(context)
        return json.dumps({"results": results, "blank": blank})
