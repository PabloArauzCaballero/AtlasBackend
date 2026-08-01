"""Reescribe los enlaces de la documentación que apuntan a archivos del repositorio.

Problema que resuelve
---------------------
La documentación de Atlas enlaza código a propósito: un runbook que dice "el TTL se valida en
``src/config/env.ts``" es verificable solo si ese enlace se puede seguir. Escritos como rutas
relativas (``../../src/config/env.ts``) funcionan en GitHub y en el IDE, que es donde vive la
mayoría del trabajo — pero MkDocs los resuelve contra ``docs_dir`` y, al escaparse de él, no
encuentra destino. Con ``strict: true`` eso aborta el build.

Las tres salidas posibles eran: bajar el gate (perder la garantía de enlaces vivos), reescribir 82
enlaces a URLs absolutas (romperlos en GitHub y en el IDE, que es donde más se usan), o traducirlos
al publicar. Esta es la tercera: la fuente conserva rutas relativas navegables en el repositorio y
el portal recibe URLs absolutas al blob de GitHub.

Solo se tocan los enlaces que SE ESCAPAN de ``docs/``. Los internos entre páginas se dejan intactos,
que es justo lo que ``strict`` debe seguir verificando: si alguien renombra una página y rompe un
enlace interno, el build sigue fallando.
"""

from __future__ import annotations

import posixpath
import re
from typing import Any

# Enlaces markdown ``[texto](destino)`` con destino relativo. Se excluyen anclas, URLs absolutas y
# esquemas (``http:``, ``mailto:``) porque no son rutas del repositorio.
_LINK = re.compile(r"\[([^\]]*)\]\((?!https?://|/|#|mailto:)([^)\s]+)(\s+\"[^\"]*\")?\)")


def _repo_blob_base(config: Any) -> str:
    repo_url = str(config.get("repo_url") or "").rstrip("/")
    if not repo_url:
        return ""
    ref = str((config.get("extra") or {}).get("repo_ref") or "main")
    return f"{repo_url}/blob/{ref}"


def _escapes_docs_dir(page_dir: str, target: str) -> str | None:
    """Devuelve la ruta relativa a la raíz del repositorio, o ``None`` si el enlace no escapa.

    ``page_dir`` es el directorio de la página dentro de ``docs/``. Un destino que tras normalizar
    empieza por ``../`` salió del árbol de documentación; quitar ese primer nivel lo deja relativo a
    la raíz del repositorio, porque ``docs/`` cuelga directamente de ella.
    """
    normalized = posixpath.normpath(posixpath.join(page_dir, target))
    if not normalized.startswith("../"):
        return None
    remainder = normalized[3:]
    # Un segundo nivel de escape apuntaría fuera del repositorio: no se reescribe, y MkDocs seguirá
    # avisando. Es un enlace mal escrito, no un caso legítimo que este hook deba tapar.
    return None if remainder.startswith("../") else remainder


# Delimitador de bloque de código cercado (``` o ~~~, con o sin lenguaje).
_FENCE = re.compile(r"^\s{0,3}(`{3,}|~{3,})")


def on_page_markdown(markdown: str, page: Any, config: Any, files: Any) -> str:  # noqa: ARG001
    base = _repo_blob_base(config)
    if not base:
        return markdown

    page_dir = posixpath.dirname(page.file.src_uri)

    def replace(match: re.Match[str]) -> str:
        text, target, title = match.group(1), match.group(2), match.group(3) or ""
        path, _, fragment = target.partition("#")
        if not path:
            return match.group(0)
        repo_path = _escapes_docs_dir(page_dir, path)
        if repo_path is None:
            return match.group(0)
        suffix = f"#{fragment}" if fragment else ""
        return f"[{text}]({base}/{repo_path}{suffix}{title})"

    # Se procesa línea a línea saltando los bloques de código: dentro de un ejemplo, `[x](../../y)`
    # es texto que el lector debe ver tal cual —muchas veces es precisamente el fragmento markdown
    # que se está explicando—, no un enlace que reescribir.
    lines = markdown.split("\n")
    inside_fence = False
    fence_marker = ""
    for index, line in enumerate(lines):
        fence = _FENCE.match(line)
        if fence:
            marker = fence.group(1)
            if not inside_fence:
                inside_fence, fence_marker = True, marker[0]
            elif marker[0] == fence_marker:
                inside_fence, fence_marker = False, ""
            continue
        if not inside_fence:
            lines[index] = _LINK.sub(replace, line)
    return "\n".join(lines)
