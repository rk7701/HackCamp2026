"""Run with hunyuan/.venv/Scripts/python.exe -m unittest discover -s tests -p test_scan_offline.py."""
import os
from pathlib import Path
import socket
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "hunyuan"))
from local_assets import enforce_offline, local_rembg_session, local_weights

enforce_offline()


class OfflineScanTests(unittest.TestCase):
    def test_runtime_forces_offline_settings(self):
        for key in ("HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE", "HF_HUB_DISABLE_TELEMETRY"):
            self.assertEqual(os.environ[key], "1")

    def test_dns_is_blocked(self):
        with self.assertRaisesRegex(RuntimeError, "network access is disabled"):
            socket.getaddrinfo("huggingface.co", 443)

    def test_connections_are_blocked(self):
        with socket.socket() as connection:
            with self.assertRaisesRegex(RuntimeError, "network access is disabled"):
                connection.connect(("127.0.0.1", 9))

    def test_model_lookup_is_local_only(self):
        with patch("huggingface_hub.hf_hub_download", return_value="cached") as lookup:
            self.assertEqual(local_weights("repo", "folder"), ("cached", "cached"))
            self.assertEqual(lookup.call_count, 2)
            for call in lookup.call_args_list:
                self.assertTrue(call.kwargs["local_files_only"])

    def test_missing_model_fails_without_network_fallback(self):
        from huggingface_hub.errors import LocalEntryNotFoundError
        with patch("huggingface_hub.hf_hub_download", side_effect=LocalEntryNotFoundError("missing")):
            with self.assertRaisesRegex(RuntimeError, "Local scan files are missing"):
                local_weights("repo", "folder")

    def test_missing_background_model_never_downloads(self):
        from rembg.sessions.silueta import SiluetaSession
        with patch.object(SiluetaSession, "resolve_existing", return_value=None), \
                patch("pooch.retrieve", side_effect=AssertionError("Must never download")) as download:
            with self.assertRaisesRegex(RuntimeError, "Local background-removal files are missing"):
                local_rembg_session("silueta", None)
            download.assert_not_called()
