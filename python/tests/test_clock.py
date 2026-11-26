"""The injected clock: what "today" means in logic is a parameter, not the machine's date."""

import datetime
import unittest

from redcap_display import Engine, evaluate_condition


class _Lookup:
    def __init__(self, today=None):
        self._today = today

    def field(self, ref):
        return None

    def smart(self, name):
        return None

    def today(self):
        return self._today


class _LookupWithoutToday:
    def field(self, ref):
        return None

    def smart(self, name):
        return None


def days_between(start, today):
    return evaluate_condition('datediff("%s", "today", "d") = 0' % start, _Lookup(today)).result


class InjectedClock(unittest.TestCase):
    def test_today_is_the_injected_date(self):
        self.assertIs(days_between("2021-06-15", "2021-06-15"), True)
        self.assertIs(days_between("2021-06-15", "2021-06-16"), False)

    def test_leap_day_and_century_end(self):
        self.assertIs(days_between("2024-02-29", "2024-02-29"), True)
        self.assertIs(days_between("1999-12-31", "1999-12-31"), True)
        self.assertIs(evaluate_condition('datediff("2024-02-28", "today", "d") = 1', _Lookup("2024-02-29")).result, True)

    def test_without_an_injected_date_the_system_clock_is_used(self):
        today = datetime.date.today().isoformat()
        for lookup in (_Lookup(None), _LookupWithoutToday()):
            self.assertIs(evaluate_condition('datediff("%s", "today", "d") = 0' % today, lookup).result, True)

    def test_a_bad_injected_date_is_an_error_not_a_silent_fallback(self):
        for bad in ("2021-02-30", "2021-13-01", "21-06-15", "2021/06/15", "0999-01-01", "2021-6-5", "today", ""):
            with self.assertRaises(ValueError, msg=bad):
                evaluate_condition('datediff("2020-01-01", "today", "d")', _Lookup(bad))

    def test_the_engine_takes_today_in_its_context(self):
        parsed = {
            "forms": [{"id": "f"}],
            "fields": [
                {"variable": "dob", "type": "text", "form": "f", "branching": "", "annotation": ""},
                {"variable": "adult", "type": "text", "form": "f", "branching": 'datediff([dob], "today", "y") >= 18', "annotation": ""},
            ],
            "formLogic": [],
            "events": [],
        }
        engine = Engine(parsed)
        context = {"values": {"": {"dob": "2005-06-15"}}}
        # datediff counts a year as 365.2425 days, so the 18th birthday is reached a day or two after the calendar one
        self.assertEqual(engine.evaluate(dict(context, today="2023-06-14"))["adult"]["state"], "hidden")
        self.assertEqual(engine.evaluate(dict(context, today="2023-06-17"))["adult"]["state"], "shown")


if __name__ == "__main__":
    unittest.main()
