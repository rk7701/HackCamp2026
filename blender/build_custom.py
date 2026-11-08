"""
Build one custom furniture model from a structured description (a "furniture spec") and export GLB.

The spec comes from the vision step on the server (photos -> spec). This script never runs code from
the spec: it only reads numbers, enums and colours, and every value is clamped to a safe range.

Run:
  blender -b --factory-startup -P blender/build_custom.py -- <spec.json> <out.glb> <result.json>

The spec's size is the user's tape measurement; finalize() snaps the model to it exactly.
"""

import json
import math
import os
import re
import sys

# Load the shared primitives and pipeline from make_products.py without exporting the catalogue.
os.environ["FURNITURE_LIB_ONLY"] = "1"
_lib_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "make_products.py")
with open(_lib_path, encoding="utf-8") as _f:
    exec(compile(_f.read(), _lib_path, "exec"))  # noqa: S102 - our own trusted file

import bpy  # noqa: E402  (available inside Blender)

# ---------------------------------------------------------------- spec helpers

HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


def clamp(v, lo, hi, default):
    try:
        v = float(v)
    except (TypeError, ValueError):
        return default
    if math.isnan(v):
        return default
    return max(lo, min(hi, v))


def iclamp(v, lo, hi, default):
    return int(round(clamp(v, lo, hi, default)))


def pick(v, allowed, default):
    return v if v in allowed else default


def color(v, default):
    return v if isinstance(v, str) and HEX.match(v) else default


# ---------------------------------------------------------------- shared pieces


def add_legs(W, D, style, leg_h, frame, corners=None, inset=0.06):
    """Four legs (or sled runners) under the footprint. corners overrides the leg positions."""
    if leg_h <= 0.005 or style == "hidden":
        return
    pts = corners or [(sx * (W / 2 - inset), sy * (D / 2 - inset)) for sx in (-1, 1) for sy in (-1, 1)]
    if style == "sled":
        for sx in (-1, 1):
            x = sx * (W / 2 - inset)
            box_from(x - 0.015, x + 0.015, -D / 2 + inset, D / 2 - inset, 0, 0.025, frame, 0.004)
            for sy in (-1, 1):
                box_from(x - 0.015, x + 0.015, sy * (D / 2 - inset) - 0.015, sy * (D / 2 - inset) + 0.015,
                         0, leg_h, frame, 0.004)
        return
    for x, y in pts:
        if style == "square":
            box(0.045, 0.045, leg_h, x, y, leg_h / 2, frame, 0.003)
        elif style == "round":
            cyl(0.02, 0.02, leg_h, x, y, 0, frame, 16)
        else:  # tapered, splayed outward
            leg = cyl(0.012, 0.021, leg_h + 0.015, x, y, 0, frame, 16)
            sx = 1 if x > 0 else -1
            sy = 1 if y > 0 else -1
            leg.rotation_euler = (math.radians(-7 * sy), math.radians(7 * sx), 0)


# ---------------------------------------------------------------- archetypes


def build_sofa(W, D, H, s, legs, main, frame, seats_override=None):
    seats = seats_override or iclamp(s.get("seats"), 1, 4, 3)
    backs = iclamp(s.get("back_cushions"), 0, 4, seats)
    arm_style = pick(s.get("arm_style"), ("track", "rolled", "angled", "none"), "track")
    chaise = pick(s.get("chaise"), ("none", "left", "right"), "none")
    bench = s.get("seat_cushion_style") == "bench"
    tufted = bool(s.get("tufted"))
    leg_style = pick(legs.get("style"), ("tapered", "square", "round", "hidden", "wood_base", "sled"), "tapered")
    leg_h = 0.02 if leg_style == "hidden" else clamp(legs.get("height_cm"), 2, 25, 12) / 100

    arm_w = 0 if arm_style == "none" else (0.2 if arm_style == "rolled" else 0.14)
    left_arm = 0 if chaise == "left" else arm_w
    right_arm = 0 if chaise == "right" else arm_w
    sofa_d = D if chaise == "none" else max(0.8, min(D * 0.6, D - 0.3))
    chaise_w = min(0.9, W * 0.4)
    yb = D / 2
    ys = yb - sofa_d
    yf = -D / 2
    back_d = min(0.22, sofa_d * 0.25)
    seat_top = min(0.46, H * 0.56)
    arm_h = min(0.66, H * 0.78)

    base = leg_h
    if leg_style == "wood_base":
        base = leg_h + 0.05
        box_from(-W / 2, W / 2, ys, yb, leg_h, base, frame, 0.005)
        if chaise != "none":
            cx0, cx1 = (W / 2 - chaise_w, W / 2) if chaise == "right" else (-W / 2, -W / 2 + chaise_w)
            box_from(cx0, cx1, yf, ys, leg_h, base, frame, 0.005)
    deck = seat_top - 0.12
    x0, x1 = -W / 2 + left_arm, W / 2 - right_arm

    # Seat deck under the cushions, including the chaise.
    box_from(x0, x1, ys + 0.01, yb - back_d, base, deck, main, 0.02, 3)
    if chaise != "none":
        cx0, cx1 = (W / 2 - chaise_w, W / 2) if chaise == "right" else (-W / 2, -W / 2 + chaise_w)
        box_from(cx0, cx1, yf, ys + 0.02, base, deck, main, 0.02, 3)

    # Arms.
    for side, w in ((-1, left_arm), (1, right_arm)):
        if w == 0:
            continue
        ax0, ax1 = (W / 2 - w, W / 2) if side > 0 else (-W / 2, -W / 2 + w)
        top = arm_h - (w / 2 if arm_style == "rolled" else 0)
        arm = box_from(ax0, ax1, ys + 0.01, yb, base, top, main, 0.03, 4)
        if arm_style == "rolled":
            bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=w / 2, depth=sofa_d - 0.01,
                                                location=((ax0 + ax1) / 2, (ys + yb) / 2, top),
                                                rotation=(math.pi / 2, 0, 0))
            bpy.context.active_object.data.materials.append(main)
        elif arm_style == "angled":
            arm.rotation_euler = (0, math.radians(9 * side), 0)

    # Back frame.
    box_from(x0 - 0.01, x1 + 0.01, yb - back_d, yb, base, H - 0.07, main, 0.03, 4)

    # Seat cushions across the main seat (the chaise gets its own long cushion).
    sx0, sx1 = x0, x1
    if chaise == "right":
        sx1 = W / 2 - chaise_w
    elif chaise == "left":
        sx0 = -W / 2 + chaise_w
    n = 1 if bench else seats
    cw = (sx1 - sx0) / n
    for i in range(n):
        c0 = sx0 + i * cw + (0.005 if n > 1 else 0)
        box_from(c0, c0 + cw - (0.01 if n > 1 else 0), ys + 0.005, yb - back_d, deck, seat_top, main, 0.04, 4)
    if chaise != "none":
        cx0, cx1 = (W / 2 - chaise_w, W / 2) if chaise == "right" else (-W / 2, -W / 2 + chaise_w)
        box_from(cx0 + 0.005, cx1 - 0.005, yf + 0.01, ys + 0.03, deck, seat_top, main, 0.04, 4)

    # Back cushions, leaning back slightly.
    if backs:
        bw = (x1 - x0) / backs
        for i in range(backs):
            b0 = x0 + i * bw + 0.005
            cb = box_from(b0, b0 + bw - 0.01, yb - back_d - 0.15, yb - back_d + 0.02, seat_top, H, main, 0.05, 4)
            cb.rotation_euler = (math.radians(-7), 0, 0)
    if tufted:
        for i in range(max(3, seats * 2)):
            x = x0 + (x1 - x0) * (i + 0.5) / max(3, seats * 2)
            for z in (seat_top + 0.14, seat_top + 0.3):
                if z < H - 0.05:
                    bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=6, radius=0.009,
                                                         location=(x, yb - back_d - 0.15, z))
                    bpy.context.active_object.data.materials.append(frame)

    # Legs at the outer corners, including the chaise's front corner.
    if leg_style == "hidden":
        return
    corners = [(-W / 2 + 0.07, yb - 0.07), (W / 2 - 0.07, yb - 0.07)]
    if chaise == "right":
        corners += [(-W / 2 + 0.07, ys + 0.07), (W / 2 - 0.07, yf + 0.07)]
    elif chaise == "left":
        corners += [(-W / 2 + 0.07, yf + 0.07), (W / 2 - 0.07, ys + 0.07)]
    else:
        corners += [(-W / 2 + 0.07, yf + 0.07), (W / 2 - 0.07, yf + 0.07)]
    add_legs(W, D, "square" if leg_style == "wood_base" else leg_style, leg_h, frame, corners)


def build_storage(W, D, H, st, legs, main, frame, hardware, shadow):
    cols = iclamp(st.get("drawer_columns"), 0, 3, 1)
    rows = iclamp(st.get("drawer_rows"), 0, 8, 3)
    doors = iclamp(st.get("doors"), 0, 4, 0)
    handle = pick(st.get("handle_style"), ("knob", "bar", "tab", "grip", "none"), "knob")
    overhang = bool(st.get("top_overhang"))
    leg_style = pick(legs.get("style"), ("tapered", "square", "round", "hidden", "wood_base", "sled"), "hidden")
    leg_h = 0 if leg_style == "hidden" else clamp(legs.get("height_cm"), 2, 30, 12) / 100

    oh = 0.012 if overhang else 0
    top_t = 0.028 if overhang else 0
    cw, cd = W - 2 * oh, D - 2 * oh
    front = -cd / 2 + 0.02
    if overhang:
        box_from(-W / 2, W / 2, -D / 2, D / 2, H - top_t, H, main, 0.004, 3)
    body_bottom = leg_h if leg_h else 0.0
    plinth = 0.05 if leg_style == "hidden" else 0
    box_from(-cw / 2, cw / 2, front, cd / 2, body_bottom, H - top_t, main, 0.004, 2)
    if plinth:
        box_from(-cw / 2 + 0.02, cw / 2 - 0.02, front - 0.001, front + 0.03, 0, plinth, shadow, 0)
    add_legs(cw, cd, "square" if leg_style == "wood_base" else leg_style, leg_h, frame, inset=0.05)

    z0 = body_bottom + plinth + 0.02
    z1 = H - top_t - 0.02
    x0, x1 = -cw / 2 + 0.02, cw / 2 - 0.02
    hmap = {"knob": "knobs", "bar": "bar", "tab": "tab", "grip": "grip", "none": "none"}
    if doors and rows and cols:
        split = z1 - (z1 - z0) * min(0.45, 0.16 * rows)
        drawer_grid(x0, x1, split, z1, front, cols, rows, main, shadow, hmap[handle], handle_mat=hardware)
        door_grid(x0, x1, z0, split - 0.004, front, doors, main, shadow, hardware, handle)
    elif doors:
        door_grid(x0, x1, z0, z1, front, doors, main, shadow, hardware, handle)
    elif rows and cols:
        drawer_grid(x0, x1, z0, z1, front, cols, rows, main, shadow, hmap[handle], handle_mat=hardware)
    else:  # open compartment
        box_from(x0, x1, front - 0.001, front + 0.004, z0, z1, shadow, 0)


def door_grid(x0, x1, z0, z1, front, doors, main, shadow, hardware, handle):
    for i in range(doors):
        dw = (x1 - x0) / doors
        side = "vbar_right" if (doors == 1 or i < doors / 2) else "vbar_left"
        if handle in ("none", "grip"):
            side = "none"
        drawer_grid(x0 + i * dw, x0 + (i + 1) * dw, z0, z1, front, 1, 1, main, shadow, side, handle_mat=hardware)


def build_shelving(W, D, H, sh, legs, main, frame):
    cols = iclamp(sh.get("columns"), 1, 6, 1)
    rows = iclamp(sh.get("rows"), 1, 10, 5)
    back = bool(sh.get("back_panel", True))
    cubbies = bool(sh.get("open_cubbies"))
    t = 0.038 if cubbies else 0.018
    t_in = 0.016
    y0, y1 = -D / 2, D / 2
    box_from(-W / 2, W / 2, y0, y1, H - t, H, main)
    box_from(-W / 2, W / 2, y0, y1, 0, t if cubbies else 0.06, main)
    box_from(-W / 2, -W / 2 + t, y0, y1, 0, H, main)
    box_from(W / 2 - t, W / 2, y0, y1, 0, H, main)
    bottom = t if cubbies else 0.06
    iw = W - 2 * t
    ih = H - t - bottom
    if back:
        box_from(-W / 2 + t, W / 2 - t, y1 - 0.004, y1 - 0.001, bottom, H - t, main, 0)
    cwid = (iw - (cols - 1) * t_in) / cols
    for c in range(1, cols):
        x = -W / 2 + t + c * cwid + (c - 1) * t_in
        box_from(x, x + t_in, y0, y1, bottom, H - t, main, 0.001)
    rh = (ih - (rows - 1) * t_in) / rows
    for r in range(1, rows):
        z = bottom + r * rh + (r - 1) * t_in
        box_from(-W / 2 + t, W / 2 - t, y0 + (0 if cubbies else 0.015), y1 - 0.005, z, z + t_in, main, 0.001)


def build_table(W, D, H, tb, legs, main, frame):
    round_top = bool(tb.get("round_top"))
    shelf = bool(tb.get("lower_shelf"))
    top_t = clamp(tb.get("top_thickness_cm"), 1.5, 8, 3) / 100
    leg_style = pick(legs.get("style"), ("tapered", "square", "round", "hidden", "wood_base", "sled"), "square")
    leg_h = H - top_t
    if round_top:
        top = cyl(0.5, 0.5, top_t, 0, 0, H - top_t, main, 64)
        top.scale = (W, D, 1)
    else:
        box_from(-W / 2, W / 2, -D / 2, D / 2, H - top_t, H, main, 0.003)
    if leg_style == "hidden":  # pedestal
        r = min(W, D) * 0.06
        cyl(r * 1.3, r, leg_h, 0, 0, 0, frame, 32)
        base = cyl(0.5, 0.5, 0.03, 0, 0, 0, frame, 48)
        base.scale = (W * 0.5, D * 0.5, 1)
    else:
        inset = 0.03 if not round_top else min(W, D) * 0.18
        add_legs(W, D, "square" if leg_style == "wood_base" else leg_style, leg_h, frame, inset=inset)
    if shelf:
        box_from(-W / 2 + 0.06, W / 2 - 0.06, -D / 2 + 0.06, D / 2 - 0.06, leg_h * 0.2, leg_h * 0.2 + 0.02, main)


def build_desk(W, D, H, st, legs, main, frame, hardware, shadow):
    build_table(W, D, H, {"top_thickness_cm": 2.5}, legs, main, frame)
    rows = iclamp(st.get("drawer_rows"), 0, 4, 0)
    if rows:
        pw = min(0.42, W * 0.35)
        x0 = W / 2 - pw - 0.03
        box_from(x0, W / 2 - 0.03, -D / 2 + 0.04, D / 2 - 0.03, 0.02, H - 0.025, main)
        handle = {"knob": "knobs", "bar": "bar", "tab": "tab", "grip": "grip"}.get(st.get("handle_style"), "grip")
        drawer_grid(x0 + 0.01, W / 2 - 0.04, 0.04, H - 0.04, -D / 2 + 0.04, 1, rows, main, shadow, handle,
                    handle_mat=hardware)


def build_bed(W, D, H, bd, legs, main, frame, soft):
    head_ratio = clamp(bd.get("headboard_height_ratio"), 0.4, 1, 1)
    footboard = bool(bd.get("footboard", True))
    leg_style = pick(legs.get("style"), ("tapered", "square", "round", "hidden", "wood_base", "sled"), "hidden")
    leg_h = 0 if leg_style == "hidden" else clamp(legs.get("height_cm"), 3, 30, 10) / 100
    yf, yb = -D / 2, D / 2
    rail_top = max(leg_h + 0.12, min(0.38, H * 0.38))
    head_t = 0.05
    box_from(-W / 2, W / 2, yb - head_t, yb, 0, H * head_ratio if head_ratio < 1 else H, main, 0.006, 3)
    box_from(-W / 2, W / 2, yf, yb - head_t, leg_h, rail_top, main, 0.006, 3)
    if footboard:
        box_from(-W / 2, W / 2, yf, yf + 0.03, leg_h, rail_top + 0.05, main, 0.006, 3)
    add_legs(W, D - head_t, "square" if leg_style == "wood_base" else leg_style, leg_h, frame, inset=0.05)
    mt = min(0.22, H * 0.25)
    box_from(-W / 2 + 0.03, W / 2 - 0.03, yf + 0.035, yb - head_t - 0.005, rail_top - 0.05, rail_top - 0.05 + mt,
             soft, 0.04, 4)
    n = 2 if W > 1.3 else 1
    pw = (W - 0.06) / n
    pz = rail_top - 0.05 + mt
    for i in range(n):
        px0 = -W / 2 + 0.03 + i * pw + 0.05
        box_from(px0, px0 + pw - 0.1, yb - head_t - 0.5, yb - head_t - 0.1, pz, min(pz + 0.12, H - 0.01), soft, 0.05, 4)


def build_chair(W, D, H, legs, main, frame):
    seat_h = min(0.46, H * 0.55)
    seat_t = 0.04
    leg = 0.04
    box_from(-W / 2, W / 2, -D / 2, D / 2, seat_h - seat_t, seat_h, main, 0.01, 3)
    lx, ly = W / 2 - leg / 2, D / 2 - leg / 2
    for sx in (-1, 1):
        box(leg, leg, seat_h - seat_t, sx * lx, -ly, (seat_h - seat_t) / 2, frame, 0.003)
        box(leg, leg, H, sx * lx, ly, H / 2, frame, 0.003)
    bh = min(0.3, (H - seat_h) * 0.6)
    box_from(-W / 2 + leg, W / 2 - leg, ly - 0.012, ly + 0.012, H - bh, H, main, 0.008, 3)


# ---------------------------------------------------------------- entry point


def build(spec):
    size = spec["size_m"]
    W = clamp(size.get("width"), 0.2, 4, 1)
    D = clamp(size.get("depth"), 0.2, 4, 0.8)
    H = clamp(size.get("height"), 0.2, 3, 0.8)
    colors = spec.get("colors", {})
    archetype = pick(spec.get("archetype"),
                     ("sofa", "armchair", "bed", "storage", "shelving", "table", "desk", "chair"), "storage")
    soft_main = archetype in ("sofa", "armchair", "bed")
    main = mat("Main finish", color(colors.get("main_hex"), "#9a9893"), 0.95 if soft_main else 0.5)
    frame = mat("Frame finish", color(colors.get("frame_hex"), "#5b3b25"), 0.5)
    hardware = mat("Hardware", color(colors.get("hardware_hex"), "#b9b9b6"), 0.35, 0.8)
    shadow = M()["shadow"]
    soft = mat("Bedding", "#f4f2ee", 0.95)
    legs = spec.get("legs", {})

    if archetype == "sofa":
        build_sofa(W, D, H, spec.get("sofa", {}), legs, main, frame)
    elif archetype == "armchair":
        build_sofa(W, D, H, {**spec.get("sofa", {}), "chaise": "none"}, legs, main, frame, seats_override=1)
    elif archetype == "bed":
        build_bed(W, D, H, spec.get("bed", {}), legs, main, frame, soft)
    elif archetype == "shelving":
        build_shelving(W, D, H, spec.get("shelving", {}), legs, main, frame)
    elif archetype == "table":
        build_table(W, D, H, spec.get("table", {}), legs, main, frame)
    elif archetype == "desk":
        build_desk(W, D, H, spec.get("storage", {}), legs, main, frame, hardware, shadow)
    elif archetype == "chair":
        build_chair(W, D, H, legs, main, frame)
    else:
        build_storage(W, D, H, spec.get("storage", {}), legs, main, frame, hardware, shadow)
    return (W, D, H)


def run():
    args = sys.argv[sys.argv.index("--") + 1:]
    spec_path, out_path, result_path = args[0], args[1], args[2]
    with open(spec_path, encoding="utf-8") as f:
        spec = json.load(f)
    reset_scene()
    target = build(spec)
    obj, final = finalize("custom", target)
    obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=out_path, export_format="GLB", use_selection=True, export_apply=True,
                              export_yup=True)
    materials = sorted({s.material.name for s in obj.material_slots if s.material})
    with open(result_path, "w", encoding="utf-8") as f:
        json.dump({"width": final[0], "depth": final[1], "height": final[2], "materials": materials}, f)
    if os.environ.get("PREVIEW_PNG"):
        render_preview(obj, os.environ["PREVIEW_PNG"])
    print(f"[custom] exported {out_path}")


run()
