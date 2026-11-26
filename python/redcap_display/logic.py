"""REDCap logic parser and three-valued evaluator.

A port of ``src/lib/logic.ts``. Pure standard library, so it runs under CPython and under Pyodide in the browser.
Values are ``str``, ``float`` or ``bool``; ``None`` means unknown (an input that has not been given).

Wherever Python and JavaScript differ (number-to-text, rounding, whitespace, division by zero) the JavaScript
behaviour is reproduced on purpose, so that both engines give the same answer on the same input.
"""

from __future__ import annotations

import calendar
import datetime
import math
import re
from dataclasses import dataclass
from typing import Callable, List, Optional, Protocol, Tuple, Union

LogicValue = Union[str, float, bool, None]

# ---------------------------------------------------------------------------
# JavaScript-compatible primitives
# ---------------------------------------------------------------------------

# ECMAScript WhiteSpace + LineTerminator, which is what JS `\s` and `String.prototype.trim` use.
_WHITESPACE = "\t\n\u000b\u000c\r                  　﻿"
_WHITESPACE_SET = frozenset(_WHITESPACE)
_WHITESPACE_CLASS = "[" + re.escape(_WHITESPACE) + "]"


def is_space(character: str) -> bool:
    return character in _WHITESPACE_SET


def js_trim(text: str) -> str:
    return text.strip(_WHITESPACE)


def js_number_to_string(number: float) -> str:
    """``String(number)`` as JavaScript prints it: ``1`` not ``1.0``, exponents from 1e21 and below 1e-6."""
    if number != number:
        return "NaN"
    if number == 0:
        return "0"
    if number in (math.inf, -math.inf):
        return "Infinity" if number > 0 else "-Infinity"
    sign = "-" if number < 0 else ""
    shortest = repr(abs(number))
    mantissa, _, exponent_text = shortest.partition("e")
    whole, _, fraction = mantissa.partition(".")
    digits = whole + fraction
    point = len(whole) + (int(exponent_text) if exponent_text else 0)
    stripped = digits.lstrip("0")
    point -= len(digits) - len(stripped)
    digits = stripped.rstrip("0")
    count = len(digits)
    if count <= point <= 21:
        return sign + digits + "0" * (point - count)
    if 0 < point <= 21:
        return sign + digits[:point] + "." + digits[point:]
    if -6 < point <= 0:
        return sign + "0." + "0" * (-point) + digits
    exponent = point - 1
    exponent_part = "e" + ("+" if exponent >= 0 else "-") + str(abs(exponent))
    if count == 1:
        return sign + digits + exponent_part
    return sign + digits[0] + "." + digits[1:] + exponent_part


def _truncate(number: float) -> int:
    """ToIntegerOrInfinity for the arguments of ``slice``: truncate toward zero, huge values clamp harmlessly."""
    if number != number:
        return 0
    if number in (math.inf, -math.inf):
        return 10 ** 18 if number > 0 else -(10 ** 18)
    return int(number)


def _divide(numerator: float, denominator: float) -> float:
    """IEEE division, as JavaScript does it (Python raises on a zero divisor)."""
    if denominator == 0:
        if numerator == 0 or numerator != numerator:
            return math.nan
        negative = (numerator < 0) != (math.copysign(1.0, denominator) < 0)
        return -math.inf if negative else math.inf
    return numerator / denominator


def _power(base: float, exponent: float) -> float:
    try:
        result = base ** exponent
    except (OverflowError, ZeroDivisionError):
        return math.inf  # only finiteness matters to the caller
    return math.nan if isinstance(result, complex) else result


def _js_round_half_up(number: float) -> float:
    """``Math.round`` for a non-negative finite number: ties go up, computed exactly."""
    floor = float(math.floor(number))
    return floor + 1.0 if number - floor >= 0.5 else floor


def _ceil(number: float) -> float:
    return number if not math.isfinite(number) else float(math.ceil(number))


def _floor(number: float) -> float:
    return number if not math.isfinite(number) else float(math.floor(number))


def _strictly_equal(left: LogicValue, right: LogicValue) -> bool:
    """JavaScript ``===``: no coercion, so ``true`` and ``1`` differ, and NaN equals nothing."""
    return type(left) is type(right) and left == right


# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class LogicFieldRef:
    """A field reference as written in logic: ``[name]``, ``[name(code)]``, ``[event][name]``, ``[event][name(code)]``,
    each optionally followed by an instance: ``[name][2]``, ``[event][name][current-instance]``."""

    name: str
    code: str = ""
    event: str = ""
    #: '' (not given), a number as text ('2'), or one of INSTANCE_NAMES ('current-instance', 'first-instance', ...).
    instance: str = ""


#: The smart variables that may follow a field reference to say which repeating instance is meant.
INSTANCE_NAMES = frozenset(["current-instance", "previous-instance", "next-instance", "first-instance", "last-instance"])


class LogicLookup(Protocol):
    """Supplies values to the evaluator. Return ``None`` for unknown."""

    def field(self, ref: LogicFieldRef) -> Optional[str]: ...

    def smart(self, name: str) -> Optional[str]: ...

    # Optionally, a ``today(self) -> Optional[str]`` method returns the date ``"today"`` means, as ``YYYY-MM-DD``
    # (year 1000 to 9999). Without one the system clock's local date is used, so a result depends on when it is computed:
    # inject a date wherever results must be reproducible.


@dataclass(frozen=True)
class _Number:
    value: float


@dataclass(frozen=True)
class _Text:
    value: str


@dataclass(frozen=True)
class _Field:
    ref: LogicFieldRef


@dataclass(frozen=True)
class _Smart:
    name: str


@dataclass(frozen=True)
class _Unary:
    operator: str
    operand: "LogicExpression"


@dataclass(frozen=True)
class _Binary:
    operator: str
    left: "LogicExpression"
    right: "LogicExpression"


@dataclass(frozen=True)
class _Call:
    name: str
    args: tuple


@dataclass(frozen=True)
class _Syntax:
    pass


LogicExpression = Union[_Number, _Text, _Field, _Smart, _Unary, _Binary, _Call, _Syntax]


@dataclass
class LogicResult:
    value: LogicValue
    #: Field names (without event prefix) whose unknown value made the result unknown, in order of appearance.
    missing: List[str]
    #: Constructs that could not be parsed or evaluated (function names, or ``syntax``), deduplicated.
    unsupported: List[str]


@dataclass
class ConditionResult:
    #: True / False, or None when it cannot be decided.
    result: Optional[bool]
    missing: List[str]
    unsupported: List[str]


# ---------------------------------------------------------------------------
# Tokenizer
# ---------------------------------------------------------------------------


class LogicSyntaxError(Exception):
    pass


_FIELD_BRACKET = re.compile(r"([A-Za-z][A-Za-z0-9_]*)(?:\(([^()]*)\))?(?::[A-Za-z_]+)?")
_SMART_BRACKET = re.compile(r"[a-z][a-z0-9]*(?:-[a-z0-9]+)+(?::[^\]]*)?")
_NUMBER_START = re.compile(r"(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][-+]?[0-9]+)?")
_WORD_START = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
_EVENT_ONLY = re.compile(r"\[" + _WHITESPACE_CLASS + r"*([0-9][A-Za-z0-9_]*)" + _WHITESPACE_CLASS + r"*\]\[")
_INSTANCE_NUMBER = re.compile(r"[0-9]+")
_OPERATORS = ["<>", "!=", "<=", ">=", "==", "&&", "||", "=", "<", ">", "+", "-", "*", "/", "^", "!"]

# A token is a tuple: (type, value). Types: number, string, field, smart, word, operator, open, close, comma.
_Token = tuple


def _read_bracket(text: str, position: int):
    close = text.find("]", position)
    if close < 0:
        raise LogicSyntaxError("unclosed bracket")
    inner = js_trim(text[position + 1 : close])
    field_match = _FIELD_BRACKET.fullmatch(inner)
    if field_match:
        return ("field", LogicFieldRef(field_match.group(1), field_match.group(2) or "", "")), close + 1
    if _SMART_BRACKET.fullmatch(inner):
        return ("smart", inner.split(":")[0]), close + 1
    raise LogicSyntaxError("bad bracket")


def _read_instance(text: str, position: int):
    """An instance bracket straight after a field reference: ``[2]`` or ``[current-instance]``. Returns (instance, end), or ('', position)."""
    if position < len(text) and text[position] == "[":
        close = text.find("]", position)
        if close >= 0:
            inner = js_trim(text[position + 1 : close])
            if _INSTANCE_NUMBER.fullmatch(inner) or inner in INSTANCE_NAMES:
                return inner, close + 1
    return "", position


def _tokenize(text: str) -> List[_Token]:
    tokens: List[_Token] = []
    position = 0
    length = len(text)
    while position < length:
        character = text[position]
        if is_space(character):
            position += 1
            continue
        if character == "[":
            # unique event names may start with a digit; variable names cannot, so `[12_months_arm_1][x]` is an event prefix
            event_only = _EVENT_ONLY.match(text, position)
            if event_only:
                second, end = _read_bracket(text, event_only.end() - 1)
                if second[0] != "field" or second[1].event:
                    raise LogicSyntaxError("bad event prefix")
                ref = second[1]
                instance, end = _read_instance(text, end)
                tokens.append(("field", LogicFieldRef(ref.name, ref.code, event_only.group(1), instance)))
                position = end
                continue
            first, position = _read_bracket(text, position)
            if first[0] == "field":
                # `[name][2]`: an instance follows the reference
                instance, after = _read_instance(text, position)
                if instance:
                    ref = first[1]
                    tokens.append(("field", LogicFieldRef(ref.name, ref.code, "", instance)))
                    position = after
                    continue
            if first[0] == "field" and position < length and text[position] == "[":
                # Two adjacent field brackets: the first is the event prefix.
                second, end = _read_bracket(text, position)
                if second[0] == "field" and first[1].code == "":
                    ref = second[1]
                    instance, end = _read_instance(text, end)
                    tokens.append(("field", LogicFieldRef(ref.name, ref.code, first[1].name, instance)))
                    position = end
                    continue
            tokens.append(first)
            continue
        if character in "\"'":
            value = ""
            index = position + 1
            closed = False
            while index < length:
                following = text[index]
                if following == "\\" and index + 1 < length:
                    value += text[index + 1]
                    index += 2
                elif following == character:
                    closed = True
                    index += 1
                    break
                else:
                    value += following
                    index += 1
            if not closed:
                raise LogicSyntaxError("unclosed string")
            tokens.append(("string", value))
            position = index
            continue
        number_match = _NUMBER_START.match(text, position)
        if number_match:
            tokens.append(("number", float(number_match.group(0))))
            position = number_match.end()
            continue
        word_match = _WORD_START.match(text, position)
        if word_match:
            tokens.append(("word", word_match.group(0)))
            position = word_match.end()
            continue
        if character == "(":
            tokens.append(("open", None))
            position += 1
            continue
        if character == ")":
            tokens.append(("close", None))
            position += 1
            continue
        if character == ",":
            tokens.append(("comma", None))
            position += 1
            continue
        operator = next((candidate for candidate in _OPERATORS if text.startswith(candidate, position)), None)
        if operator is None:
            raise LogicSyntaxError("unexpected character")
        tokens.append(("operator", operator))
        position += len(operator)
    return tokens


# ---------------------------------------------------------------------------
# Parser (recursive descent). or < and < not < comparison < additive < multiplicative < power < unary
# ---------------------------------------------------------------------------


class _Parser:
    def __init__(self, tokens: List[_Token]) -> None:
        self._tokens = tokens
        self._index = 0

    def parse_all(self) -> LogicExpression:
        expression = self._parse_or()
        if self._index < len(self._tokens):
            raise LogicSyntaxError("trailing tokens")
        return expression

    def _peek(self) -> Optional[_Token]:
        return self._tokens[self._index] if self._index < len(self._tokens) else None

    def _is_operator(self, *values: str) -> Optional[str]:
        token = self._peek()
        if token and token[0] == "operator" and token[1] in values:
            return token[1]
        return None

    def _is_word(self, *values: str) -> Optional[str]:
        token = self._peek()
        if token and token[0] == "word" and token[1].lower() in values:
            return token[1].lower()
        return None

    def _parse_or(self) -> LogicExpression:
        left = self._parse_and()
        while self._is_word("or") or self._is_operator("||"):
            self._index += 1
            left = _Binary("or", left, self._parse_and())
        return left

    def _parse_and(self) -> LogicExpression:
        left = self._parse_not()
        while self._is_word("and") or self._is_operator("&&"):
            self._index += 1
            left = _Binary("and", left, self._parse_not())
        return left

    def _parse_not(self) -> LogicExpression:
        if self._is_word("not") or self._is_operator("!"):
            self._index += 1
            return _Unary("not", self._parse_not())
        return self._parse_comparison()

    def _parse_comparison(self) -> LogicExpression:
        left = self._parse_additive()
        while True:
            operator = self._is_operator("=", "==", "<>", "!=", "<", ">", "<=", ">=")
            if not operator:
                return left
            self._index += 1
            normalized = "=" if operator == "==" else "<>" if operator == "!=" else operator
            left = _Binary(normalized, left, self._parse_additive())

    def _parse_additive(self) -> LogicExpression:
        left = self._parse_multiplicative()
        while True:
            operator = self._is_operator("+", "-")
            if not operator:
                return left
            self._index += 1
            left = _Binary(operator, left, self._parse_multiplicative())

    def _parse_multiplicative(self) -> LogicExpression:
        left = self._parse_power()
        while True:
            operator = self._is_operator("*", "/")
            if not operator:
                return left
            self._index += 1
            left = _Binary(operator, left, self._parse_power())

    def _parse_power(self) -> LogicExpression:
        left = self._parse_unary()
        while self._is_operator("^"):
            self._index += 1
            left = _Binary("^", left, self._parse_unary())
        return left

    def _parse_unary(self) -> LogicExpression:
        operator = self._is_operator("-", "+")
        if operator:
            self._index += 1
            return _Unary(operator, self._parse_unary())
        return self._parse_primary()

    def _parse_primary(self) -> LogicExpression:
        token = self._peek()
        if token is None:
            raise LogicSyntaxError("unexpected end")
        self._index += 1
        kind, value = token
        if kind == "number":
            return _Number(value)
        if kind == "string":
            return _Text(value)
        if kind == "field":
            return _Field(value)
        if kind == "smart":
            return _Smart(value)
        if kind == "open":
            inner = self._parse_or()
            following = self._peek()
            if following is None or following[0] != "close":
                raise LogicSyntaxError("expected )")
            self._index += 1
            return inner
        if kind == "word":
            following = self._peek()
            if following is None or following[0] != "open":
                lowered = value.lower()
                if lowered in ("true", "false"):
                    return _Number(1.0 if lowered == "true" else 0.0)
                raise LogicSyntaxError("bare word")
            self._index += 1
            args: List[LogicExpression] = []
            following = self._peek()
            if following is not None and following[0] == "close":
                self._index += 1
            else:
                while True:
                    args.append(self._parse_or())
                    separator = self._peek()
                    self._index += 1
                    if separator is not None and separator[0] == "comma":
                        continue
                    if separator is not None and separator[0] == "close":
                        break
                    raise LogicSyntaxError("bad argument list")
            return _Call(value.lower(), tuple(args))
        raise LogicSyntaxError("unexpected token")


def parse_logic(text: str) -> LogicExpression:
    """Parse REDCap logic. Never raises: unparseable input yields an expression that evaluates to unknown, unsupported ``syntax``."""
    try:
        return _Parser(_tokenize(text)).parse_all()
    except LogicSyntaxError:
        return _Syntax()


# ---------------------------------------------------------------------------
# Evaluator
# ---------------------------------------------------------------------------

_UNSUPPORTED = object()

_NUMERIC_TEXT = re.compile(r"[-+]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][-+]?[0-9]+)?")
_INTEGER_TEXT = re.compile(r"[-+]?[0-9]+")


def _to_text(value: LogicValue) -> str:
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, float):
        return js_number_to_string(value)
    return value  # type: ignore[return-value]


def _is_blank(text: str) -> bool:
    return js_trim(text) == ""


def _is_numeric_text(text: str) -> bool:
    trimmed = js_trim(text)
    return _NUMERIC_TEXT.fullmatch(trimmed) is not None and math.isfinite(float(trimmed))


def _to_truth(value: LogicValue) -> Optional[bool]:
    """Truthiness: '' and '0' are false, numeric strings by value, other strings true."""
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, float):
        return value != 0
    if js_trim(value) == "":
        return False
    if _is_numeric_text(value):
        return float(js_trim(value)) != 0
    return True


def _to_number(value: LogicValue) -> Optional[float]:
    """A number for arithmetic, or None when the value is blank / not numeric."""
    if value is None:
        return None
    text = _to_text(value)
    return float(js_trim(text)) if _is_numeric_text(text) else None


def _compare_values(operator: str, left: str, right: str) -> bool:
    if _is_numeric_text(left) and _is_numeric_text(right):
        a = float(js_trim(left))
        b = float(js_trim(right))
        if operator == "=":
            return a == b
        if operator == "<>":
            return a != b
        if operator == "<":
            return a < b
        if operator == ">":
            return a > b
        if operator == "<=":
            return a <= b
        return a >= b
    if operator == "=":
        return left == right
    if operator == "<>":
        return left != right
    # A blank side never satisfies an ordering comparison, so `[age] >= 18` with a blank age is false (not unknown).
    if _is_blank(left) or _is_blank(right):
        return False
    if operator == "<":
        return left < right
    if operator == ">":
        return left > right
    if operator == "<=":
        return left <= right
    return left >= right


def _round_to(value: float, digits: float, mode: str) -> float:
    factor = _power(10.0, digits)
    product = value * factor
    scaled = float("%.15g" % product) if math.isfinite(product) else product
    if mode == "up":
        return _divide(_ceil(scaled), factor)
    if mode == "down":
        return _divide(_floor(scaled), factor)
    if scaled != scaled:
        return scaled
    magnitude = _js_round_half_up(abs(scaled)) if math.isfinite(scaled) else abs(scaled)
    sign = 0.0 if scaled == 0 else (1.0 if scaled > 0 else -1.0)
    return _divide(sign * magnitude, factor)


#: What ``"today"`` means: milliseconds since the epoch (UTC) of a date.
Today = Callable[[], int]

_INJECTED_TODAY = re.compile(r"([0-9]{4})-([0-9]{2})-([0-9]{2})")


def _parse_injected_today(text: str) -> int:
    """Milliseconds since the epoch (UTC) of an injected ``today``; raises on anything but a real calendar date from year 1000 to 9999."""
    match = _INJECTED_TODAY.fullmatch(text)
    if match:
        year, month, day = int(match.group(1)), int(match.group(2)), int(match.group(3))
        if year >= 1000 and 1 <= month <= 12 and 1 <= day <= calendar.monthrange(year, month)[1]:
            return _days_from_civil(year, month, day) * 86400000
    raise ValueError('today must be a calendar date written YYYY-MM-DD (year 1000 to 9999), not "%s"' % text)


def _today_of(lookup: LogicLookup) -> Today:
    """The injected date when the lookup supplies one (its ``today()``), else the system clock's local date."""

    def today() -> int:
        supply = getattr(lookup, "today", None)
        injected = supply() if supply is not None else None
        if injected is not None:
            return _parse_injected_today(injected)
        now = datetime.date.today()
        return _days_from_civil(now.year, now.month, now.day) * 86400000

    return today


def _days_from_civil(year: int, month: int, day: int) -> int:
    """Days since 1970-01-01 of a proleptic Gregorian date; ``day`` may overflow the month, as in ``Date.UTC``."""
    year -= month <= 2
    era = year // 400
    year_of_era = year - era * 400
    day_of_year = (153 * (month + (-3 if month > 2 else 9)) + 2) // 5
    day_of_era = year_of_era * 365 + year_of_era // 4 - year_of_era // 100 + day_of_year
    return era * 146097 + day_of_era - 719468 + (day - 1)


_DATE = re.compile(
    r"([0-9]{1,4})[-/]([0-9]{1,2})[-/]([0-9]{1,4})(?:[ t]([0-9]{1,2}):([0-9]{2})(?::([0-9]{2}))?)?"
)


def _parse_date(text: str, date_format: str, today: Today) -> Optional[int]:
    """A date as milliseconds since the epoch (UTC), or None."""
    trimmed = js_trim(text).lower()
    if trimmed == "today":
        return today()
    match = _DATE.fullmatch(trimmed)
    if not match:
        return None
    first, second, third = int(match.group(1)), int(match.group(2)), int(match.group(3))
    year, month, day = first, second, third
    if date_format.startswith("dmy"):
        day, month, year = first, second, third
    elif date_format.startswith("mdy"):
        month, day, year = first, second, third
    if month < 1 or month > 12 or day < 1 or day > 31:
        return None
    if 0 <= year <= 99:
        year += 1900  # Date.UTC maps two-digit years to the 1900s
    hours = int(match.group(4) or 0)
    minutes = int(match.group(5) or 0)
    seconds = int(match.group(6) or 0)
    return _days_from_civil(year, month, day) * 86400000 + hours * 3600000 + minutes * 60000 + seconds * 1000


_UNIT_MILLISECONDS = {
    "y": 365.2425 * 86400000,
    "M": 30.44 * 86400000,
    "d": 86400000.0,
    "h": 3600000.0,
    "m": 60000.0,
    "s": 1000.0,
}


def _evaluate_date_difference(args: List[LogicValue], today: Today) -> LogicValue:
    if len(args) < 3:
        return ""
    date_format = "ymd"
    signed = False
    for extra in args[3:]:
        lowered = _to_text(extra).lower()
        if lowered in ("true", "1"):
            signed = True
        elif lowered in ("false", "0"):
            signed = False
        else:
            date_format = lowered
    unit_size = _UNIT_MILLISECONDS.get(_to_text(args[2]))
    if unit_size is None:
        return ""
    start = _parse_date(_to_text(args[0]), date_format, today)
    end = _parse_date(_to_text(args[1]), date_format, today)
    if start is None or end is None:
        return ""
    difference = (end - start) / unit_size
    return difference if signed else abs(difference)


def _sum_of(numbers: List[float]) -> float:
    total = 0.0
    for number in numbers:  # a plain left-to-right loop: Python's sum() may compensate and differ from JavaScript
        total += number
    return total


def _utf16_length(text: str) -> int:
    return len(text.encode("utf-16-le")) // 2


def _evaluate_call(name: str, args: List[LogicValue], today: Today):
    def text_at(index: int) -> str:
        return _to_text(args[index]) if index < len(args) and args[index] is not None else ""

    def numeric_arguments() -> List[float]:
        found: List[float] = []
        for value in args:
            number = _to_number(value)
            if number is not None:
                found.append(number)
        return found

    first = _to_number(args[0]) if args else None
    digits = (_to_number(args[1]) if len(args) > 1 else None) or 0.0
    if name == "sum":
        return _sum_of(numeric_arguments())
    if name in ("min", "max"):
        found = numeric_arguments()
        if not found:
            return ""
        return min(found) if name == "min" else max(found)
    if name == "mean":
        found = numeric_arguments()
        return _divide(_sum_of(found), float(len(found))) if found else ""
    if name == "round":
        return "" if first is None else _round_to(first, digits, "half")
    if name == "roundup":
        return "" if first is None else _round_to(first, digits, "up")
    if name == "rounddown":
        return "" if first is None else _round_to(first, digits, "down")
    if name == "abs":
        return "" if first is None else abs(first)
    if name == "sqrt":
        return "" if first is None or first < 0 else math.sqrt(first)
    if name == "datediff":
        return _evaluate_date_difference(args, today)
    if name == "isnumber":
        return _is_numeric_text(text_at(0))
    if name == "isinteger":
        return _INTEGER_TEXT.fullmatch(js_trim(text_at(0))) is not None
    if name == "isblankormissingcode":
        return _is_blank(text_at(0))
    if name == "contains":
        return text_at(1) in text_at(0)
    if name == "not_contain":
        return text_at(1) not in text_at(0)
    if name == "starts_with":
        return text_at(0).startswith(text_at(1))
    if name == "ends_with":
        return text_at(0).endswith(text_at(1))
    if name == "length":
        return float(_utf16_length(text_at(0)))
    if name == "left":
        return text_at(0)[0 : _truncate(max(0.0, digits))]
    if name == "right":
        return text_at(0)[_truncate(-digits) :] if digits > 0 else ""
    if name == "mid":
        start = _to_number(args[1]) if len(args) > 1 else None
        count = _to_number(args[2]) if len(args) > 2 else None
        begin = max(0.0, (1.0 if start is None else start) - 1)
        return text_at(0)[_truncate(begin) : _truncate(begin + max(0.0, 0.0 if count is None else count))]
    if name == "concat":
        return "".join(_to_text(value) for value in args)
    if name == "lower":
        return text_at(0).lower()
    if name == "upper":
        return text_at(0).upper()
    if name == "trim":
        return js_trim(text_at(0))
    return _UNSUPPORTED


def _evaluate_binary(operator: str, left: LogicValue, right: LogicValue) -> LogicValue:
    if operator in ("and", "or"):
        a = _to_truth(left)
        b = _to_truth(right)
        decisive = operator == "or"
        if a is decisive or b is decisive:
            return decisive
        if a is None or b is None:
            return None
        return not decisive
    if left is None or right is None:
        return None
    if operator in ("+", "-", "*", "/", "^"):
        a = _to_number(left)
        b = _to_number(right)
        if a is None or b is None:
            return ""
        if operator == "+":
            result = a + b
        elif operator == "-":
            result = a - b
        elif operator == "*":
            result = a * b
        elif operator == "/":
            result = _divide(a, b)
        else:
            result = _power(a, b)
        return result if math.isfinite(result) else ""
    return _compare_values(operator, _to_text(left), _to_text(right))


class _EvaluationContext:
    def __init__(self, lookup: LogicLookup) -> None:
        self.lookup = lookup
        self.missing: List[str] = []
        self.unsupported: List[str] = []

    def mark_unsupported(self, name: str) -> None:
        if name not in self.unsupported:
            self.unsupported.append(name)


def _evaluate_node(node: LogicExpression, context: _EvaluationContext) -> LogicValue:
    if isinstance(node, (_Number, _Text)):
        return node.value
    if isinstance(node, _Syntax):
        context.mark_unsupported("syntax")
        return None
    if isinstance(node, _Field):
        value = context.lookup.field(node.ref)
        if value is None and node.ref.name not in context.missing:
            context.missing.append(node.ref.name)
        return value
    if isinstance(node, _Smart):
        return context.lookup.smart(node.name)
    if isinstance(node, _Unary):
        operand = _evaluate_node(node.operand, context)
        if operand is None:
            return None
        if node.operator == "not":
            truth = _to_truth(operand)
            return None if truth is None else not truth
        number = _to_number(operand)
        if number is None:
            return ""
        return -number if node.operator == "-" else number
    if isinstance(node, _Binary):
        left = _evaluate_node(node.left, context)
        right = _evaluate_node(node.right, context)
        return _evaluate_binary(node.operator, left, right)
    if isinstance(node, _Call):
        values = [_evaluate_node(argument, context) for argument in node.args]
        if node.name == "if":
            if len(values) != 3:
                context.mark_unsupported("if")
                return None
            condition = _to_truth(values[0])
            if condition is True:
                return values[1]
            if condition is False:
                return values[2]
            # Unknown condition: still decided when both branches agree.
            return values[1] if values[1] is not None and _strictly_equal(values[1], values[2]) else None
        # Probe with no arguments to learn whether the function name is known at all.
        today = _today_of(context.lookup)
        if _evaluate_call(node.name, [], today) is _UNSUPPORTED:
            context.mark_unsupported(node.name)
            return None
        if any(value is None for value in values):
            return None
        return _evaluate_call(node.name, values, today)
    raise TypeError("unknown node")


def evaluate_logic(expression: LogicExpression, lookup: LogicLookup) -> LogicResult:
    """Evaluate a parsed expression with Kleene three-valued logic."""
    context = _EvaluationContext(lookup)
    value = _evaluate_node(expression, context)
    return LogicResult(value, context.missing if value is None else [], list(context.unsupported))


def evaluate_condition(text: str, lookup: LogicLookup) -> ConditionResult:
    """Parse and evaluate ``text`` as a condition. Empty / whitespace-only text is true (no condition)."""
    if js_trim(text) == "":
        return ConditionResult(True, [], [])
    outcome = evaluate_logic(parse_logic(text), lookup)
    return ConditionResult(_to_truth(outcome.value), outcome.missing, outcome.unsupported)


def evaluate_value(text: str, lookup: LogicLookup) -> Tuple[Optional[str], List[str]]:
    """Parse and evaluate ``text`` as an expression (a calculation).

    Returns its value as text (a number as JavaScript prints it; blank text when the inputs are blank or not numbers), or None when
    it cannot be decided yet, and the constructs that could not be evaluated.
    """
    outcome = evaluate_logic(parse_logic(text), lookup)
    return (None if outcome.value is None else _to_text(outcome.value)), outcome.unsupported


_BRACKET_RUN = re.compile(r"(?:\[[^\[\]]*\])+")


def piped_text_expression(text: str) -> str:
    """Text with ``[field]`` references in it (piping, as in ``@DEFAULT='ID-[event][field]'``) as an expression that builds it:
    ``concat("ID-", [event][field])``.

    Evaluating that with the ordinary evaluator pipes the values in, and an input that is not known makes the whole text unknown, so
    event prefixes, smart variables and missing-input tracking all behave as in any other logic.
    """

    def quote(literal: str) -> str:
        return '"' + literal.replace("\\", "\\\\").replace('"', '\\"') + '"'

    pieces: List[str] = []
    end = 0
    for match in _BRACKET_RUN.finditer(text):
        if match.start() > end:
            pieces.append(quote(text[end : match.start()]))
        pieces.append(match.group(0))
        end = match.end()
    if end < len(text):
        pieces.append(quote(text[end:]))
    return "concat(" + ", ".join(pieces) + ")"
