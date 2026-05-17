import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "op-relay-client.py"
spec = importlib.util.spec_from_file_location("op_relay_client", SCRIPT_PATH)
op_relay_client = importlib.util.module_from_spec(spec)
assert spec.loader is not None
sys.modules[spec.name] = op_relay_client
spec.loader.exec_module(op_relay_client)


class OpRelayClientTest(unittest.TestCase):
    def test_resolve_refs_treats_whole_secret_ref_value_as_one_ref(self):
        seen = []

        def fake_read_secret(ref, account_args=None):
            seen.append(ref)
            return "secret"

        with patch.object(op_relay_client, "read_secret", fake_read_secret):
            self.assertEqual(
                op_relay_client.resolve_refs("op://Private/My Item/password"),
                "secret",
            )

        self.assertEqual(seen, ["op://Private/My Item/password"])

    def test_load_env_file_supports_quoted_item_names_with_spaces(self):
        seen = []

        def fake_read_secret(ref, account_args=None):
            seen.append(ref)
            return "secret"

        with tempfile.TemporaryDirectory() as tmpdir:
            env_file = Path(tmpdir) / ".env"
            env_file.write_text('TOKEN="op://Private/My Item/password"\n', encoding="utf-8")

            with patch.object(op_relay_client, "read_secret", fake_read_secret):
                self.assertEqual(
                    op_relay_client.load_env_file(str(env_file)),
                    {"TOKEN": "secret"},
                )

        self.assertEqual(seen, ["op://Private/My Item/password"])

    def test_resolve_refs_keeps_unquoted_inline_refs_whitespace_delimited(self):
        seen = []

        def fake_read_secret(ref, account_args=None):
            seen.append(ref)
            return "secret"

        with patch.object(op_relay_client, "read_secret", fake_read_secret):
            self.assertEqual(
                op_relay_client.resolve_refs("token=op://Private/Item/password suffix"),
                "token=secret suffix",
            )

        self.assertEqual(seen, ["op://Private/Item/password"])


if __name__ == "__main__":
    unittest.main()
