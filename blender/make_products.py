"""
Build the "Popular products" furniture models in Blender and export them as GLB.

Each model is a generic design whose overall size matches a popular retail product's
published dimensions. After building, the mesh is centered on X/Y, placed on the floor
(Z = 0) and snapped to the exact target size, then checked.

Run (from the repo root):
  blender -b --factory-startup -P blender/make_products.py -- public/models/products

Blender axes: X = width, Y = depth (front of the furniture faces -Y), Z = up.
The glTF exporter converts to Y-up with the front facing +Z, matching the web app.
"""

import json
import math
import os
import sys

import bpy
from mathutils import Matrix

OUT_DIR = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "public/models/products"
IN = 0.0254
CM = 0.01

# ---------------------------------------------------------------- materials

_mats = {}


def mat(name, hex_color, rough=0.6, metal=0.0):
    if name in _mats:
        return _mats[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    h = hex_color.lstrip("#")
    srgb = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb]
    bsdf.inputs["Base Color"].default_value = (*lin, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    _mats[name] = m
    return m


def M():
    return {
        "white": mat("White laminate", "#f1f0ec", 0.45),
        "white_stain": mat("White stain", "#e7e1d4", 0.55),
        "black_brown": mat("Black-brown", "#3a2e27", 0.5),
        "birch": mat("Birch veneer", "#d6b487", 0.5),
        "walnut": mat("Walnut", "#5b3b25", 0.5),
        "shadow": mat("Shadow gap", "#2a2826", 0.8),
        "metal": mat("Brushed metal", "#b9b9b6", 0.3, 0.9),
        "dark_metal": mat("Dark metal", "#3b3b3b", 0.35, 0.8),
        "cushion_beige": mat("Cushion beige", "#cbbfa8", 0.95),
        "fabric_cream": mat("Fabric cream", "#e4dfd3", 0.95),
        "leather_tan": mat("Tan leather", "#9a5f33", 0.55),
        # Separate material for tops that some colour options finish differently (two-tone).
        "top_white_stain": mat("Top finish", "#e7e1d4", 0.55),
    }


# ---------------------------------------------------------------- primitives


def _finish(obj, material, bevel, segments):
    obj.data.materials.append(material)
    if bevel > 0:
        mod = obj.modifiers.new("Bevel", "BEVEL")
        mod.width = bevel
        mod.segments = segments
        mod.limit_method = "ANGLE"
    return obj


def box(w, d, h, x, y, z, material, bevel=0.002, segments=2):
    """Box with size (w, d, h) whose center is at (x, y, z)."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, z))
    obj = bpy.context.active_object
    # Scale the mesh itself so the object keeps its own origin for later rotation.
    obj.data.transform(Matrix.Diagonal((w, d, h, 1)))
    return _finish(obj, material, min(bevel, w / 3, d / 3, h / 3), segments)


def box_from(x0, x1, y0, y1, z0, z1, material, bevel=0.002, segments=2):
    """Box spanning the given min/max coordinates."""
    return box(x1 - x0, y1 - y0, z1 - z0, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, material, bevel, segments)


def cyl(r_bottom, r_top, h, x, y, z0, material, verts=32):
    """Vertical (optionally tapered) cylinder standing on z0."""
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r_bottom, radius2=r_top, depth=h, location=(x, y, z0 + h / 2))
    obj = bpy.context.active_object
    return _finish(obj, material, 0, 0)


def knob(x, y_front, z, material, r=0.014, depth=0.022):
    """Round knob protruding from a front face toward -Y."""
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, radius=r, location=(x, y_front - depth + r, z))
    obj = bpy.context.active_object
    obj.data.transform(Matrix.Diagonal((1, depth / (2 * r) * 1.2, 1, 1)))
    obj.data.materials.append(material)
    return obj


def catmull_rom(points, samples=8, closed=False):
    """Smooth path through (y, z) control points."""
    pts = list(points)
    n = len(pts)
    out = []
    count = n if closed else n - 1
    for i in range(count):
        p0 = pts[(i - 1) % n] if (closed or i > 0) else pts[0]
        p1 = pts[i]
        p2 = pts[(i + 1) % n]
        p3 = pts[(i + 2) % n] if (closed or i + 2 < n) else pts[-1]
        for s in range(samples):
            t = s / samples
            t2, t3 = t * t, t * t * t
            out.append(tuple(
                0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2
                       + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)
                for k in range(2)
            ))
    if not closed:
        out.append(pts[-1])
    else:
        out.append(out[0])
    return out


def sweep(path_yz, x, width, thickness, material, bevel=0.003):
    """Chain of boxes following a (y, z) path: bentwood frames, curved cushions."""
    for (y0, z0), (y1, z1) in zip(path_yz, path_yz[1:]):
        length = math.hypot(y1 - y0, z1 - z0)
        if length < 1e-5:
            continue
        b = box(width, length + thickness * 0.6, thickness, x, (y0 + y1) / 2, (z0 + z1) / 2, material, bevel, 1)
        b.rotation_euler = (math.atan2(z1 - z0, y1 - y0), 0, 0)


# ---------------------------------------------------------------- furniture parts


def drawer_grid(x0, x1, z0, z1, y_front, cols, rows, front_mat, gap_mat, handle, row_weights=None, thickness=0.018,
                handle_mat=None):
    """Drawer fronts on the plane y_front (facing -Y) with gaps, plus handles."""
    gap = 0.004
    weights = row_weights or [1] * rows
    total = sum(weights)
    cw = (x1 - x0) / cols
    # Dark backing shows through the gaps between fronts.
    box_from(x0, x1, y_front, y_front + 0.004, z0, z1, gap_mat, 0)
    z = z1
    for r in range(rows):
        rh = (z1 - z0) * weights[r] / total
        for c in range(cols):
            fx0 = x0 + c * cw + gap / 2
            fx1 = x0 + (c + 1) * cw - gap / 2
            fz0, fz1 = z - rh + gap / 2, z - gap / 2
            box_from(fx0, fx1, y_front - thickness, y_front, fz0, fz1, front_mat, 0.002)
            cx = (fx0 + fx1) / 2
            if handle == "grip":  # recessed finger grip along the top edge
                gw = min(0.12, (fx1 - fx0) * 0.35)
                box_from(cx - gw / 2, cx + gw / 2, y_front - thickness - 0.0015, y_front - thickness + 0.002,
                         fz1 - 0.02, fz1 - 0.006, gap_mat, 0)
            elif handle == "knobs":
                n = 2 if (fx1 - fx0) > 0.5 else 1
                for k in range(n):
                    kx = cx if n == 1 else fx0 + (fx1 - fx0) * (0.25 + 0.5 * k)
                    knob(kx, y_front - thickness, (fz0 + fz1) / 2, handle_mat or M()["metal"])
            elif handle == "tab":  # small metal tab pull near the top edge
                box_from(cx - 0.035, cx + 0.035, y_front - thickness - 0.012, y_front - thickness,
                         fz1 - 0.035, fz1 - 0.02, handle_mat or M()["metal"], 0.002)
        z -= rh


# ---------------------------------------------------------------- products
# Each builder makes the piece roughly at size; finalize() snaps it to the exact target.


def cube_shelf(W, D, H, cols, rows):
    m = M()
    t_out, t_in = 0.038, 0.016
    x0, x1, z0, z1 = -W / 2, W / 2, 0, H
    y0, y1 = -D / 2, D / 2
    box_from(x0, x1, y0, y1, z1 - t_out, z1, m["white"])
    box_from(x0, x1, y0, y1, z0, z0 + t_out, m["white"])
    box_from(x0, x0 + t_out, y0, y1, z0 + t_out, z1 - t_out, m["white"])
    box_from(x1 - t_out, x1, y0, y1, z0 + t_out, z1 - t_out, m["white"])
    iw = W - 2 * t_out
    ih = H - 2 * t_out
    cw = (iw - (cols - 1) * t_in) / cols
    ch = (ih - (rows - 1) * t_in) / rows
    for c in range(1, cols):
        x = x0 + t_out + c * cw + (c - 1) * t_in
        box_from(x, x + t_in, y0, y1, z0 + t_out, z1 - t_out, m["white"], 0.001)
    for r in range(1, rows):
        z = z0 + t_out + r * ch + (r - 1) * t_in
        box_from(x0 + t_out, x1 - t_out, y0, y1, z, z + t_in, m["white"], 0.001)


def bookcase(W, D, H):
    m = M()
    t = 0.016
    y0, y1 = -D / 2, D / 2
    box_from(-W / 2, -W / 2 + t, y0, y1, 0, H, m["white"])
    box_from(W / 2 - t, W / 2, y0, y1, 0, H, m["white"])
    box_from(-W / 2 + t, W / 2 - t, y0, y1, H - t, H, m["white"])
    plinth = 0.06
    box_from(-W / 2 + t, W / 2 - t, y0 + 0.01, y0 + 0.01 + t, 0, plinth, m["white"], 0.001)  # kick board
    box_from(-W / 2 + t, W / 2 - t, y0 + 0.01, y1, plinth, plinth + t, m["white"], 0.001)  # bottom
    box_from(-W / 2 + t, W / 2 - t, y1 - 0.004, y1 - 0.001, plinth, H - t, m["white"], 0)  # back panel
    shelves = 5
    space = (H - t - plinth - t) / (shelves + 1)
    for i in range(1, shelves + 1):
        z = plinth + t + i * space
        box_from(-W / 2 + t + 0.001, W / 2 - t - 0.001, y0 + 0.015, y1 - 0.005, z - t / 2, z + t / 2, m["white"], 0.001)


def modern_dresser(W, D, H, cols, rows, finish="white"):
    """Flat-front dresser with finger grips, sitting on a slim recessed plinth."""
    m = M()
    body = m[finish]
    t = 0.016
    plinth = 0.03
    y0, y1 = -D / 2, D / 2
    front = y0 + 0.018
    box_from(-W / 2, W / 2, front, y1, H - t, H, body)  # top
    box_from(-W / 2, -W / 2 + t, front, y1, 0, H - t, body)  # sides to floor
    box_from(W / 2 - t, W / 2, front, y1, 0, H - t, body)
    box_from(-W / 2 + t, W / 2 - t, front + 0.03, front + 0.03 + t, 0, plinth, m["shadow"], 0)  # recessed plinth
    box_from(-W / 2 + t, W / 2 - t, y1 - 0.01, y1, plinth, H - t, body, 0)  # back
    drawer_grid(-W / 2 + t, W / 2 - t, plinth, H - t, front, cols, rows, body, m["shadow"], "grip")


def classic_dresser(W, D, H, cols, rows, row_weights, finish="white_stain"):
    """Overhanging top, inset carcass, legs with an apron, and knobs."""
    m = M()
    body = m[finish]
    top_t = 0.028
    leg_h = 0.11
    overhang = 0.012
    cw, cd = W - 2 * overhang, D - 2 * overhang
    y0 = -cd / 2
    box_from(-W / 2, W / 2, -D / 2, D / 2, H - top_t, H, body, 0.004, 3)  # top
    box_from(-cw / 2, cw / 2, y0 + 0.02, cd / 2, leg_h, H - top_t, body)  # carcass
    for sx in (-1, 1):
        for sy in (-1, 1):
            lx, ly = sx * (cw / 2 - 0.025), sy * (cd / 2 - 0.025)
            box(0.05, 0.05, leg_h + 0.01, lx, ly, (leg_h + 0.01) / 2, body)
    box_from(-cw / 2, cw / 2, y0, y0 + 0.02, leg_h - 0.04, leg_h + 0.01, body)  # front apron
    drawer_grid(-cw / 2 + 0.02, cw / 2 - 0.02, leg_h + 0.02, H - top_t - 0.015, y0 + 0.02, cols, rows,
                body, m["shadow"], "knobs", row_weights)


def classic_nightstand(W, D, H):
    m = M()
    body = m["white_stain"]
    top_t = 0.025
    leg = 0.04
    overhang = 0.01
    cw, cd = W - 2 * overhang, D - 2 * overhang
    box_from(-W / 2, W / 2, -D / 2, D / 2, H - top_t, H, m["top_white_stain"], 0.004, 3)
    for sx in (-1, 1):
        for sy in (-1, 1):
            box(leg, leg, H - top_t, sx * (cw / 2 - leg / 2), sy * (cd / 2 - leg / 2), (H - top_t) / 2, body)
    # Drawer case under the top, with side and back panels.
    dz0 = H - top_t - 0.17
    box_from(-cw / 2 + leg, cw / 2 - leg, -cd / 2 + 0.02, cd / 2, dz0, H - top_t, body)
    drawer_grid(-cw / 2 + leg, cw / 2 - leg, dz0 + 0.01, H - top_t - 0.01, -cd / 2 + 0.02, 1, 1, body, m["shadow"], "knobs")
    # Open shelf with side and back panels, raised 25 cm off the floor.
    sz = 0.25
    box_from(-cw / 2 + leg, cw / 2 - leg, -cd / 2 + 0.01, cd / 2 - 0.005, sz, sz + 0.018, body)
    box_from(-cw / 2 + leg, cw / 2 - leg, cd / 2 - 0.012, cd / 2 - 0.004, sz, dz0, body, 0)
    side_x = cw / 2 - leg  # inner face of the legs
    box_from(-side_x, -side_x + 0.008, -cd / 2 + leg, cd / 2 - leg, sz, dz0, body, 0)
    box_from(side_x - 0.008, side_x, -cd / 2 + leg, cd / 2 - leg, sz, dz0, body, 0)


def block_table(W, D, H, finish, shelf):
    """Chunky top with square legs flush to the corners."""
    m = M()
    body = m[finish]
    top_t, leg = 0.05, 0.05
    box_from(-W / 2, W / 2, -D / 2, D / 2, H - top_t, H, body, 0.003)
    for sx in (-1, 1):
        for sy in (-1, 1):
            box(leg, leg, H - top_t, sx * (W / 2 - leg / 2), sy * (D / 2 - leg / 2), (H - top_t) / 2, body)
    if shelf:
        box_from(-W / 2 + leg, W / 2 - leg, -D / 2 + leg, D / 2 - leg, 0.10, 0.125, body, 0.002)


def bentwood_armchair(W, D, H):
    """Cantilevered bentwood frame with a curved one-piece cushion."""
    m = M()
    wood = m["birch"]
    yf, yb = -D / 2, D / 2
    rail_x = W / 2 - 0.02
    # Side frame loop: floor runner, front upright, armrest, and back curve to the runner.
    side = catmull_rom([
        (yf + 0.08, 0.02), (yf + 0.03, 0.16), (yf + 0.05, 0.45), (yf + 0.14, 0.56),
        (yb - 0.30, 0.56), (yb - 0.12, 0.40), (yb - 0.06, 0.14), (yb - 0.12, 0.02),
    ], samples=6, closed=True)
    for sx in (-1, 1):
        sweep(side, sx * rail_x, 0.04, 0.026, wood)
    # Cross rails at the floor.
    box_from(-rail_x, rail_x, yf + 0.06, yf + 0.10, 0.005, 0.03, wood)
    box_from(-rail_x, rail_x, yb - 0.16, yb - 0.12, 0.005, 0.03, wood)
    # Cantilever sling: from the front of the armrests, down to the seat and up the reclined back.
    sling = catmull_rom([
        (yf + 0.12, 0.52), (yf + 0.20, 0.40), (yf + 0.42, 0.36), (yb - 0.20, 0.45),
        (yb - 0.08, 0.72), (yb - 0.03, H - 0.06),
    ], samples=7)
    seat_w = W - 0.12
    for sx in (-1, 1):
        sweep(sling, sx * (seat_w / 2 - 0.02), 0.04, 0.024, wood)
    cushion = [(y + 0.0, z + 0.05) for y, z in sling]
    sweep(cushion, 0, seat_w, 0.09, m["cushion_beige"], 0.02)


def rolled_arm_sofa(W, D, H):
    """Slipcovered sofa: skirted base, rounded arms, loose seat and back cushions."""
    m = M()
    f = m["fabric_cream"]
    arm_w, arm_h = 0.2, 0.64
    back_d = 0.22
    seat_top = 0.45
    base_top = 0.33
    yf, yb = -D / 2, D / 2
    box_from(-W / 2 + arm_w - 0.02, W / 2 - arm_w + 0.02, yf + 0.01, yb, 0, base_top, f, 0.02, 3)  # skirted base
    for sx in (-1, 1):
        x0, x1 = (W / 2 - arm_w, W / 2) if sx > 0 else (-W / 2, -W / 2 + arm_w)
        box_from(x0, x1, yf, yb, 0, arm_h - 0.07, f, 0.02, 3)
        # Rolled top of the arm.
        bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=arm_w / 2, depth=D - 0.01,
                                            location=((x0 + x1) / 2, 0.005, arm_h - arm_w / 2),
                                            rotation=(math.pi / 2, 0, 0))
        _finish(bpy.context.active_object, f, 0.015, 3)
    box_from(-W / 2 + arm_w - 0.02, W / 2 - arm_w + 0.02, yb - back_d, yb, base_top - 0.05, H - 0.02, f, 0.03, 4)
    inner = W - 2 * arm_w
    n = 3
    cw = inner / n
    for i in range(n):
        x0 = -inner / 2 + i * cw + 0.005
        box_from(x0, x0 + cw - 0.01, yf + 0.02, yb - back_d, base_top, seat_top, f, 0.04, 4)
        cb = box_from(x0, x0 + cw - 0.01, yb - back_d - 0.17, yb - back_d + 0.02, seat_top, H, f, 0.05, 4)
        cb.rotation_euler = (math.radians(-8), 0, 0)


def tufted_sofa(W, D, H):
    """Mid-century sofa: slim track arms, tufted bench seat and back, tapered legs."""
    m = M()
    lea = m["leather_tan"]
    leg_h = 0.13
    arm_w = 0.12
    arm_h = 27 * IN
    seat_top = 19 * IN
    yf, yb = -D / 2, D / 2
    back_d = 0.2
    frame_top = seat_top - 0.13
    box_from(-W / 2, W / 2, yf + 0.03, yb, leg_h, frame_top, lea, 0.02, 3)  # base frame
    for sx in (-1, 1):
        x0, x1 = (W / 2 - arm_w, W / 2) if sx > 0 else (-W / 2, -W / 2 + arm_w)
        box_from(x0, x1, yf + 0.02, yb, leg_h, arm_h, lea, 0.03, 4)
    box_from(-W / 2 + arm_w - 0.01, W / 2 - arm_w + 0.01, yb - back_d, yb, leg_h, H - 0.02, lea, 0.03, 4)
    inner = W - 2 * arm_w
    box_from(-inner / 2, inner / 2, yf, yb - back_d, frame_top - 0.01, seat_top, lea, 0.04, 4)  # bench seat
    back_cush = box_from(-inner / 2, inner / 2, yb - back_d - 0.12, yb - back_d + 0.02, seat_top, H, lea, 0.05, 4)
    back_cush.rotation_euler = (math.radians(-6), 0, 0)
    # Tufting buttons on the back cushion and seat.
    cols = 6
    for i in range(cols):
        x = -inner / 2 + inner * (i + 0.5) / cols
        for z in (seat_top + 0.14, seat_top + 0.30):
            bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=6, radius=0.009,
                                                 location=(x, yb - back_d - 0.12 + 0.012 + (z - seat_top) * math.tan(math.radians(6)), z))
            bpy.context.active_object.data.materials.append(m["walnut"])
    # Splayed, tapered wood legs.
    for sx in (-1, 1):
        for sy in (-1, 1):
            leg = cyl(0.012, 0.02, leg_h + 0.02, sx * (W / 2 - 0.09), sy * (D / 2 - 0.09), 0, m["walnut"], 16)
            leg.rotation_euler = (math.radians(-8 * sy), math.radians(8 * sx), 0)


def compact_desk(W, D, H):
    """Desk with one side panel, a drawer pedestal on the right and a modesty panel."""
    m = M()
    b = m["white"]
    top_t = 0.025
    t = 0.018
    ped_w = 0.36
    yf, yb = -D / 2, D / 2
    box_from(-W / 2, W / 2, yf, yb, H - top_t, H, b, 0.003)
    box_from(-W / 2, -W / 2 + t, yf + 0.01, yb, 0, H - top_t, b)
    px0 = W / 2 - ped_w
    box_from(px0, px0 + t, yf + 0.01, yb, 0, H - top_t, b)
    box_from(W / 2 - t, W / 2, yf + 0.01, yb, 0, H - top_t, b)
    box_from(-W / 2 + t, px0, yb - 0.03, yb - 0.012, H - top_t - 0.3, H - top_t, b)  # modesty panel
    box_from(px0 + t, W / 2 - t, yb - t, yb, 0.04, H - top_t, b)  # pedestal back
    box_from(px0 + t, W / 2 - t, yf + 0.03, yb - t, 0.04, 0.04 + t, b)  # pedestal bottom shelf
    box_from(px0 + t, W / 2 - t, yf + 0.03, yb - t, 0.36, 0.36 + t, b)  # middle shelf
    drawer_grid(px0 + t, W / 2 - t, H - top_t - 0.17, H - top_t - 0.005, yf + 0.03, 1, 1, b, m["shadow"], "grip")
    # Cable hole in the modesty panel.
    box_from(-0.03, 0.03, yb - 0.0315, yb - 0.03, H - top_t - 0.08, H - top_t - 0.05, m["shadow"], 0)


# ---------------------------------------------------------------- Vancouver additions


def wood_frame_sofa(W, D, H):
    """Boxy track-arm sofa on an exposed wooden base rail with short wood legs."""
    up = mat("Timber upholstery", "#a7a39b", 0.95)
    wood = mat("Honey oak", "#c08a4e", 0.5)
    leg_h, rail_h = 0.09, 0.05
    arm_w, arm_h = 0.16, 26 * IN
    seat_top = 19 * IN
    back_d = 0.2
    yf, yb = -D / 2, D / 2
    box_from(-W / 2, W / 2, yf, yb, leg_h, leg_h + rail_h, wood, 0.006, 2)
    for sx in (-1, 1):
        for sy in (-1, 1):
            box(0.05, 0.05, leg_h, sx * (W / 2 - 0.05), sy * (D / 2 - 0.05), leg_h / 2, wood)
    base_top = leg_h + rail_h
    for sx in (-1, 1):
        x0, x1 = (W / 2 - arm_w, W / 2) if sx > 0 else (-W / 2, -W / 2 + arm_w)
        box_from(x0, x1, yf + 0.01, yb, base_top, arm_h, up, 0.03, 4)
    box_from(-W / 2 + arm_w - 0.01, W / 2 - arm_w + 0.01, yb - back_d, yb, base_top, H - 0.08, up, 0.03, 4)
    inner = W - 2 * arm_w
    deck_top = seat_top - 0.13
    box_from(-inner / 2, inner / 2, yf + 0.01, yb - back_d, base_top, deck_top, up, 0.02, 3)
    cw = inner / 2
    for i in range(2):
        x0 = -inner / 2 + i * cw + 0.005
        box_from(x0, x0 + cw - 0.01, yf + 0.005, yb - back_d, deck_top, seat_top, up, 0.04, 4)
        cb = box_from(x0, x0 + cw - 0.01, yb - back_d - 0.16, yb - back_d + 0.02, seat_top, H, up, 0.05, 4)
        cb.rotation_euler = (math.radians(-7), 0, 0)


def low_sofa(W, D, H, up, legs, seats, backs, seat_top, arm_w=0.12, arm_ratio=0.78, leg_h=0.14, arm_bevel=0.03):
    """Mid-century sofa: slim arms, raised on splayed tapered legs, loose back cushions."""
    yf, yb = -D / 2, D / 2
    back_d = 0.2
    arm_h = H * arm_ratio
    frame_top = seat_top - 0.12
    box_from(-W / 2, W / 2, yf + 0.03, yb, leg_h, frame_top, up, 0.02, 3)
    for sx in (-1, 1):
        x0, x1 = (W / 2 - arm_w, W / 2) if sx > 0 else (-W / 2, -W / 2 + arm_w)
        box_from(x0, x1, yf + 0.02, yb, leg_h, arm_h, up, arm_bevel, 5)
    box_from(-W / 2 + arm_w - 0.01, W / 2 - arm_w + 0.01, yb - back_d, yb, leg_h, H - 0.06, up, 0.03, 4)
    inner = W - 2 * arm_w
    sw = inner / seats
    for i in range(seats):
        x0 = -inner / 2 + i * sw + (0.005 if seats > 1 else 0)
        x1 = x0 + sw - (0.01 if seats > 1 else 0)
        box_from(x0, x1, yf, yb - back_d, frame_top - 0.01, seat_top, up, 0.04, 4)
    bw = inner / backs
    for i in range(backs):
        x0 = -inner / 2 + i * bw + 0.005
        cb = box_from(x0, x0 + bw - 0.01, yb - back_d - 0.14, yb - back_d + 0.02, seat_top, H, up, 0.05, 4)
        cb.rotation_euler = (math.radians(-6), 0, 0)
    for sx in (-1, 1):
        for sy in (-1, 1):
            leg = cyl(0.012, 0.02, leg_h + 0.02, sx * (W / 2 - 0.09), sy * (D / 2 - 0.09), 0, legs, 16)
            leg.rotation_euler = (math.radians(-8 * sy), math.radians(8 * sx), 0)


def angled_arm_sofa(W, D, H):
    """Sofa with outward-leaning arms, two puffy seat cushions and a wide double back."""
    up = mat("Falcon upholstery", "#3a4f6e", 0.95)
    legs = mat("Painted legs", "#2b2b2b", 0.5)
    leg_h, arm_w, arm_h, seat_top, back_d = 0.12, 0.14, 0.62, 0.45, 0.2
    yf, yb = -D / 2, D / 2
    frame_top = seat_top - 0.14
    box_from(-W / 2 + arm_w, W / 2 - arm_w, yf + 0.02, yb, leg_h, frame_top, up, 0.02, 3)
    for sx in (-1, 1):
        x0, x1 = (W / 2 - arm_w, W / 2) if sx > 0 else (-W / 2, -W / 2 + arm_w)
        arm = box_from(x0, x1, yf + 0.02, yb, leg_h, arm_h, up, 0.03, 4)
        arm.rotation_euler = (0, math.radians(10 * sx), 0)
    box_from(-W / 2 + arm_w, W / 2 - arm_w, yb - back_d, yb, leg_h, H - 0.12, up, 0.03, 4)
    inner = W - 2 * arm_w - 0.04
    cw = inner / 2
    for i in range(2):
        x0 = -inner / 2 + i * cw + 0.005
        box_from(x0, x0 + cw - 0.01, yf + 0.01, yb - back_d, frame_top - 0.01, seat_top, up, 0.07, 5)
        cb = box_from(x0, x0 + cw - 0.01, yb - back_d - 0.18, yb - back_d + 0.02, seat_top, H, up, 0.07, 5)
        cb.rotation_euler = (math.radians(-8), 0, 0)
    for sx in (-1, 1):
        for sy in (-1, 1):
            cyl(0.014, 0.022, leg_h, sx * (W / 2 - 0.08), sy * (D / 2 - 0.08), 0, legs, 16)


def platform_bed(W, D, H):
    """High-sided bed frame with a tall headboard (back, +Y), low footboard, mattress and pillows."""
    fin = mat("Bed finish", "#f1f0ec", 0.45)
    soft = mat("Mattress", "#f4f2ee", 0.95)
    side_h, head_t, foot_t, side_t = 0.38, 0.04, 0.03, 0.03
    yf, yb = -D / 2, D / 2
    box_from(-W / 2, W / 2, yb - head_t, yb, 0, H, fin)
    box_from(-W / 2, W / 2, yf, yf + foot_t, 0, side_h, fin)
    box_from(-W / 2, -W / 2 + side_t, yf + foot_t, yb - head_t, 0, side_h, fin)
    box_from(W / 2 - side_t, W / 2, yf + foot_t, yb - head_t, 0, side_h, fin)
    mx0, mx1 = -W / 2 + side_t + 0.005, W / 2 - side_t - 0.005
    box_from(mx0, mx1, yf + foot_t + 0.005, yb - head_t - 0.005, 0.25, 0.47, soft, 0.04, 4)
    n = 2 if W > 1.3 else 1
    pw = (mx1 - mx0) / n
    for i in range(n):
        px0 = mx0 + i * pw + 0.05
        box_from(px0, px0 + pw - 0.1, yb - head_t - 0.5, yb - head_t - 0.1, 0.47, 0.6, soft, 0.05, 4)


def corner_sofa_bed(W, D, H):
    """L-shaped sofa: main seat at the back, chaise on the right reaching the front (-Y)."""
    cov = mat("Sofa cover", "#4c4d4f", 0.95)
    feet = mat("Plastic feet", "#1e1e1e", 0.6)
    sofa_d, chaise_w = 0.88, 0.85
    back_h, seat_top, arm_w, arm_h, back_d = 0.66, 0.45, 0.14, 0.62, 0.17
    yb = D / 2
    ys = yb - sofa_d
    yf = -D / 2
    deck = seat_top - 0.12
    box_from(-W / 2 + arm_w, W / 2 - chaise_w, ys, yb - back_d, 0.04, deck, cov, 0.02, 3)
    box_from(W / 2 - chaise_w, W / 2, yf, yb - back_d, 0.04, deck, cov, 0.02, 3)
    box_from(-W / 2, -W / 2 + arm_w, ys, yb, 0.04, arm_h, cov, 0.03, 4)
    box_from(-W / 2 + arm_w - 0.01, W / 2, yb - back_d, yb, 0.04, back_h, cov, 0.03, 4)
    main_w = W - arm_w - chaise_w
    for i in range(2):
        x0 = -W / 2 + arm_w + i * main_w / 2
        box_from(x0 + 0.005, x0 + main_w / 2 - 0.005, ys + 0.005, yb - back_d, deck, seat_top, cov, 0.04, 4)
    box_from(W / 2 - chaise_w + 0.005, W / 2 - 0.01, yf + 0.01, yb - back_d, deck, seat_top, cov, 0.04, 4)
    span = W - arm_w
    for i in range(3):
        x0 = -W / 2 + arm_w + i * span / 3 + 0.005
        cb = box_from(x0, x0 + span / 3 - 0.01, yb - back_d - 0.16, yb - back_d + 0.02, seat_top, H, cov, 0.05, 4)
        cb.rotation_euler = (math.radians(-8), 0, 0)
    for fx, fy in ((-W / 2 + 0.05, ys + 0.05), (-W / 2 + 0.05, yb - 0.05), (W / 2 - 0.05, yf + 0.05), (W / 2 - 0.05, yb - 0.05)):
        box(0.05, 0.05, 0.04, fx, fy, 0.02, feet, 0.005)


def mid_century_dresser(W, D, H):
    """Wood case on splayed tapered legs with two columns of drawers and tab pulls."""
    m = M()
    case = mat("Case finish", "#8a5a35", 0.5)
    bronze = mat("Antique bronze", "#6b5232", 0.4, 0.8)
    leg_h = 0.16
    yf, yb = -D / 2, D / 2
    front = yf + 0.02
    box_from(-W / 2, W / 2, front, yb, leg_h, H, case, 0.008, 3)
    for sx in (-1, 1):
        for sy in (-1, 1):
            leg = cyl(0.012, 0.022, leg_h + 0.02, sx * (W / 2 - 0.07), sy * (D / 2 - 0.07), 0, case, 16)
            leg.rotation_euler = (math.radians(-6 * sy), math.radians(6 * sx), 0)
    drawer_grid(-W / 2 + 0.03, W / 2 - 0.03, leg_h + 0.03, H - 0.03, front, 2, 3, case, m["shadow"], "tab",
                handle_mat=bronze)


# ---------------------------------------------------------------- catalog

PRODUCTS = [
    # id, builder, (W, D, H) in meters
    ("cube-shelf-2x4", lambda W, D, H: cube_shelf(W, D, H, 2, 4), (77 * CM, 39 * CM, 147 * CM)),
    ("cube-shelf-4x4", lambda W, D, H: cube_shelf(W, D, H, 4, 4), (147 * CM, 39 * CM, 147 * CM)),
    ("tall-bookcase", bookcase, (80 * CM, 28 * CM, 202 * CM)),
    ("modern-6-drawer-dresser", lambda W, D, H: modern_dresser(W, D, H, 2, 3), (160 * CM, 48 * CM, 78 * CM)),
    ("modern-3-drawer-chest", lambda W, D, H: modern_dresser(W, D, H, 1, 3), (80 * CM, 48 * CM, 78 * CM)),
    ("classic-8-drawer-dresser", lambda W, D, H: classic_dresser(W, D, H, 2, 4, [0.7, 1, 1, 1]), (160 * CM, 50 * CM, 96 * CM)),
    ("classic-nightstand", classic_nightstand, (46 * CM, 35 * CM, 70 * CM)),
    ("square-side-table", lambda W, D, H: block_table(W, D, H, "white", False), (55 * CM, 55 * CM, 45 * CM)),
    ("coffee-table-with-shelf", lambda W, D, H: block_table(W, D, H, "black_brown", True), (90 * CM, 55 * CM, 45 * CM)),
    ("bentwood-armchair", bentwood_armchair, (68 * CM, 82 * CM, 100 * CM)),
    ("rolled-arm-3-seat-sofa", rolled_arm_sofa, (218 * CM, 88 * CM, 88 * CM)),
    ("tufted-mid-century-sofa", tufted_sofa, (88 * IN, 38.5 * IN, 34.5 * IN)),
    ("compact-desk", compact_desk, (105 * CM, 50 * CM, 75 * CM)),
    # Vancouver additions
    ("wood-frame-3-seat-sofa", wood_frame_sofa, (90 * IN, 35 * IN, 32 * IN)),
    ("low-profile-sofa", lambda W, D, H: low_sofa(W, D, H, mat("Ceni upholstery", "#77777a", 0.95), M()["walnut"],
                                                  seats=1, backs=2, seat_top=0.42, arm_ratio=0.72, arm_bevel=0.05),
     (83 * IN, 34 * IN, 31 * IN)),
    ("mid-century-3-seat-sofa", lambda W, D, H: low_sofa(W, D, H, mat("Reve upholstery", "#b3a99a", 0.95),
                                                         mat("Rubberwood", "#c49a6c", 0.5), seats=3, backs=3,
                                                         seat_top=0.45),
     (196 * CM, 84 * CM, 87 * CM)),
    ("angled-arm-3-seat-sofa", angled_arm_sofa, (190 * CM, 86 * CM, 85 * CM)),
    ("high-platform-bed-queen", platform_bed, (168 * CM, 211 * CM, 100 * CM)),
    ("corner-sofa-bed", corner_sofa_bed, (230 * CM, 151 * CM, 86 * CM)),
    ("mid-century-6-drawer-dresser", mid_century_dresser, (56 * IN, 18 * IN, 36 * IN)),
]

# ---------------------------------------------------------------- pipeline


def reset_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    for block in (bpy.data.meshes, bpy.data.curves):
        for item in list(block):
            block.remove(item)
    _mats.clear()
    for m in list(bpy.data.materials):
        bpy.data.materials.remove(m)


def finalize(name, target):
    """Apply modifiers, join into one mesh, then center, floor and snap to the exact target size."""
    bpy.ops.object.select_all(action="SELECT")
    objs = list(bpy.context.selected_objects)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.convert(target="MESH")
    bpy.ops.object.join()
    obj = bpy.context.active_object
    obj.name = name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    vs = [v.co for v in obj.data.vertices]
    lo = [min(v[i] for v in vs) for i in range(3)]
    hi = [max(v[i] for v in vs) for i in range(3)]
    size = [hi[i] - lo[i] for i in range(3)]
    scale = [target[i] / size[i] for i in range(3)]
    cx, cy = (lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2
    for v in obj.data.vertices:
        v.co.x = (v.co.x - cx) * scale[0]
        v.co.y = (v.co.y - cy) * scale[1]
        v.co.z = (v.co.z - lo[2]) * scale[2]
    obj.data.update()

    try:
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(35))
    except Exception:
        try:
            bpy.ops.object.shade_auto_smooth(angle=math.radians(35))
        except Exception:
            pass

    # Verify the exported geometry matches the target within 1 mm and sits on the floor.
    vs = [v.co for v in obj.data.vertices]
    lo = [min(v[i] for v in vs) for i in range(3)]
    hi = [max(v[i] for v in vs) for i in range(3)]
    final = [hi[i] - lo[i] for i in range(3)]
    assert all(abs(final[i] - target[i]) < 0.001 for i in range(3)), (name, final, target)
    assert abs(lo[2]) < 1e-4 and abs(lo[0] + hi[0]) < 1e-4 and abs(lo[1] + hi[1]) < 1e-4, (name, lo, hi)
    drift = max(abs(s - 1) for s in scale)
    print(f"[ok] {name}: {final[0]:.3f} x {final[1]:.3f} x {final[2]:.3f} m  "
          f"(built {size[0]:.3f} x {size[1]:.3f} x {size[2]:.3f}, max snap correction {drift * 100:.1f}%)")
    return obj, final


def render_preview(obj, path):
    """Optional 3/4 view render for visually checking a model (set PREVIEW_DIR)."""
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE" if "BLENDER_EEVEE" in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items] else "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = scene.render.resolution_y = 480
    scene.render.film_transparent = False
    world = bpy.data.worlds.new("w") if not scene.world else scene.world
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.8, 0.8, 0.8, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    dims = obj.dimensions
    r = max(dims) * 1.9
    cam_data = bpy.data.cameras.new("cam")
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    cam.location = (r * 0.75, -r * 1.1, dims.z * 0.5 + r * 0.55)
    target = bpy.data.objects.new("target", None)
    scene.collection.objects.link(target)
    target.location = (0, 0, dims.z / 2)
    c = cam.constraints.new("TRACK_TO")
    c.target = target
    scene.camera = cam
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3
    sun.rotation_euler = (math.radians(50), 0, math.radians(30))
    scene.collection.objects.link(sun)
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    for o in (cam, target, sun):
        bpy.data.objects.remove(o)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    manifest = []
    for pid, builder, target in PRODUCTS:
        reset_scene()
        builder(*target)
        obj, final = finalize(pid, target)
        obj.select_set(True)
        path = os.path.join(OUT_DIR, f"{pid}.glb")
        bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True, export_yup=True)
        if os.environ.get("PREVIEW_DIR"):
            render_preview(obj, os.path.join(os.environ["PREVIEW_DIR"], f"{pid}.png"))
        manifest.append({"id": pid, "file": f"{pid}.glb", "width": final[0], "depth": final[1], "height": final[2],
                         "bytes": os.path.getsize(path)})
    with open(os.path.join(OUT_DIR, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"Exported {len(manifest)} models to {OUT_DIR}")


main()
