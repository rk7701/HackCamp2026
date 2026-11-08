"""Offline-only runtime assets. Downloads belong to the explicit setup command."""
import os
import sys
from pathlib import Path


def enforce_offline():
    # Set these before importing hub/transformers libraries; they cache settings at import.
    for key in ("HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE", "HF_HUB_DISABLE_TELEMETRY", "DO_NOT_TRACK"):
        os.environ[key] = "1"

    # Defense against new dependencies quietly introducing network access in the worker.
    def deny_network(event, args):
        if event in ("socket.connect", "socket.getaddrinfo", "socket.gethostbyname", "socket.sendto"):
            raise RuntimeError("The scan worker runs offline; network access is disabled.")

    sys.addaudithook(deny_network)


def local_weights(repo, subfolder):
    from huggingface_hub import hf_hub_download
    from huggingface_hub.errors import LocalEntryNotFoundError

    try:
        return tuple(hf_hub_download(repo, name, subfolder=subfolder, local_files_only=True)
                     for name in ("config.yaml", "model.fp16.safetensors"))
    except LocalEntryNotFoundError as error:
        raise RuntimeError("Local scan files are missing. Ask the server owner to complete the one-time setup.") from error


def local_rembg_session(model_name, opts):
    from rembg.sessions import sessions_class

    if model_name not in ("silueta", "u2netp"):
        raise ValueError("Offline background removal supports silueta or u2netp.")
    session_class = next(sc for sc in sessions_class if sc.name() == model_name)
    filename = f"{model_name}.onnx"
    if hasattr(session_class, "resolve_existing"):
        path = session_class.resolve_existing(filename)
    else:
        path = os.path.join(session_class.u2net_home(), filename)
    if not path or not Path(path).is_file():
        raise RuntimeError("Local background-removal files are missing. Ask the server owner to complete the one-time setup.")

    # BaseSession calls download_models unconditionally. Override it with our resolved local
    # path so rembg/pooch never gets an opportunity to download, even if the file disappears.
    class LocalSession(session_class):
        @classmethod
        def download_models(cls, *args, **kwargs):
            return path

    return LocalSession(model_name, opts, providers=["CPUExecutionProvider"])
