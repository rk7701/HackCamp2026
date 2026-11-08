"""
Hunyuan3D scan worker: photos -> 3D shape -> GLB (for the app / AR) and STL.

Started by the scan server (server/hunyuan.ts) when a scan arrives. The server closes stdin once it
has been idle for a while; the worker then exits and frees all of its RAM and VRAM.
Protocol: one JSON object per line.
  stdout <- {"ready": true, "views": [...]}  once the model is loaded
  stdin  -> {"id", "images": {"front"|"left"|"back"|"right": path}, "height_m", "out_glb", "out_stl"}
  stdout <- {"id", "ok": true, "width", "depth", "height", "peak_ram_mb", "peak_vram_mb"}  (metres)
          | {"id", "ok": false, "error": "..."}
Everything else (library output, progress bars) goes to stderr.

Default model: Hunyuan3D-DiT-v2-mini-Turbo (one front image, shape only). Set HUNYUAN_MODEL to
tencent/Hunyuan3D-2mv to use front/left/back/right photos instead.

Built for a laptop with 8 GB VRAM and 16 GB RAM:
- Weights are streamed from safetensors straight to the GPU in fp16, into modules created without
  allocating memory (accelerate's init_empty_weights), so system RAM never holds a copy.
  hy3dgen's own from_pretrained reads the whole 3.8 GB checkpoint into RAM and builds the networks
  in fp32 on the CPU first (~11 GB peak), which freezes a 16 GB machine.
- Only the turbo VAE is loaded. Upstream also loads the checkpoint's own VAE, then replaces it.
- PyTorch is capped at HUNYUAN_VRAM_GB, so running out of VRAM is a clean error instead of the
  Windows driver spilling GPU memory into system RAM.
- Background removal uses rembg's small silueta model (HUNYUAN_REMBG) with its memory arena off.
- Smaller decode grid (HUNYUAN_OCTREE, default 256) and chunks than upstream's examples.

The output is unitless, so it is scaled uniformly to the requested height, centred on X/Z with its
base at Y = 0 (glTF Y-up). The STL copy is Z-up and in millimetres, as slicers and CAD tools expect.
"""

import gc
import json
import math
import os
import sys
import time
import traceback
from local_assets import enforce_offline, local_rembg_session, local_weights

enforce_offline()

# Keep stdout for the protocol only: redirect fd 1 (and Python's sys.stdout) to stderr so that
# prints from libraries cannot corrupt it.
PROTO = os.fdopen(os.dup(1), "w", encoding="utf-8", buffering=1)
os.dup2(2, 1)
sys.stdout = sys.stderr

VIEWS = ("front", "left", "back", "right")
MODEL_PATH = os.environ.get("HUNYUAN_MODEL") or "tencent/Hunyuan3D-2mini"
MULTIVIEW = "2mv" in MODEL_PATH.lower()
SUBFOLDER = os.environ.get("HUNYUAN_SUBFOLDER") or (
    "hunyuan3d-dit-v2-mv-turbo" if MULTIVIEW else "hunyuan3d-dit-v2-mini-turbo"
)
# Turbo (FlashVDM) VAE for each model, as in hy3dgen's enable_flashvdm().
TURBO_VAE = (
    ("tencent/Hunyuan3D-2", "hunyuan3d-vae-v2-0-turbo")
    if MULTIVIEW
    else ("tencent/Hunyuan3D-2mini", "hunyuan3d-vae-v2-mini-turbo")
)
TOPK_MODE = "mean" if MULTIVIEW else "merge"  # as in upstream's example for each model
# A single-image model only uses the front photo.
SUPPORTED_VIEWS = VIEWS if MULTIVIEW else ("front",)
STEPS = int(os.environ.get("HUNYUAN_STEPS") or 5)  # turbo is step-distilled; 5 matches upstream
OCTREE_RESOLUTION = int(os.environ.get("HUNYUAN_OCTREE") or 256)
NUM_CHUNKS = int(os.environ.get("HUNYUAN_CHUNKS") or 8000)
MAX_FACES = int(os.environ.get("HUNYUAN_MAX_FACES") or 80000)
VRAM_CAP_GB = float(os.environ.get("HUNYUAN_VRAM_GB") or 6.5)
REMBG_MODEL = os.environ.get("HUNYUAN_REMBG") or "silueta"
SEED = 12345


def send(msg):
    PROTO.write(json.dumps(msg) + "\n")
    PROTO.flush()


def log(*args):
    print("[hunyuan]", *args, file=sys.stderr, flush=True)


def memory_report(torch):
    """Peak RAM of this process and peak VRAM reserved by PyTorch since the last reset, in MB."""
    import psutil

    info = psutil.Process().memory_info()
    peak_ram = getattr(info, "peak_wset", info.rss)  # peak_wset is Windows-only
    return {
        "peak_ram_mb": round(peak_ram / 2**20),
        "peak_vram_mb": round(torch.cuda.max_memory_reserved() / 2**20),
    }


def log_ram(stage):
    import psutil

    info = psutil.Process().memory_info()
    private = getattr(info, "private", info.rss)  # private bytes on Windows
    log(f"RAM after {stage}: working set {info.rss / 2**20:.0f} MB, private {private / 2**20:.0f} MB")


SAFETENSORS_DTYPES = {
    "F16": "float16",
    "BF16": "bfloat16",
    "F32": "float32",
    "F64": "float64",
    "I64": "int64",
    "I32": "int32",
    "I16": "int16",
    "I8": "int8",
    "U8": "uint8",
    "BOOL": "bool",
}


def stream_tensors(torch, path, prefix):
    """
    Yield (name, cuda tensor) for keys starting with `prefix`, one at a time, using plain reads.
    safetensors' safe_open memory-maps the file, and every page it touches counts against this
    process until Windows trims it; reading each tensor into a small temporary buffer keeps RAM
    use to about one tensor.
    """
    import struct

    with open(path, "rb") as f:
        (header_len,) = struct.unpack("<Q", f.read(8))
        header = json.loads(f.read(header_len))
        base = 8 + header_len
        entries = sorted(
            ((k, v) for k, v in header.items() if k != "__metadata__" and k.startswith(prefix)),
            key=lambda kv: kv[1]["data_offsets"][0],
        )
        for key, meta in entries:
            dtype = getattr(torch, SAFETENSORS_DTYPES[meta["dtype"]])
            start, end = meta["data_offsets"]
            if end == start:
                tensor = torch.empty(meta["shape"], dtype=dtype, device="cuda")
            else:
                f.seek(base + start)
                buf = bytearray(end - start)
                f.readinto(buf)
                tensor = torch.frombuffer(buf, dtype=dtype).reshape(meta["shape"]).to("cuda")
                del buf
            yield key[len(prefix):], tensor


def load_module(torch, config, weights, prefix, strict=True):
    """
    Build a module without allocating its weights, then fill it with fp16 tensors read directly
    onto the GPU. `prefix` picks one network out of a combined checkpoint ("model.", "conditioner.").
    """
    from accelerate import init_empty_weights
    from accelerate.utils import set_module_tensor_to_device
    from hy3dgen.shapegen.pipelines import instantiate_from_config

    name = prefix.rstrip(".") or "vae"
    device, dtype = torch.device("cuda"), torch.float16
    with init_empty_weights():  # parameters go on the meta device; buffers stay real (and small)
        module = instantiate_from_config(config)
    state = {
        key: (t.to(dtype) if t.is_floating_point() else t) for key, t in stream_tensors(torch, weights, prefix)
    }
    result = module.load_state_dict(state, strict=False, assign=True)
    del state
    if strict and (result.missing_keys or result.unexpected_keys):
        raise RuntimeError(
            f"{name} weights do not match the model: missing {result.missing_keys[:5]}, "
            f"unexpected {result.unexpected_keys[:5]}"
        )
    # Parameters the checkpoint lacks (hy3dgen loads the VAE with strict=False too) would stay on
    # the meta device; give them real zero storage so the module can move and run.
    leftovers = [n for n, p in module.named_parameters() if p.is_meta]
    for param_name in leftovers:
        shape = module.get_parameter(param_name).shape
        set_module_tensor_to_device(module, param_name, device, value=torch.zeros(shape, dtype=dtype))
    if leftovers:
        log(f"{name}: {len(leftovers)} parameters not in the checkpoint, zero-filled: {leftovers[:3]}")
    module.to(device=device, dtype=dtype).eval().requires_grad_(False)
    log_ram(f"loading {name}")
    return module


def load():
    import torch
    import yaml
    from hy3dgen.shapegen import (
        DegenerateFaceRemover,
        FaceReducer,
        FloaterRemover,
        Hunyuan3DDiTFlowMatchingPipeline,
    )
    from hy3dgen.shapegen.pipelines import instantiate_from_config

    log_ram("imports")
    if not torch.cuda.is_available():
        raise RuntimeError("PyTorch cannot see a CUDA GPU.")
    total = torch.cuda.get_device_properties(0).total_memory
    torch.cuda.set_per_process_memory_fraction(min(1.0, VRAM_CAP_GB * 2**30 / total), 0)
    torch.zeros(1, device="cuda")  # create the CUDA context now so its cost shows up in the log
    log_ram("CUDA start")

    t = time.time()
    dit_config_path, dit_weights = local_weights(MODEL_PATH, SUBFOLDER)
    vae_config_path, vae_weights = local_weights(*TURBO_VAE)
    with open(dit_config_path, encoding="utf-8") as f:
        dit_config = yaml.safe_load(f)
    with open(vae_config_path, encoding="utf-8") as f:
        vae_config = yaml.safe_load(f)

    conditioner = load_module(torch, dit_config["conditioner"], dit_weights, "conditioner.")
    gc.collect()
    model = load_module(torch, dit_config["model"], dit_weights, "model.")
    gc.collect()
    vae = load_module(torch, vae_config, vae_weights, "", strict=False)
    gc.collect()
    vae.enable_flashvdm_decoder(enabled=True, adaptive_kv_selection=True, topk_mode=TOPK_MODE, mc_algo="mc")

    pipeline = Hunyuan3DDiTFlowMatchingPipeline(
        vae=vae,
        model=model,
        scheduler=instantiate_from_config(dit_config["scheduler"]),
        conditioner=conditioner,
        image_processor=instantiate_from_config(dit_config["image_processor"]),
        device="cuda",
        dtype=torch.float16,
        from_pretrained_kwargs=dict(
            model_path=MODEL_PATH,
            subfolder=SUBFOLDER,
            use_safetensors=True,
            variant="fp16",
            dtype=torch.float16,
            device="cuda",
        ),
    )
    mem = memory_report(torch)
    log(
        f"loaded {MODEL_PATH}/{SUBFOLDER} + {TURBO_VAE[1]} on {torch.cuda.get_device_name(0)} in "
        f"{time.time() - t:.0f}s; peak RAM {mem['peak_ram_mb']} MB, peak VRAM {mem['peak_vram_mb']} MB "
        f"(cap {VRAM_CAP_GB} GB)"
    )
    return {
        "torch": torch,
        "pipeline": pipeline,
        "rembg": None,  # created on first use; photos that already have transparency skip it
        "cleanup": [FloaterRemover(), DegenerateFaceRemover()],
        "reduce": FaceReducer(),
    }


def prepare_image(path, models):
    """RGBA with the background removed (kept as-is if the photo already has transparency)."""
    from PIL import Image, ImageOps

    with Image.open(path) as source:
        # Reject decompression bombs before allocating full-resolution pixel buffers.
        if source.width * source.height > 50_000_000:
            raise ValueError("Photo exceeds 50 megapixels. Resize it and try again.")
        # JPEG draft decoding avoids materialising a full 48 MP phone photo.
        source.draft("RGB", (1600, 1600))
        img = ImageOps.exif_transpose(source)
        img.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
        img = img.copy()
    if img.mode == "RGBA" and img.getchannel("A").getextrema()[0] < 255:
        return img
    from rembg import remove

    if models["rembg"] is None:
        models["rembg"] = rembg_session()
    return remove(img.convert("RGB"), session=models["rembg"], bgcolor=[255, 255, 255, 0])


def rembg_session():
    """
    Background removal on the CPU with a small model. hy3dgen's BackgroundRemover uses rembg's
    default, which in current rembg is bria-rmbg (1024 px input, over 1.3 GB of RAM on top of the
    worker); silueta (44 MB, u2net quality) needs about 300 MB. The memory arena is off so
    onnxruntime frees its buffers after each photo instead of keeping them.
    """
    import onnxruntime as ort

    opts = ort.SessionOptions()
    opts.enable_cpu_mem_arena = False
    opts.intra_op_num_threads = 4
    return local_rembg_session(REMBG_MODEL, opts)


def scale_to_height(mesh, height_m):
    """Uniformly scale so the bounding-box height (Y) is height_m; centre X/Z, base at Y = 0."""
    lo, hi = mesh.bounds
    h = float(hi[1] - lo[1])
    if not math.isfinite(h) or h <= 0:
        raise RuntimeError("The generated shape is empty.")
    mesh.apply_translation([-(lo[0] + hi[0]) / 2, -lo[1], -(lo[2] + hi[2]) / 2])
    mesh.apply_scale(height_m / h)
    return mesh


def export(mesh, out_glb, out_stl):
    import trimesh

    glb = mesh.copy()
    glb.visual = trimesh.visual.TextureVisuals(
        material=trimesh.visual.material.PBRMaterial(
            name="Main finish",  # the app recolours materials by this name
            baseColorFactor=[184, 181, 175, 255],
            metallicFactor=0.0,
            roughnessFactor=0.85,
        )
    )
    glb.export(out_glb, file_type="glb", include_normals=True)

    stl = mesh.copy()
    # glTF Y-up -> Z-up: rotate +90 degrees about X, so (x, y, z) -> (x, -z, y). Metres -> mm.
    stl.apply_transform(trimesh.transformations.rotation_matrix(math.pi / 2, [1, 0, 0]))
    stl.apply_scale(1000.0)
    stl.export(out_stl, file_type="stl")

    ext = mesh.extents
    return {"width": float(ext[0]), "height": float(ext[1]), "depth": float(ext[2])}


def generate(models, req):
    import trimesh

    torch = models["torch"]
    images = req.get("images") or {}
    if "front" not in images or any(v not in VIEWS for v in images):
        raise ValueError("images must include front and map front/left/back/right to files")
    unused = sorted(set(images) - set(SUPPORTED_VIEWS))
    if unused:
        log(f"{MODEL_PATH} uses only {list(SUPPORTED_VIEWS)}; ignoring {unused}")
    images = {v: p for v, p in images.items() if v in SUPPORTED_VIEWS}
    height_m = float(req["height_m"])
    if not (0.05 <= height_m <= 5):
        raise ValueError("height_m out of range")

    send({"progress": {"label": "Preparing your photo"}})
    prepared = {view: prepare_image(path, models) for view, path in images.items()}
    log_ram("preparing photos")
    t = time.time()
    torch.cuda.reset_peak_memory_stats()
    try:
        send({"progress": {"label": "Building the shape", "completed": 0, "total": STEPS}})
        mesh = models["pipeline"](
            image=prepared if MULTIVIEW else prepared["front"],
            num_inference_steps=STEPS,
            octree_resolution=OCTREE_RESOLUTION,
            num_chunks=NUM_CHUNKS,
            generator=torch.manual_seed(SEED),
            output_type="trimesh",
        )[0]
        send({"progress": {"label": "Cleaning up the mesh"}})
        log_ram(f"Hunyuan3D ({len(mesh.faces)} faces)")
        for step in models["cleanup"]:
            mesh = step(mesh)
        mesh = models["reduce"](mesh, max_facenum=MAX_FACES)
        log_ram("mesh cleanup")
    finally:
        prepared.clear()
        gc.collect()
        torch.cuda.empty_cache()
    if not isinstance(mesh, trimesh.Trimesh) or len(mesh.faces) == 0:
        raise RuntimeError("Hunyuan3D did not produce a mesh. Try clearer photos of the whole piece.")
    mem = memory_report(torch)
    log(
        f"generated {len(mesh.faces)} faces from {sorted(images)} in {time.time() - t:.0f}s; "
        f"peak VRAM this scan {mem['peak_vram_mb']} MB, peak RAM so far {mem['peak_ram_mb']} MB"
    )
    send({"progress": {"label": "Saving your model"}})
    return {**export(scale_to_height(mesh, height_m), req["out_glb"], req["out_stl"]), **mem}


def main():
    try:
        models = load()
    except Exception as e:  # noqa: BLE001 - report any startup failure to the server
        traceback.print_exc()
        send({"ready": False, "error": f"{type(e).__name__}: {e}"})
        sys.exit(1)
    send({"ready": True, "model": f"{MODEL_PATH}/{SUBFOLDER}", "views": list(SUPPORTED_VIEWS)})

    # Ends when the server closes stdin (idle shutdown), which frees everything.
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req_id = None
        try:
            req = json.loads(line)
            req_id = req.get("id")
            send({"id": req_id, "ok": True, **generate(models, req)})
        except Exception as e:  # noqa: BLE001 - one bad scan must not stop the worker
            traceback.print_exc()
            msg = "The GPU ran out of memory." if "out of memory" in str(e).lower() else str(e) or type(e).__name__
            send({"id": req_id, "ok": False, "error": msg})


if __name__ == "__main__":
    main()
