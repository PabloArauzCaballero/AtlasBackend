/**
 * @file La forma de cada documento que el sincronizador escribe en Mongo.
 * @business El registro es evidencia: su forma tiene que poder leerse sin el código delante.
 * @system tipos de los documentos remotos del sincronizador de logs.
 */

/**
 * Salen de `log-sync.service.ts` porque son la mitad declarativa de aquel archivo —cuatro variantes
 * de documento con quince campos cada una— y no cambian cuando cambia el ciclo de volcado. Juntas
 * dejaban el servicio por encima de las 300 líneas de `check:file-size`.
 */
export type RemoteLogDocument =
  | {
      type: 'startup';
      bootId: string;
      idArranque: string;
      capturedAt: Date;
      service: string;
      source: LogSource;
      fileSizeAtStartup: number;
      startOffset: number;
      intervalMs: number;
      maxChunkBytes: number;
      process: {
        pid: number;
        cwd: string;
        nodeEnv: string;
      };
    }
  | {
      type: 'append';
      bootId: string;
      idArranque: string;
      sequence: number;
      capturedAt: Date;
      service: string;
      source: LogSource;
      offsetFrom: number;
      offsetTo: number;
      bytes: number;
      chars: number;
      lineCount: number;
      content: string;
    }
  | {
      type: 'rotation';
      bootId: string;
      idArranque: string;
      capturedAt: Date;
      service: string;
      source: LogSource;
      previousOffset: number;
      fileSize: number;
    };

export type LogSource = {
  filePath: string;
  fileName: string;
};
