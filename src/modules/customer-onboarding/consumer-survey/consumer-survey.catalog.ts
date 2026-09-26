/**
 * @file Reexporta el catálogo de la encuesta de hábitos, que vive en `customers`.
 * @business La fase 4 del alta pregunta hábitos de consumo declarados.
 * @system el catálogo es de `customers` porque la elegibilidad lo necesita y no puede depender de este módulo.
 */
export * from '../../customers/consumer-survey.catalog.js';
