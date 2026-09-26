/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza captura señales de comportamiento y dispositivo necesarias para prevención de fraude y mejora de conversión.
 * @system declara la transacción opcional que comparten los repositorios de telemetría.
 */
import type { Transaction } from 'sequelize';

/** Un lote de telemetría se escribe entero o no se escribe: todas las escrituras la comparten. */
export type RepositoryOptions = { transaction?: Transaction };
