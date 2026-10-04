#!/usr/bin/env python3
"""Gráfico de las últimas 24 h del servidor de TEST (RAM libre, disco y carga) como PNG.

Sólo biblioteca estándar: el servidor no tiene PIL ni matplotlib y no se instala nada en el host.
Escribe el PNG a mano (zlib) con una fuente 5x7 incrustada. Coste: ~0,2 s de CPU por imagen, y sólo se
genera cuando alguien pide /estado o a las 08:00.

Uso: grafico.py hist.tsv salida.png RAM_TOTAL_GB NUCLEOS
hist.tsv: una fila por pasada del monitor, separada por tabuladores:
    epoch  ram_disponible_mb  swap_libre_mb  carga1  disco_pct  cache_gb
"""
import struct
import sys
import time
import zlib

ANCHO, ALTO = 900, 640
BLANCO, GRIS, GRIS_OSC, NEGRO = (255, 255, 255), (228, 228, 228), (150, 150, 150), (30, 30, 30)
AZUL, ROJO, AMBAR, VERDE = (36, 99, 235), (220, 38, 38), (217, 119, 6), (22, 163, 74)

# Fuente 5x7: cada glifo son 7 filas de 5 bits (bit más alto = columna izquierda).
FUENTE = {
    '0': [14, 17, 19, 21, 25, 17, 14], '1': [4, 12, 4, 4, 4, 4, 14], '2': [14, 17, 1, 2, 4, 8, 31],
    '3': [31, 2, 4, 2, 1, 17, 14], '4': [2, 6, 10, 18, 31, 2, 2], '5': [31, 16, 30, 1, 1, 17, 14],
    '6': [6, 8, 16, 30, 17, 17, 14], '7': [31, 1, 2, 4, 8, 8, 8], '8': [14, 17, 17, 14, 17, 17, 14],
    '9': [14, 17, 17, 15, 1, 2, 12], '.': [0, 0, 0, 0, 0, 12, 12], ':': [0, 12, 12, 0, 12, 12, 0],
    '%': [24, 25, 2, 4, 8, 19, 3], '-': [0, 0, 0, 31, 0, 0, 0], '/': [1, 1, 2, 4, 8, 16, 16],
    ' ': [0] * 7, '(': [2, 4, 8, 8, 8, 4, 2], ')': [8, 4, 2, 2, 2, 4, 8],
    'A': [14, 17, 17, 31, 17, 17, 17], 'B': [30, 17, 17, 30, 17, 17, 30], 'C': [14, 17, 16, 16, 16, 17, 14],
    'D': [30, 17, 17, 17, 17, 17, 30], 'E': [31, 16, 16, 30, 16, 16, 31], 'G': [14, 17, 16, 23, 17, 17, 15],
    'H': [17, 17, 17, 31, 17, 17, 17], 'I': [14, 4, 4, 4, 4, 4, 14], 'L': [16, 16, 16, 16, 16, 16, 31],
    'M': [17, 27, 21, 21, 17, 17, 17], 'N': [17, 25, 21, 19, 17, 17, 17], 'O': [14, 17, 17, 17, 17, 17, 14],
    'R': [30, 17, 17, 30, 20, 18, 17], 'S': [15, 16, 16, 14, 1, 1, 30], 'T': [31, 4, 4, 4, 4, 4, 4],
    'U': [17, 17, 17, 17, 17, 17, 14], 'X': [17, 17, 10, 4, 10, 17, 17], 'Y': [17, 17, 10, 4, 4, 4, 4],
    'J': [1, 1, 1, 1, 1, 17, 14], '=': [0, 0, 31, 0, 31, 0, 0],
    'P': [30, 17, 17, 30, 16, 16, 16], 'F': [31, 16, 16, 30, 16, 16, 16], 'V': [17, 17, 17, 17, 10, 10, 4],
}


class Lienzo:
    def __init__(self, ancho, alto, fondo):
        self.ancho, self.alto = ancho, alto
        self.px = bytearray(bytes(fondo) * ancho * alto)

    def punto(self, x, y, color):
        if 0 <= x < self.ancho and 0 <= y < self.alto:
            i = (y * self.ancho + x) * 3
            self.px[i:i + 3] = bytes(color)

    def rect(self, x0, y0, x1, y1, color):
        fila = bytes(color) * (x1 - x0)
        for y in range(max(y0, 0), min(y1, self.alto)):
            i = (y * self.ancho + max(x0, 0)) * 3
            self.px[i:i + len(fila)] = fila

    def linea(self, x0, y0, x1, y1, color, grosor=1, raya=0):
        dx, dy = abs(x1 - x0), -abs(y1 - y0)
        sx, sy = (1 if x0 < x1 else -1), (1 if y0 < y1 else -1)
        err, n = dx + dy, 0
        while True:
            if not raya or (n // raya) % 2 == 0:
                for a in range(-(grosor // 2), grosor - grosor // 2):
                    for b in range(-(grosor // 2), grosor - grosor // 2):
                        self.punto(x0 + a, y0 + b, color)
            if x0 == x1 and y0 == y1:
                break
            e2 = 2 * err
            if e2 >= dy:
                err, x0 = err + dy, x0 + sx
            if e2 <= dx:
                err, y0 = err + dx, y0 + sy
            n += 1

    def texto(self, x, y, cadena, color=NEGRO, escala=2, derecha=False):
        ancho = len(cadena) * 6 * escala
        if derecha:
            x -= ancho
        for k, car in enumerate(cadena.upper()):
            glifo = FUENTE.get(car, FUENTE[' '])
            for fila, bits in enumerate(glifo):
                for col in range(5):
                    if bits & (1 << (4 - col)):
                        self.rect(x + (k * 6 + col) * escala, y + fila * escala,
                                  x + (k * 6 + col + 1) * escala, y + (fila + 1) * escala, color)

    def png(self):
        crudo = b''.join(b'\x00' + bytes(self.px[y * self.ancho * 3:(y + 1) * self.ancho * 3]) for y in range(self.alto))

        def trozo(tipo, datos):
            return struct.pack('>I', len(datos)) + tipo + datos + struct.pack('>I', zlib.crc32(tipo + datos) & 0xFFFFFFFF)

        return (b'\x89PNG\r\n\x1a\n' + trozo(b'IHDR', struct.pack('>IIBBBBB', self.ancho, self.alto, 8, 2, 0, 0, 0))
                + trozo(b'IDAT', zlib.compress(crudo, 6)) + trozo(b'IEND', b''))


def leer(ruta):
    filas = []
    try:
        with open(ruta) as f:
            for linea in f:
                p = linea.split('\t')
                if len(p) >= 6:
                    try:
                        filas.append((int(p[0]), float(p[1]), float(p[2]), float(p[3]), float(p[4]), float(p[5])))
                    except ValueError:
                        pass
    except OSError:
        pass
    corte = time.time() - 24 * 3600
    return [f for f in filas if f[0] >= corte]


def panel(lienzo, y0, alto, titulo, serie, tiempos, maximo, unidad, umbrales, formato):
    x0, x1 = 80, ANCHO - 30
    lienzo.rect(x0, y0, x1, y0 + alto, (250, 250, 250))
    for k in range(5):
        y = y0 + alto - k * alto // 4
        lienzo.linea(x0, y, x1, y, GRIS)
        lienzo.texto(x0 - 8, y - 7, formato(maximo * k / 4), GRIS_OSC, 2, derecha=True)
    t0, t1 = tiempos[0], tiempos[-1] if tiempos[-1] > tiempos[0] else tiempos[0] + 1

    def xy(t, v):
        return x0 + int((t - t0) / (t1 - t0) * (x1 - x0)), y0 + alto - int(min(v, maximo) / maximo * alto)

    for valor, color in umbrales:
        y = y0 + alto - int(min(valor, maximo) / maximo * alto)
        lienzo.linea(x0, y, x1, y, color, 1, 6)
    puntos = [xy(t, v) for t, v in zip(tiempos, serie)]
    for a, b in zip(puntos, puntos[1:]):
        lienzo.linea(a[0], a[1], b[0], b[1], AZUL, 2)
    ultimo = serie[-1]
    lienzo.texto(x0, y0 - 22, f'{titulo}: {formato(ultimo)} {unidad}', NEGRO, 2)
    for k in (0, 1, 2):
        t = t0 + (t1 - t0) * k / 2
        etiqueta = time.strftime('%H:%M', time.localtime(t))
        px = x0 + int(k * (x1 - x0) / 2)
        lienzo.texto(px - (30 if k == 1 else 0) - (60 if k == 2 else 0), y0 + alto + 6, etiqueta, GRIS_OSC, 2)


def main():
    ruta, salida, total_gb, nucleos = sys.argv[1], sys.argv[2], float(sys.argv[3]), int(sys.argv[4])
    filas = leer(ruta)
    lienzo = Lienzo(ANCHO, ALTO, BLANCO)
    lienzo.texto(24, 14, 'ATLAS TEST - ULTIMAS 24 H', NEGRO, 3)
    if len(filas) < 2:
        lienzo.texto(24, 90, 'SIN DATOS TODAVIA', ROJO, 3)
    else:
        t = [f[0] for f in filas]
        gb = lambda v: f'{v:.1f}'
        panel(lienzo, 80, 140, 'RAM LIBRE', [f[1] / 1024 for f in filas], t, total_gb, 'GB (ROJO = 2 GB)', [(2.0, ROJO)], gb)
        panel(lienzo, 280, 140, 'DISCO', [f[4] for f in filas], t, 100, '% (85 Y 90)', [(85, AMBAR), (90, ROJO)], lambda v: f'{v:.0f}')
        tope = max(nucleos * 4, max(f[3] for f in filas) * 1.1)
        panel(lienzo, 480, 120, 'CARGA', [f[3] for f in filas], t, tope, f'({nucleos} NUCLEOS, ROJO = 3 X)', [(nucleos * 3, ROJO)], lambda v: f'{v:.0f}')
    with open(salida, 'wb') as f:
        f.write(lienzo.png())


if __name__ == '__main__':
    main()
