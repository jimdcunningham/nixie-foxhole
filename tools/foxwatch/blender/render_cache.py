"""Content-verified render reuse, independent of Blender and filesystem mtimes."""
import hashlib
import json
import os
import struct
import tempfile
from urllib.parse import unquote

SCHEMA_VERSION = 1
RENDER_SOURCE_FILES = (
    "render_render_scenes.py", "import_render_scene.py", "render_scene_common.py",
    "render_scene_graph.py", "render_scene_transforms.py", "script_bootstrap.py",
    "render_cache.py",
)

def content_hash(file_path):
    digest = hashlib.sha256()
    with open(file_path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()

def value_hash(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()

def visual_document(document):
    # Identity controls output paths. Names, descriptions, categories, and balance
    # metadata in structure do not affect pixels; render/scene/assets/variants do.
    structure = document.get("structure") or {}
    return {
        **{key: value for key, value in document.items() if key != "structure"},
        "structure": {key: structure[key] for key in ("id", "assetType") if key in structure},
    }

def load_gltf(file_path):
    if file_path.lower().endswith(".gltf"):
        with open(file_path, encoding="utf-8") as handle:
            return json.load(handle)
    with open(file_path, "rb") as handle:
        header = handle.read(12)
        if len(header) != 12:
            raise ValueError(f"Incomplete mesh container: {file_path}")
        magic, version, _ = struct.unpack("<III", header)
        if magic != 0x46546C67 or version != 2:
            raise ValueError(f"Unsupported mesh container: {file_path}")
        chunk = handle.read(8)
        if len(chunk) != 8:
            raise ValueError(f"Incomplete GLB chunk: {file_path}")
        size, kind = struct.unpack("<II", chunk)
        if kind != 0x4E4F534A:
            raise ValueError(f"Missing GLB JSON chunk: {file_path}")
        return json.loads(handle.read(size))

class RenderCache:
    def __init__(self, directory, settings, source_directory, template_path,
                 resolve_asset, resolve_material, resolve_texture):
        self.directory = os.path.abspath(directory)
        self.resolve_asset = resolve_asset
        self.resolve_material = resolve_material
        self.resolve_texture = resolve_texture
        self.input_hashes = {}
        self.gltf_documents = {}
        self.material_documents = {}
        sources = {name: content_hash(os.path.join(source_directory, name)) for name in RENDER_SOURCE_FILES}
        self.environment = {"schemaVersion": SCHEMA_VERSION, "settings": settings, "sources": sources,
                            "template": content_hash(template_path) if template_path else None}

    def hash_input(self, file_path):
        if file_path is None:
            return None
        normalized = os.path.abspath(file_path)
        if normalized not in self.input_hashes:
            self.input_hashes[normalized] = content_hash(normalized) if os.path.isfile(normalized) else None
        return self.input_hashes[normalized]

    def dependencies(self, document):
        dependencies = {}
        def add(label, file_path):
            dependencies[label] = [os.path.abspath(file_path) if file_path else None, self.hash_input(file_path)]

        material_names = set()
        for mesh in (document.get("assets") or {}).get("meshes") or []:
            source = mesh.get("exportUrl") or mesh.get("sourcePath")
            mesh_path = self.resolve_asset(source)
            add(f"mesh:{source}", mesh_path)
            if mesh_path:
                if mesh_path not in self.gltf_documents:
                    self.gltf_documents[mesh_path] = load_gltf(mesh_path)
                gltf = self.gltf_documents[mesh_path]
                material_names.update(material["name"] for material in gltf.get("materials", []) if material.get("name"))
                for resource in [*gltf.get("images", []), *gltf.get("buffers", [])]:
                    uri = resource.get("uri")
                    if uri and not uri.startswith("data:"):
                        if "://" in uri:
                            raise ValueError("Remote glTF resources cannot be content verified")
                        add(f"gltf:{source}:{uri}", os.path.join(os.path.dirname(mesh_path), unquote(uri)))
            if mesh.get("materialSidecarNameOverride"):
                material_names.add(mesh["materialSidecarNameOverride"])
            for overrides in (mesh.get("materialSidecarNameOverridesByVariant") or {}).values():
                material_names.update(name for name in overrides.values() if name)

        for material in (document.get("assets") or {}).get("materials") or []:
            source = material.get("exportUrl") or material.get("sourcePath")
            if source:
                add(f"asset:{source}", self.resolve_asset(source))

        for name in sorted(material_names):
            material_path = self.resolve_material(name)
            add(f"material:{name}", material_path)
            if material_path:
                if material_path not in self.material_documents:
                    with open(material_path, encoding="utf-8") as handle:
                        self.material_documents[material_path] = json.load(handle)
                for key, reference in (self.material_documents[material_path].get("Textures") or {}).items():
                    if reference:
                        add(f"texture:{name}:{key}:{reference}", self.resolve_texture(reference))
        return dependencies

    def fingerprint(self, scenes, output_paths):
        inputs = [{"entry": entry, "document": visual_document(document),
                   "dependencies": self.dependencies(document)} for entry, document in scenes]
        return value_hash({"environment": self.environment, "scenes": inputs,
                           "outputs": sorted(os.path.abspath(p) for p in output_paths)})

    def record_path(self, group):
        return os.path.join(self.directory, value_hash(group) + ".json")

    def lookup(self, group, fingerprint, output_paths):
        try:
            with open(self.record_path(group), encoding="utf-8") as handle:
                record = json.load(handle)
            if not isinstance(record, dict) or record.get("schemaVersion") != SCHEMA_VERSION or record.get("fingerprint") != fingerprint:
                return False
            outputs = record.get("outputs")
            if not isinstance(outputs, dict) or set(outputs) != {os.path.abspath(p) for p in output_paths}:
                return False
            return bool(outputs) and all(content_hash(file_path) == digest for file_path, digest in outputs.items())
        except (OSError, ValueError, TypeError):
            return False

    def store(self, group, fingerprint, output_paths):
        # Commit only complete groups after every deferred image operation. A
        # crash/recycled worker cannot bless incomplete images or missing sidecars.
        outputs = {os.path.abspath(p): content_hash(p) for p in output_paths}
        record = {"schemaVersion": SCHEMA_VERSION, "fingerprint": fingerprint, "outputs": outputs}
        os.makedirs(self.directory, exist_ok=True)
        descriptor, temporary_path = tempfile.mkstemp(prefix="render-cache-", suffix=".tmp", dir=self.directory)
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                json.dump(record, handle, sort_keys=True)
                handle.write("\n")
            os.replace(temporary_path, self.record_path(group))
        finally:
            if os.path.exists(temporary_path):
                os.remove(temporary_path)
