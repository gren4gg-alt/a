# ============================================================
# BAKE AND EXPORT
#
# Append this to the bottom of the chair script (or any of the
# others). It turns the procedural wood into a real image and
# writes a .glb the game can use.
#
# Why it is needed: glTF carries a base colour, a set of image
# textures, and nothing else. A Noise -> Wave -> MixRGB ->
# ColorRamp graph is not something the format can describe, so
# when the exporter finds Base Color connected to nodes it
# cannot follow, it gives up and writes baseColorFactor
# [1, 1, 1, 1] -- pure white. That is the whole bug. The nails
# and the scratches came out fine because their Base Color is a
# plain unlinked value, which the exporter just copies.
#
# Baking evaluates the graph once, per texel, into an image.
# After that the material is a picture, which glTF understands.
# ============================================================

import bpy
import math
import os


# Where the .glb goes. Change this.
EXPORT_DIR = bpy.path.abspath("//") or os.path.expanduser("~")
EXPORT_NAME = "chair"

# 1024 is plenty for a chair -- it is a metre tall on screen and
# usually in the dark. 2048 if it is something you walk right up
# to, like the door.
BAKE_SIZE = 1024

# The material to bake, and the name the baked image gets.
TARGET_MATERIAL = wood            # noqa: F821  (defined above in the script)


# ------------------------------------------------------------
# 1. Apply modifiers.
#
# The bevel has to be real geometry before the UVs are made, or
# the unwrap describes a mesh that is not the one being baked
# and the bevelled edges sample from the wrong place.
# ------------------------------------------------------------

def apply_modifiers(objects):
    for obj in objects:
        bpy.context.view_layer.objects.active = obj
        for mod in list(obj.modifiers):
            try:
                bpy.ops.object.modifier_apply(modifier=mod.name)
            except RuntimeError:
                # Already applied, or the object is linked. Not fatal.
                pass


# ------------------------------------------------------------
# 2. One shared UV atlas across every piece.
#
# Smart UV Project in multi-object edit mode packs all selected
# objects into the same 0-1 square, which is exactly what is
# wanted here: every piece shares one material, so every piece
# has to share one image, so no two islands may overlap.
# ------------------------------------------------------------

def unwrap_together(objects):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]

    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    try:
        # Blender 3.x and later want radians here.
        bpy.ops.uv.smart_project(
            angle_limit=math.radians(66),
            island_margin=0.02,
        )
    except TypeError:
        # Blender 2.8x wanted degrees.
        bpy.ops.uv.smart_project(angle_limit=66.0, island_margin=0.02)
    bpy.ops.object.mode_set(mode='OBJECT')


# ------------------------------------------------------------
# 3. Bake the graph down to that atlas.
# ------------------------------------------------------------

def bake_base_colour(objects, material, image_name, size):
    img = bpy.data.images.new(image_name, size, size, alpha=False)
    img.colorspace_settings.name = 'sRGB'

    tree = material.node_tree
    tex = tree.nodes.new('ShaderNodeTexImage')
    tex.image = img
    tex.label = "BAKED BASE COLOUR"
    tex.location = (-400, 400)
    # The bake target is whichever image node is ACTIVE. This
    # line is the one everybody forgets.
    tree.nodes.active = tex

    scene = bpy.context.scene
    previous_engine = scene.render.engine
    scene.render.engine = 'CYCLES'
    # Colour-only, so it does not matter how noisy the render
    # would be -- there is no light transport to sample.
    scene.cycles.samples = 4
    scene.cycles.bake_type = 'DIFFUSE'
    scene.render.bake.use_pass_direct = False
    scene.render.bake.use_pass_indirect = False
    scene.render.bake.use_pass_color = True
    # Bleed the colour a few pixels past each island edge, or a
    # seam shows as a dark line once the game mipmaps it.
    scene.render.bake.margin = 8

    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]

    bpy.ops.object.bake(type='DIFFUSE')
    scene.render.engine = previous_engine

    # Save it next to the .glb. The exporter can pack a
    # generated image, but a file on disk is easier to look at
    # when something is wrong.
    img.filepath_raw = os.path.join(EXPORT_DIR, image_name + ".png")
    img.file_format = 'PNG'
    img.save()
    return tex


# ------------------------------------------------------------
# 4. Rewire so the exporter sees a picture, not a graph.
# ------------------------------------------------------------

def use_baked_image(material, tex):
    tree = material.node_tree
    bsdf = tree.nodes.get("Principled BSDF")

    for link in list(tree.links):
        if link.to_node is bsdf and link.to_socket.name in ("Base Color", "Normal"):
            tree.links.remove(link)

    tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    # The bump is gone too. It was never going to survive: the
    # game draws furniture with a flat material and lights it
    # with the torch, so there is nothing for a normal to do.


# ------------------------------------------------------------
# 5. Point the front of the chair at -Z.
#
# Blender is Z-up and the exporter converts (x, y, z) to
# (x, z, -y), so Blender +Y comes out as glTF -Z. The backrest
# is built at +CHAIR_DEPTH/2, which means it lands on the -Z
# side and the chair faces backwards -- every chair the
# generator puts against a wall would have its back to the room.
# Half a turn fixes it at the source.
# ------------------------------------------------------------

def face_forward(objects):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.transform.rotate(value=math.pi, orient_axis='Z', orient_type='GLOBAL')
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)


# ------------------------------------------------------------
# Run it.
# ------------------------------------------------------------

everything = [o for o in bpy.context.scene.objects if o.type == 'MESH']
wood_objects = [
    o for o in everything
    if any(slot.material is TARGET_MATERIAL for slot in o.material_slots)
]

if not wood_objects:
    raise RuntimeError("nothing is using the wood material")

apply_modifiers(everything)
unwrap_together(wood_objects)
baked = bake_base_colour(wood_objects, TARGET_MATERIAL, "chair_wood_baked", BAKE_SIZE)
use_baked_image(TARGET_MATERIAL, baked)
face_forward(everything)

bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(
    filepath=os.path.join(EXPORT_DIR, EXPORT_NAME + ".glb"),
    export_format='GLB',
    use_selection=True,
    export_apply=True,
    export_yup=True,
)

print("==========================================")
print(" BAKED AND EXPORTED ->", os.path.join(EXPORT_DIR, EXPORT_NAME + ".glb"))
print("==========================================")
