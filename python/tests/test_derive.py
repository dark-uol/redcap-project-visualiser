"""Derived values: a calculated field, or a field with a top-level @DEFAULT, takes its value from its inputs when none is set.

The TypeScript engine is the reference (test/derive.test.ts and the parity vectors); these check the same behaviours on the Python
port directly. The chain is the public NHS number modulus-11 check, written from the algorithm with its own field names.
"""

import unittest

from redcap_display import Engine
from redcap_display.logic import piped_text_expression
from redcap_display.visibility import top_level_default

VALID = "9434765919"
INVALID = "9434765918"  # the same number with a wrong check digit
WEIGHTED_SUM = " + ".join("(mid([nhs_copy],%d,1)*%d)" % (position, 11 - position) for position in range(1, 10))


def field(variable, form, branching="", annotation="", calc=""):
    return {"variable": variable, "type": "calc" if calc else "text", "form": form, "branching": branching, "annotation": annotation, "calc": calc}


def calculated(variable, form, calc):
    return field(variable, form, annotation="@HIDDEN", calc=calc)


FIELDS = [
    field("nhs_entered", "f_reg"),
    field("nhs_copy", "f_cons", annotation="@CHARLIMIT=10 @DEFAULT='[registration][nhs_entered]'"),
    calculated("nhs_sum", "f_cons", WEIGHTED_SUM),
    calculated("nhs_quotient", "f_cons", "rounddown(([nhs_sum] / 11),0)"),
    calculated("nhs_remainder", "f_cons", "[nhs_sum] - ([nhs_quotient] * 11)"),
    calculated("nhs_check", "f_cons", "11 - [nhs_remainder]"),
    calculated("nhs_last", "f_cons", "mid([nhs_copy],10,1)"),
    calculated("nhs_valid", "f_cons", "if(([nhs_check] <> 11 and [nhs_check] <> [nhs_last]) or ([nhs_check] = 11 and [nhs_last] <> 0), 0, 1)"),
    field("nhs_warning", "f_cons", branching="[nhs_copy] <> '' and [nhs_valid] = 0"),
    calculated("loop_a", "f_reg", "[loop_b] + 1"),
    calculated("loop_b", "f_reg", "[loop_a] + 1"),
    field("loop_gate", "f_reg", branching="[loop_a] > 0"),
    field("score", "f_later"),
    calculated("doubled", "f_later", "[score] * 2"),
    field("reads_doubled", "f_reg", branching="[later][doubled] = 8"),
    field("plain_default", "f_reg", annotation="@DEFAULT='7'"),
    field("reads_plain_default", "f_reg", branching="[plain_default] = 7"),
]

PROJECT = {
    "forms": [{"id": "f_reg"}, {"id": "f_cons"}, {"id": "f_later"}],
    "fields": FIELDS,
    "formLogic": [],
    "events": [
        {"id": "registration", "label": "r", "arm": "1", "armName": "A", "forms": ["f_reg"]},
        {"id": "consent", "label": "c", "arm": "1", "armName": "A", "forms": ["f_cons"]},
        {"id": "later", "label": "l", "arm": "1", "armName": "A", "forms": ["f_later"]},
    ],
}


def info(values, key="nhs_warning", event="consent", derive=True):
    return Engine(PROJECT).evaluate({"values": values, "event": event, "derive": derive, "today": "2021-06-15"})[key]


class DerivedChain(unittest.TestCase):
    def test_a_number_that_fails_the_check_shows_the_warning_and_one_that_passes_hides_it(self):
        self.assertEqual(info({"registration": {"nhs_entered": INVALID}})["state"], "shown")
        self.assertEqual(info({"registration": {"nhs_entered": VALID}})["state"], "hidden")

    def test_no_event_chosen_gives_the_same_answer_because_the_default_names_its_event(self):
        self.assertEqual(info({"registration": {"nhs_entered": INVALID}}, event=None)["state"], "shown")

    def test_nothing_set_is_unknown_and_asks_only_for_the_number_entered(self):
        result = info({})
        self.assertEqual(result["state"], "unknown")
        self.assertEqual(result["missing"], [{"variable": "nhs_entered", "event": "registration"}])

    def test_a_blank_number_has_nothing_to_check(self):
        self.assertEqual(info({"registration": {"nhs_entered": ""}})["state"], "hidden")

    def test_a_value_that_was_set_wins_over_the_calculation_and_over_the_default(self):
        self.assertEqual(info({"registration": {"nhs_entered": VALID}, "consent": {"nhs_valid": "0"}})["state"], "shown")
        self.assertEqual(info({"registration": {"nhs_entered": INVALID}, "consent": {"nhs_copy": ""}})["state"], "hidden")

    def test_with_derivation_off_nothing_is_worked_out(self):
        result = info({"registration": {"nhs_entered": INVALID}}, derive=False)
        self.assertEqual(result["state"], "unknown")
        self.assertEqual([item["variable"] for item in result["missing"]], ["nhs_copy", "nhs_valid"])


class DerivationEdgeCases(unittest.TestCase):
    def test_a_calculation_that_depends_on_itself_is_unknown_until_one_side_is_set(self):
        self.assertEqual(info({}, "loop_gate", "registration")["state"], "unknown")
        self.assertEqual(info({"": {"loop_b": "3"}}, "loop_gate", "registration")["state"], "shown")

    def test_a_calculation_reads_its_unprefixed_inputs_in_its_own_event(self):
        self.assertEqual(info({"later": {"score": "4"}}, "reads_doubled", "registration")["state"], "shown")
        self.assertEqual(info({"later": {"score": "5"}}, "reads_doubled", "registration")["state"], "hidden")

    def test_a_plain_default_stands_in_until_a_value_is_set(self):
        self.assertEqual(info({}, "reads_plain_default", "registration")["state"], "shown")
        self.assertEqual(info({"": {"plain_default": "9"}}, "reads_plain_default", "registration")["state"], "hidden")


class Helpers(unittest.TestCase):
    def test_top_level_default(self):
        self.assertEqual(top_level_default("@DEFAULT='abc'"), "abc")
        self.assertEqual(top_level_default('@DEFAULT="a b"'), "a b")
        self.assertEqual(top_level_default("@DEFAULT=5 @HIDDEN"), "5")
        self.assertEqual(top_level_default("@HIDDEN @default=''"), "")
        self.assertIsNone(top_level_default("@IF([a]=1, @DEFAULT='x', @DEFAULT='y')"))
        self.assertIsNone(top_level_default("@DEFAULT_OTHER='x'"))
        self.assertEqual(top_level_default("@IF([a]=1, @HIDDEN) @DEFAULT='z'"), "z")
        self.assertIsNone(top_level_default(""))

    def test_piped_text_expression(self):
        self.assertEqual(piped_text_expression("ID-[event][field]!"), 'concat("ID-", [event][field], "!")')
        self.assertEqual(piped_text_expression("[a][b]"), "concat([a][b])")
        self.assertEqual(piped_text_expression("plain"), 'concat("plain")')
        self.assertEqual(piped_text_expression(""), "concat()")
        self.assertEqual(piped_text_expression('say "hi" \\ [x]'), 'concat("say \\"hi\\" \\\\ ", [x])')


if __name__ == "__main__":
    unittest.main()
