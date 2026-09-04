# test/unit/expedientes

Las tres reglas del expediente que, si fallan, **no rompen nada visible**.

| Spec | Qué fija |
|---|---|
| `niveles.spec.ts` | La escala de acceso y su orden. Reordenarla haría que `escribir` incluyera `administrar` sin que ninguna otra prueba lo notara. |
| `concesion.service.spec.ts` | El nivel efectivo: el mayor de las tres fuentes, la herencia que baja pero no sube, la revocación, y los dos techos —congelado y purgado— que ningún permiso levanta. |
| `nodo.service.spec.ts` | El árbol: nombres duplicados que sobrescribirían la selfie anterior, movimientos circulares que desconectan un subárbol de la raíz, y el renombrado que dejaba a los nietos apuntando a una ruta inexistente. |

Ninguno de esos tres defectos lanza un error en producción. Todos pierden archivos.
