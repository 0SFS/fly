"""Render an aircraft's gallery thumbnail from its GLB, without a browser.

    blender --background --factory-startup --disable-autoexec \\
      --python ../fly/scripts/render-aircraft-thumbnail.py -- \\
      public/3d_model/HD/model.glb public/aircraft/thumbnails/family.png

Draws the model's own materials and textures with Blender Workbench and studio
light, as the F-35B thumbnail is drawn, in an orthographic view framed from the
projected vertices so the whole aircraft fits. The view looks from `--azimuth`
degrees off the model's glTF +Z axis toward +X and `--elevation` degrees above
its ground plane. The light background keeps dark airframes visible on the
gallery's dark card. Set TMPDIR to keep Blender's temporary files in the
repository's build/.
"""

import argparse
import json
import math
from pathlib import Path
import sys

import bpy
from mathutils import Vector

arguments = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("source", type=Path)
parser.add_argument("output", type=Path)
parser.add_argument("--azimuth", type=float, default=40)
parser.add_argument("--elevation", type=float, default=25)
parser.add_argument("--width", type=int, default=640)
parser.add_argument("--height", type=int, default=400)
parser.add_argument("--margin", type=float, default=1.12,
                    help="Frame size divided by projected aircraft size, at least 1.")
args = parser.parse_args(arguments)
if args.width <= 0 or args.height <= 0 or not math.isfinite(args.margin) or args.margin < 1:
    raise ValueError("Positive image dimensions and margin >= 1 required")
source, output = args.source.resolve(), args.output.resolve()

bpy.context.preferences.filepaths.use_scripts_auto_execute = False
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(source))
scene = bpy.context.scene
points = [obj.matrix_world @ vertex.co for obj in scene.objects if obj.type == "MESH"
          for vertex in obj.data.vertices]
if not points:
    raise ValueError(f"No aircraft vertices in {source}")
low = Vector([min(point[axis] for point in points) for axis in range(3)])
high = Vector([max(point[axis] for point in points) for axis in range(3)])
centre, dimensions = (low + high) / 2, high - low

scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "STUDIO"
scene.display.shading.color_type = "TEXTURE"
scene.display.shading.background_type = "WORLD"
world = bpy.data.worlds.new("thumbnail_background")
world.color = (0.8, 0.85, 0.9)
scene.world = world
scene.render.resolution_x, scene.render.resolution_y = args.width, args.height
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
# The background is opaque; lossless maximum compression keeps the gallery light.
scene.render.image_settings.color_mode = "RGB"
scene.render.image_settings.compression = 100

camera = bpy.data.objects.new("thumbnail_camera", bpy.data.cameras.new("thumbnail_camera"))
scene.collection.objects.link(camera)
scene.camera = camera
camera.data.type = "ORTHO"
# Blender imports glTF (x, y, z) as (x, -z, y).
azimuth, elevation = math.radians(args.azimuth), math.radians(args.elevation)
direction = Vector((math.sin(azimuth) * math.cos(elevation),
                    -math.cos(azimuth) * math.cos(elevation), math.sin(elevation)))
camera.location = centre + direction * dimensions.length * 2
camera.rotation_euler = (-direction).to_track_quat("-Z", "Y").to_euler()
inverse_rotation = camera.rotation_euler.to_matrix().transposed()
projected = [inverse_rotation @ (point - centre) for point in points]
x_low, x_high = min(point.x for point in projected), max(point.x for point in projected)
y_low, y_high = min(point.y for point in projected), max(point.y for point in projected)
camera.data.ortho_scale = 1
unit_frame = camera.data.view_frame(scene=scene)
unit_width = max(point.x for point in unit_frame) - min(point.x for point in unit_frame)
unit_height = max(point.y for point in unit_frame) - min(point.y for point in unit_frame)
camera.data.ortho_scale = max((x_high - x_low) / unit_width,
                             (y_high - y_low) / unit_height) * args.margin
camera.location += camera.rotation_euler.to_matrix() @ Vector(((x_low + x_high) / 2,
                                                              (y_low + y_high) / 2, 0))

output.parent.mkdir(parents=True, exist_ok=True)
scene.render.filepath = str(output)
bpy.ops.render.render(write_still=True)
print("AIRCRAFT_THUMBNAIL " + json.dumps({"output": str(output), "sizeMeters": list(dimensions),
                                         "azimuthDegrees": args.azimuth, "elevationDegrees": args.elevation}))
