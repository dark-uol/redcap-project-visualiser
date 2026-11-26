"""Repeating instruments and events: references to instances, and visibility per instance.

There is no TypeScript reference for these (the TypeScript engine has no instances), so these tests are the specification, written as
examples. The semantics follow REDCap's documented behaviour as understood so far and have not yet been checked against REDCap itself.
"""

import json
import unittest

from redcap_display import Engine
from redcap_display.logic import LogicFieldRef, parse_logic

EVENT = "baseline_arm_1"


def field(variable, form, branching="", annotation="", type="text"):
    return {"variable": variable, "type": type, "form": form, "branching": branching, "annotation": annotation}


def project(fields, forms=("demo", "visit"), repeating_instruments=(("visit", EVENT),), events=None):
    return {
        "forms": [{"id": form} for form in forms],
        "fields": fields,
        "formLogic": [],
        "events": events if events is not None else [{"id": EVENT, "label": "Baseline", "arm": "1", "armName": "Arm 1", "forms": list(forms)}],
        "repeatingInstruments": [{"form": form, "event": event} for form, event in repeating_instruments],
    }


def states(engine, context):
    return {key: info["state"] for key, info in engine.evaluate(context).items()}


class InstanceReferences(unittest.TestCase):
    def ref(self, text):
        return parse_logic(text).ref

    def test_an_instance_may_follow_a_field_reference(self):
        self.assertEqual(self.ref("[a][1]"), LogicFieldRef("a", "", "", "1"))
        self.assertEqual(self.ref("[a][ 12 ]"), LogicFieldRef("a", "", "", "12"))
        self.assertEqual(self.ref("[a(2)][current-instance]"), LogicFieldRef("a", "2", "", "current-instance"))

    def test_an_event_prefix_and_an_instance_combine(self):
        self.assertEqual(self.ref("[ev][a][3]"), LogicFieldRef("a", "", "ev", "3"))
        self.assertEqual(self.ref("[12_months_arm_1][a][first-instance]"), LogicFieldRef("a", "", "12_months_arm_1", "first-instance"))

    def test_the_five_instance_names_are_understood(self):
        for name in ("current-instance", "previous-instance", "next-instance", "first-instance", "last-instance"):
            self.assertEqual(self.ref("[a][%s]" % name).instance, name)

    def test_without_an_instance_a_reference_is_what_it_always_was(self):
        self.assertEqual(self.ref("[a][b]"), LogicFieldRef("b", "", "a", ""))
        self.assertEqual(self.ref("[a]"), LogicFieldRef("a"))

    def test_an_instance_must_directly_follow_the_reference(self):
        self.assertEqual(type(parse_logic("[a][1][b]")).__name__, "_Syntax")


class RepeatingInstrument(unittest.TestCase):
    """A repeating form (`visit`) in a non-repeating event, with three instances."""

    FIELDS = [
        field("age", "demo"),
        field("demo_flag", "demo", "[symptom] = '1'"),  # a non-repeating field reading a repeating one
        field("symptom", "visit"),
        field("symptom_detail", "visit", "[symptom] = '1'"),
        field("depends", "visit", "[symptom_detail] <> 'x'"),
        field("adult_note", "visit", "[age] >= 18"),  # a repeating field reading a non-repeating one
        field("prev_check", "visit", "[symptom][previous-instance] = '1'"),
        field("next_check", "visit", "[symptom][next-instance] = '1'"),
        field("first_check", "visit", "[symptom][first-instance] = '1'"),
        field("last_check", "visit", "[symptom][last-instance] = '1'"),
        field("explicit_two", "visit", "[symptom][2] = '1'"),
        field("explicit_nine", "visit", "[symptom][9] = '1'"),
        field("current_number", "visit", "[current-instance] = 2"),
        field("current_symptom", "visit", "[symptom][current-instance] = '1'"),
    ]
    CONTEXT = {
        "event": EVENT,
        "values": {EVENT: {"age": "30"}},
        "instances": {
            EVENT: {
                "visit": {
                    "1": {"symptom": "1", "symptom_detail": "x"},
                    "2": {"symptom": "0", "symptom_detail": "x"},
                    "3": {"symptom": "1", "symptom_detail": "y"},
                }
            }
        },
    }

    def setUp(self):
        self.engine = Engine(project(self.FIELDS))
        self.result = states(self.engine, self.CONTEXT)

    def of(self, variable):
        return [self.result["%s#%d" % (variable, number)] for number in (1, 2, 3)]

    def test_a_field_of_a_repeating_form_has_a_result_per_instance(self):
        self.assertEqual(self.of("symptom_detail"), ["shown", "hidden", "shown"])
        self.assertNotIn("symptom_detail", self.result)
        self.assertEqual(self.of("visit_complete"), ["shown", "shown", "shown"])

    def test_other_fields_keep_their_plain_key(self):
        self.assertEqual(self.result["age"], "shown")
        self.assertIn("demo_complete", self.result)

    def test_a_field_hidden_in_one_instance_reads_blank_only_there(self):
        # 'depends' shows when symptom_detail is not 'x': in instance 2 symptom_detail is hidden, so it reads blank and 'depends' shows
        self.assertEqual(self.of("depends"), ["hidden", "shown", "shown"])

    def test_previous_and_next_instance(self):
        self.assertEqual(self.of("prev_check"), ["hidden", "shown", "hidden"])  # nothing before the first instance
        self.assertEqual(self.of("next_check"), ["hidden", "shown", "hidden"])  # nothing after the last one

    def test_first_and_last_instance(self):
        self.assertEqual(self.of("first_check"), ["shown", "shown", "shown"])
        self.assertEqual(self.of("last_check"), ["shown", "shown", "shown"])

    def test_a_numbered_instance(self):
        self.assertEqual(self.of("explicit_two"), ["hidden", "hidden", "hidden"])  # instance 2 has symptom 0

    def test_an_instance_that_does_not_exist_reads_as_blank(self):
        self.assertEqual(self.of("explicit_nine"), ["hidden", "hidden", "hidden"])

    def test_the_current_instance_number_and_current_instance_reference(self):
        self.assertEqual(self.of("current_number"), ["hidden", "shown", "hidden"])
        self.assertEqual(self.of("current_symptom"), ["shown", "hidden", "shown"])

    def test_a_repeating_field_reads_a_non_repeating_one(self):
        self.assertEqual(self.of("adult_note"), ["shown", "shown", "shown"])

    def test_a_non_repeating_field_reading_a_repeating_one_without_an_instance_reads_the_first(self):
        self.assertEqual(self.result["demo_flag"], "shown")  # instance 1 has symptom 1

    def test_an_instance_with_nothing_set_is_unknown_and_names_what_is_missing(self):
        context = {"event": EVENT, "values": {EVENT: {"age": "30"}}, "instances": {EVENT: {"visit": {"1": {}}}}}
        info = self.engine.evaluate(context)["symptom_detail#1"]
        self.assertEqual(info["state"], "unknown")
        self.assertEqual(info["missing"], [{"variable": "symptom", "event": EVENT, "instance": 1}])

    def test_results_serialise_to_json_with_string_keys_in_and_out(self):
        text = json.dumps(self.CONTEXT)
        self.assertEqual(json.loads(self.engine.evaluate_json(text))["results"]["symptom_detail#2"]["state"], "hidden")


class WithoutInstances(unittest.TestCase):
    """A context with no instances behaves as it always did, repeating form or not."""

    def test_one_result_per_field_and_values_are_read_from_values(self):
        engine = Engine(project(RepeatingInstrument.FIELDS))
        result = engine.evaluate({"event": EVENT, "values": {EVENT: {"symptom": "1", "symptom_detail": "x", "age": "30"}}})
        self.assertEqual(result["symptom_detail"]["state"], "shown")
        self.assertNotIn("symptom_detail#1", result)

    def test_an_instance_reference_cannot_be_read_and_is_unknown(self):
        engine = Engine(project(RepeatingInstrument.FIELDS))
        result = engine.evaluate({"event": EVENT, "values": {EVENT: {"symptom": "1"}}})
        self.assertEqual(result["explicit_two"]["state"], "unknown")


class OtherRepeatingShapes(unittest.TestCase):
    def test_a_repeating_event_shares_its_instance_numbers_across_its_forms(self):
        events = [{"id": "visit_ev", "label": "Visit", "arm": "1", "armName": "Arm 1", "forms": ["form_a", "form_b"], "repeating": True}]
        engine = Engine(
            project(
                [field("a", "form_a"), field("b", "form_b", "[a] = '1'")],
                forms=("form_a", "form_b"),
                repeating_instruments=(),
                events=events,
            )
        )
        context = {
            "event": "visit_ev",
            "values": {},
            "instances": {"visit_ev": {"form_a": {"1": {"a": "1"}, "2": {"a": "0"}}, "form_b": {"1": {"b": ""}, "2": {"b": ""}}}},
        }
        result = states(engine, context)
        self.assertEqual([result["b#1"], result["b#2"]], ["shown", "hidden"])

    def test_two_repeating_instruments_in_one_event_number_their_instances_separately(self):
        engine = Engine(
            project(
                [field("x", "form_x"), field("y", "form_y"), field("z", "form_x", "[y] = '1'")],
                forms=("form_x", "form_y"),
                repeating_instruments=(("form_x", EVENT), ("form_y", EVENT)),
            )
        )
        context = {
            "event": EVENT,
            "values": {},
            "instances": {EVENT: {"form_x": {"1": {"x": "a"}, "2": {"x": "b"}}, "form_y": {"1": {"y": "1"}, "2": {"y": "0"}}}},
        }
        result = states(engine, context)
        # z is in form_x; [y] is in another repeating instrument, so it is not tied to z's instance: it reads y's first instance
        self.assertEqual([result["z#1"], result["z#2"]], ["shown", "shown"])

    def test_a_form_that_repeats_only_in_some_events(self):
        events = [
            {"id": "e1", "label": "E1", "arm": "1", "armName": "A", "forms": ["demo", "visit"]},
            {"id": "e2", "label": "E2", "arm": "1", "armName": "A", "forms": ["demo", "visit"]},
        ]
        engine = Engine(project([field("symptom", "visit"), field("detail", "visit", "[symptom] = '1'")], repeating_instruments=(("visit", "e2"),), events=events))
        values = {"e1": {"symptom": "1"}}
        in_e1 = states(engine, {"event": "e1", "values": values})
        self.assertEqual(in_e1["detail"], "shown")  # not repeating in e1: one plain result
        in_e2 = states(engine, {"event": "e2", "values": {}, "instances": {"e2": {"visit": {"1": {"symptom": "0"}, "2": {"symptom": "1"}}}}})
        self.assertEqual([in_e2["detail#1"], in_e2["detail#2"]], ["hidden", "shown"])


if __name__ == "__main__":
    unittest.main()
