"""Descarta del portal los README de inventario que chocan con una página curada.

`yarn docs:project` genera un `README.md` por carpeta con el inventario de sus archivos. Dentro del
repositorio son útiles: es lo que GitHub muestra al entrar a la carpeta. En el portal, en cambio,
una carpeta con página curada (`index.md`) tiene ambos resolviendo a la misma URL, y MkDocs avisa
del conflicto — que con ``strict: true`` aborta el build.

La regla se aplica aquí y no con una lista fija en ``exclude_docs`` porque una lista hay que
mantenerla: la primera vez fueron tres carpetas, a la semana siguiente seis, y cada sección curada
nueva volvería a romper el build hasta que alguien recordara añadirla. La condición real es "hay un
index.md al lado", y eso se puede comprobar en vez de enumerarlo.

Se engancha en ``on_config`` y no en ``on_files`` a propósito: MkDocs emite el aviso de conflicto
mientras CONSTRUYE la colección de archivos, así que para entonces ya es tarde. ``exclude_docs`` se
evalúa antes, y es el único punto donde el descarte llega a tiempo.

Los README de carpetas SIN página curada se conservan: allí son el contenido de la sección (por
ejemplo ``adr/README.md``, que además está en la navegación).
"""

from __future__ import annotations

import os
from typing import Any

import pathspec


def _generated_readmes_with_curated_index(docs_dir: str) -> list[str]:
    patterns: list[str] = []
    for root, _dirs, files in os.walk(docs_dir):
        names = {name.lower() for name in files}
        if "readme.md" not in names or "index.md" not in names:
            continue
        relative = os.path.relpath(root, docs_dir).replace(os.sep, "/")
        prefix = "" if relative == "." else f"{relative}/"
        # Ancladas con `/` inicial: en sintaxis .gitignore un patrón sin barra coincidiría a
        # cualquier profundidad y descartaría también los README que sí son contenido.
        patterns.append(f"/{prefix}README.md")
    return sorted(patterns)


def on_config(config: Any) -> Any:
    docs_dir = config.get("docs_dir")
    if not docs_dir or not os.path.isdir(docs_dir):
        return config

    patterns = _generated_readmes_with_curated_index(docs_dir)
    if not patterns:
        return config

    existing = config.get("exclude_docs")
    combined = list(getattr(existing, "patterns", []) or [])
    combined.extend(pathspec.PathSpec.from_lines("gitwildmatch", patterns).patterns)
    config["exclude_docs"] = pathspec.PathSpec(combined)
    return config
