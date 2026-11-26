"""A small JSON-in, JSON-out facade over the visibility engine.

The browser reaches Python through Pyodide, where every call across the bridge costs a conversion. So the interface is
coarse: build the engine once from the parsed project metadata, then make one call per evaluation. Nothing crosses the
bridge per lookup.
"""

from __future__ import annotations

import json
from typing import Any, Dict, Mapping, Union

from .visibility import Context, VisibilityInfo, VisibilityOutcome, build_model, evaluate_visibility_full


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

    def _run(self, context: Union[str, Mapping[str, Any]]) -> VisibilityOutcome:
        data = json.loads(context) if isinstance(context, str) else context
        return evaluate_visibility_full(
            self._model,
            Context(
                values=data.get("values", {}),
                mode=data.get("mode", "form"),
                event=data.get("event"),
                today=data.get("today"),
                instances=data.get("instances", {}),
                derive=bool(data.get("derive", False)),
            ),
        )

    def evaluate(self, context: Union[str, Mapping[str, Any]]) -> Dict[str, Dict[str, Any]]:
        """``context`` is ``{"values": {event: {variable: value}}, "mode": "form"|"survey", "event": id|null, "today": "YYYY-MM-DD"}``.

        ``today`` is optional and is what ``"today"`` means in logic; without it the system clock's local date is used.

        ``derive`` is optional (default false): when true, a calculated field, or a field with a top-level ``@DEFAULT``, takes its value
        from its inputs when none is set. For exploring a project; leave it off for exported data, which already holds those values.

        ``instances`` is optional and holds the values of repeating forms:
        ``{event: {form: {instance: {variable: value}}}}`` (event ``""`` for no events). A field of a repeating form listed there
        gets one result per instance, keyed ``variable#instance``; without it every field has the one result it always had.
        """
        return self.evaluate_full(context)["results"]

    def evaluate_full(self, context: Union[str, Mapping[str, Any]]) -> Dict[str, Any]:
        """What ``evaluate`` returns, as ``results``, plus ``blank``: the fields the evaluation treated as blank (sorted), and
        ``derived``: the value of each calculated or defaulted field that came from its inputs, by variable, in the viewed event."""
        outcome = self._run(context)
        return {
            "results": {key: _info_to_json(info) for key, info in outcome.results.items()},
            "blank": sorted(outcome.blank),
            "derived": dict(outcome.derived),
        }

    def evaluate_json(self, context: Union[str, Mapping[str, Any]]) -> str:
        """``evaluate_full`` as JSON text, the one call the browser makes across the bridge."""
        return json.dumps(self.evaluate_full(context))
