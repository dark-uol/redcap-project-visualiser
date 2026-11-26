"""What-if visibility: given values for some fields, decide which fields and forms are shown, hidden or unknown.

A port of ``evaluateVisibility`` and its helpers in ``src/lib/whatIf.ts``, plus the parts of ``buildModel`` in
``src/lib/graph.ts`` that it needs (the field table, the implicit ``<form>_complete`` fields and the form display
rule nodes). Pure standard library.
"""

from __future__ import annotations

from dataclasses import dataclass, field as dataclass_field
from typing import Any, Callable, Dict, List, Mapping, Optional, Set, Tuple, Union

from .logic import LogicFieldRef, evaluate_condition, is_space

#: The key of the values bucket that applies in every event.
ANY_EVENT = ""
MAX_ROUNDS = 50

WhatIfValue = Union[str, List[str]]


# ---------------------------------------------------------------------------
# Model
# ---------------------------------------------------------------------------


@dataclass
class FieldInfo:
    variable: str
    type: str
    form: str
    branching: str = ""
    annotation: str = ""
    synthetic: bool = False


@dataclass
class FormNode:
    form: str
    logic: List[str] = dataclass_field(default_factory=list)
    #: Per rule, the unique event names it applies the form in (empty = all events).
    logic_events: List[List[str]] = dataclass_field(default_factory=list)


@dataclass
class EventInfo:
    id: str
    label: str = ""
    arm: str = ""
    arm_name: str = ""
    forms: List[str] = dataclass_field(default_factory=list)


@dataclass
class Model:
    fields: Dict[str, FieldInfo]
    form_nodes: Dict[str, FormNode]
    events: List[EventInfo]

    def event(self, event_id: Optional[str]) -> Optional[EventInfo]:
        if event_id is None:
            return None
        for candidate in self.events:
            if candidate.id == event_id:
                return candidate
        return None


def build_model(parsed: Mapping[str, Any]) -> Model:
    """Build the model from the ``ParsedODM`` the TypeScript parser produces (as JSON)."""
    fields: Dict[str, FieldInfo] = {}
    for item in parsed.get("fields", []):
        fields[item["variable"]] = FieldInfo(
            variable=item["variable"],
            type=item.get("type", ""),
            form=item.get("form", ""),
            branching=item.get("branching", "") or "",
            annotation=item.get("annotation", "") or "",
            synthetic=bool(item.get("synthetic", False)),
        )
    # <form>_complete status pseudo-fields are valid references but not ItemDefs
    for form in parsed.get("forms", []):
        variable = form["id"] + "_complete"
        if variable not in fields:
            fields[variable] = FieldInfo(variable=variable, type="form_status", form=form["id"], synthetic=True)

    form_nodes: Dict[str, FormNode] = {}
    for rule in parsed.get("formLogic", []) or []:
        for form_id in rule["forms"]:
            node_id = "form:" + form_id
            node = form_nodes.get(node_id)
            if node is None:
                node = FormNode(form=form_id)
                form_nodes[node_id] = node
            node.logic.append(rule["logic"])
            node.logic_events.append([entry["event"] for entry in (rule.get("formEvents") or []) if entry["form"] == form_id])

    events = [
        EventInfo(
            id=item["id"],
            label=item.get("label", ""),
            arm=item.get("arm", ""),
            arm_name=item.get("armName", ""),
            forms=list(item.get("forms", [])),
        )
        for item in (parsed.get("events") or [])
    ]
    return Model(fields=fields, form_nodes=form_nodes, events=events)


# ---------------------------------------------------------------------------
# Results
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class MissingInput:
    """A value the evaluation needs but does not have: the variable, and the event it lives in (None when no event is chosen)."""

    variable: str
    event: Optional[str]


@dataclass
class VisibilityInfo:
    state: str  # 'shown' | 'hidden' | 'unknown'
    #: Short human-readable reasons, e.g. 'branching logic false', '@HIDDEN-SURVEY', 'form hidden by form display logic'.
    reasons: List[str] = dataclass_field(default_factory=list)
    #: Values needed to decide, deduplicated by variable and event, in order of first appearance.
    missing: List[MissingInput] = dataclass_field(default_factory=list)

    def same_as(self, other: "VisibilityInfo") -> bool:
        return self.state == other.state and self.reasons == other.reasons and self.missing == other.missing


@dataclass
class Context:
    #: Values by event id. The key '' (ANY_EVENT) holds values that apply in every event; an event's own value wins over ''.
    values: Mapping[str, Mapping[str, WhatIfValue]]
    mode: str = "form"  # 'survey' | 'form'
    #: Unique event name the record is viewed in, or None when not chosen.
    event: Optional[str] = None


# ---------------------------------------------------------------------------
# Action tags
# ---------------------------------------------------------------------------


def split_top_level(text: str) -> List[str]:
    """Split ``text`` at top-level commas, honouring quotes and nested parentheses."""
    parts: List[str] = []
    depth = 0
    quote = ""
    current = ""
    index = 0
    while index < len(text):
        character = text[index]
        if quote:
            current += character
            if character == "\\" and index + 1 < len(text):
                index += 1
                current += text[index]
            elif character == quote:
                quote = ""
            index += 1
            continue
        if character in "\"'":
            quote = character
            current += character
            index += 1
            continue
        if character == "(":
            depth += 1
        elif character == ")":
            depth -= 1
        if character == "," and depth == 0:
            parts.append(current)
            current = ""
            index += 1
            continue
        current += character
        index += 1
    parts.append(current)
    return parts


def _matching_parenthesis(text: str, open_index: int) -> int:
    """Index of the ``)`` matching the ``(`` at ``open_index``, skipping quoted strings; -1 when unbalanced."""
    depth = 0
    quote = ""
    index = open_index
    while index < len(text):
        character = text[index]
        if quote:
            if character == "\\":
                index += 1
            elif character == quote:
                quote = ""
        elif character in "\"'":
            quote = character
        elif character == "(":
            depth += 1
        elif character == ")":
            depth -= 1
            if depth == 0:
                return index
        index += 1
    return -1


_TAG_CHARACTERS = frozenset("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-")


def _js_strip(text: str) -> str:
    start, end = 0, len(text)
    while start < end and is_space(text[start]):
        start += 1
    while end > start and is_space(text[end - 1]):
        end -= 1
    return text[start:end]


@dataclass
class _Tag:
    name: str


@dataclass
class _If:
    condition: str
    then_text: str
    else_text: str


def parse_action_tags(annotation: str) -> List[Union[_Tag, _If]]:
    """The tags (upper-cased names) and ``@IF(...)`` constructs in an annotation."""
    items: List[Union[_Tag, _If]] = []
    position = 0
    while True:
        at = annotation.find("@", position)
        if at < 0:
            return items
        end = at + 1
        while end < len(annotation) and annotation[end] in _TAG_CHARACTERS:
            end += 1
        if end == at + 1:  # an '@' not followed by a tag name matches nothing
            position = at + 1
            continue
        name = annotation[at + 1 : end].upper()
        position = end
        if name == "IF":
            open_index = end
            while open_index < len(annotation) and is_space(annotation[open_index]):
                open_index += 1
            if open_index < len(annotation) and annotation[open_index] == "(":
                close = _matching_parenthesis(annotation, open_index)
                if close >= 0:
                    parts = split_top_level(annotation[open_index + 1 : close])
                    items.append(
                        _If(
                            condition=parts[0] if parts else "",
                            then_text=_js_strip(parts[1]) if len(parts) > 1 else "",
                            else_text=_js_strip(",".join(parts[2:])),
                        )
                    )
                    position = close + 1
                    continue
        items.append(_Tag(name))


@dataclass
class _Contribution:
    state: str
    reasons: List[str]
    missing: List[MissingInput]


@dataclass
class _Tracked:
    result: Optional[bool]
    missing: List[MissingInput]


Evaluate = Callable[[str], _Tracked]


def _unique_inputs(inputs: List[MissingInput]) -> List[MissingInput]:
    seen: Set[MissingInput] = set()
    unique: List[MissingInput] = []
    for item in inputs:
        if item not in seen:
            seen.add(item)
            unique.append(item)
    return unique


def _unique(values: List[str]) -> List[str]:
    return list(dict.fromkeys(values))


def _combine(parts: List[_Contribution]) -> _Contribution:
    reasons = [reason for part in parts for reason in part.reasons]
    missing = _unique_inputs([item for part in parts for item in part.missing])
    if any(part.state == "hidden" for part in parts):
        state = "hidden"
    elif any(part.state == "unknown" for part in parts):
        state = "unknown"
    else:
        state = "shown"
    return _Contribution(state, reasons, missing)


def _tag_contribution(annotation: str, mode: str, evaluate: Evaluate) -> _Contribution:
    parts: List[_Contribution] = []
    for item in parse_action_tags(annotation):
        if isinstance(item, _Tag):
            hides = item.name == "HIDDEN" or (item.name == "HIDDEN-SURVEY" and mode == "survey") or (item.name == "HIDDEN-FORM" and mode == "form")
            parts.append(_Contribution("hidden" if hides else "shown", ["@" + item.name] if hides else [], []))
            continue
        condition = evaluate(item.condition)
        if condition.result is True:
            parts.append(_tag_contribution(item.then_text, mode, evaluate))
        elif condition.result is False:
            parts.append(_tag_contribution(item.else_text, mode, evaluate))
        else:
            when_true = _tag_contribution(item.then_text, mode, evaluate)
            when_false = _tag_contribution(item.else_text, mode, evaluate)
            if when_true.state == "shown" and when_false.state == "shown":
                parts.append(_Contribution("shown", [], []))
            elif when_true.state == "hidden" and when_false.state == "hidden":
                parts.append(_combine([when_true, when_false]))
            else:
                parts.append(_Contribution("unknown", ["@IF condition unknown"], condition.missing))
    return _combine(parts)


# ---------------------------------------------------------------------------
# Evaluation
# ---------------------------------------------------------------------------


def _shown() -> VisibilityInfo:
    return VisibilityInfo("shown", [], [])


def _not_in_event() -> VisibilityInfo:
    return VisibilityInfo("hidden", ["form not used in this event"], [])


def _form_used_in_event(model: Model, form_id: str, event: Optional[str]) -> bool:
    """False when an event is chosen and the form is not designated in it (unknown event ids are not held against the form)."""
    if event is None:
        return True
    definition = model.event(event)
    return definition is None or form_id in definition.forms


def _form_node_info(model: Model, node_id: str, context: Context, evaluate: Evaluate) -> VisibilityInfo:
    node = model.form_nodes.get(node_id)
    if node is None:
        return _shown()
    if not _form_used_in_event(model, node.form, context.event):
        return _not_in_event()
    applicable: List[str] = []
    for index, logic in enumerate(node.logic):
        events = node.logic_events[index] if index < len(node.logic_events) else []
        if context.event is None or len(events) == 0 or context.event in events:
            applicable.append(logic)
    # no rule applies in this event: the form is not restricted
    if not applicable:
        return _shown()
    results = [evaluate(logic) for logic in applicable]
    if any(result.result is True for result in results):
        return _shown()
    if all(result.result is False for result in results):
        return VisibilityInfo("hidden", ["form hidden by form display logic"], [])
    return VisibilityInfo(
        "unknown",
        ["form display logic unknown"],
        _unique_inputs([item for result in results if result.result is None for item in result.missing]),
    )


def _field_outcome(
    model: Model, field: FieldInfo, context: Context, evaluate: Evaluate, form_states: Dict[str, VisibilityInfo]
) -> Tuple[VisibilityInfo, bool]:
    """The field's visibility, and whether it is blank (hidden by branching logic or a hidden form, so it cannot hold an answer).

    Action-tag hiding keeps the value: @HIDDEN fields often carry @DEFAULT or calculated values.
    """
    if not _form_used_in_event(model, field.form, context.event):
        return _not_in_event(), True
    parts: List[_Contribution] = []
    form_state = form_states.get("form:" + field.form) if ("form:" + field.form) in model.form_nodes else None
    if form_state is not None and form_state.state != "shown":
        parts.append(_Contribution(form_state.state, list(form_state.reasons), list(form_state.missing)))
    if field.annotation:
        parts.append(_tag_contribution(field.annotation, context.mode, evaluate))
    branching_false = False
    if field.branching and _js_strip(field.branching):
        result = evaluate(field.branching)
        branching_false = result.result is False
        if branching_false:
            parts.append(_Contribution("hidden", ["branching logic false"], []))
        elif result.result is None:
            parts.append(_Contribution("unknown", ["branching logic unknown"], result.missing))
    # once something definitely hides the field, the undecided parts no longer matter: report only what hides it
    hidden_parts = [part for part in parts if part.state == "hidden"]
    combined = _combine(hidden_parts if hidden_parts else parts)
    info = VisibilityInfo(combined.state, _unique(combined.reasons), combined.missing)
    return info, branching_false or (form_state is not None and form_state.state == "hidden")


def smart_key(name: str) -> str:
    """Smart variables are set like fields, under their bracketed name, which keeps the key apart from every REDCap variable name."""
    return "[" + name + "]"


def _event_smart_value(event: EventInfo, name: str) -> Optional[str]:
    """Smart variables that follow from the event the record is viewed in; None for any other name."""
    if name == "event-name":
        return event.id
    if name == "event-label":
        return event.label
    if name == "arm-number":
        return event.arm
    if name == "arm-label":
        return event.arm_name
    return None


def _joined(value: Optional[WhatIfValue]) -> Optional[str]:
    return ",".join(value) if isinstance(value, list) else value


def _make_evaluate(model: Model, context: Context, blank_fields: Set[str]) -> Evaluate:
    def target_event(ref: LogicFieldRef) -> Optional[str]:
        return ref.event or context.event

    def lookup_field(ref: LogicFieldRef) -> Optional[str]:
        target = target_event(ref)
        field = model.fields.get(ref.name)
        is_checkbox = field is not None and field.type == "checkbox"
        blank = "0" if is_checkbox and ref.code else ""
        # REDCap reads a field from an event it is not collected in as blank
        if target is not None and field is not None:
            definition = model.event(target)
            if definition is not None and field.form not in definition.forms:
                return blank
        # a field hidden by branching or form display logic counts as blank, as a participant would experience it
        if target == context.event and ref.name in blank_fields:
            return blank
        value: Optional[WhatIfValue] = None
        if target is not None:
            value = context.values.get(target, {}).get(ref.name)
        if value is None:
            value = context.values.get(ANY_EVENT, {}).get(ref.name)
        if value is None:
            return None
        if ref.code and is_checkbox:
            checked = value if isinstance(value, list) else [_js_strip(code) for code in value.split(",")]
            return "1" if ref.code in checked else "0"
        return _joined(value)

    viewed_event = model.event(context.event)

    def lookup_smart(name: str) -> Optional[str]:
        # the event the record is viewed in answers its own smart variables; anything else is a value the user sets
        if name == "event-name" and context.event is not None:
            return context.event
        if viewed_event is not None:
            derived = _event_smart_value(viewed_event, name)
            if derived is not None:
                return derived
        key = smart_key(name)
        value: Optional[WhatIfValue] = None
        if context.event is not None:
            value = context.values.get(context.event, {}).get(key)
        if value is None:
            value = context.values.get(ANY_EVENT, {}).get(key)
        return _joined(value)

    class _Tracking:
        def __init__(self) -> None:
            self.recorded: List[MissingInput] = []

        def field(self, ref: LogicFieldRef) -> Optional[str]:
            value = lookup_field(ref)
            if value is None:
                self.recorded.append(MissingInput(ref.name, target_event(ref)))
            return value

        def smart(self, name: str) -> Optional[str]:
            value = lookup_smart(name)
            if value is None:
                self.recorded.append(MissingInput(smart_key(name), None))
            return value

    def evaluate(text: str) -> _Tracked:
        tracking = _Tracking()
        result = evaluate_condition(text, tracking).result
        return _Tracked(result, _unique_inputs(tracking.recorded) if result is None else [])

    return evaluate


def evaluate_visibility(model: Model, context: Context) -> Dict[str, VisibilityInfo]:
    """Keys: every field variable in the model, plus every form node id (``form:<form id>``)."""
    return evaluate_visibility_with_blank(model, context)[0]


def evaluate_visibility_with_blank(model: Model, context: Context) -> Tuple[Dict[str, VisibilityInfo], Set[str]]:
    """The visibility of every field and form node, and the fields it treated as blank (hidden by branching logic or a hidden form).

    The blank set lets a caller judge a piece of logic again exactly as it was judged here (TypeScript ``explainLogic``).
    """
    current: Dict[str, VisibilityInfo] = {}
    for variable in model.fields:
        current[variable] = VisibilityInfo("unknown")
    for node_id in model.form_nodes:
        current[node_id] = VisibilityInfo("unknown")

    blank_fields: Set[str] = set()
    for _round in range(MAX_ROUNDS):
        previous = current
        evaluate = _make_evaluate(model, context, blank_fields)
        following: Dict[str, VisibilityInfo] = {}
        next_blank: Set[str] = set()
        for node_id in model.form_nodes:
            following[node_id] = _form_node_info(model, node_id, context, evaluate)
        for variable, field in model.fields.items():
            info, blank = _field_outcome(model, field, context, evaluate, following)
            following[variable] = info
            if blank:
                next_blank.add(variable)
        changed = any(key not in previous or not previous[key].same_as(info) for key, info in following.items())
        current = following
        blank_fields = next_blank
        if not changed:
            break
    return current, blank_fields
