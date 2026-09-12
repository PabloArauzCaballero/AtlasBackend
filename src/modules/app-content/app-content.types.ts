/**
 * @file Contratos Zod: valida entrada y define el tipo del caso de uso.
 * @business Esta pieza saca del código lo que el cliente lee en la app y lo pone donde se edita.
 * @system reexporta los tipos del catálogo de contenidos para quien no valida.
 */
export type { ListContentQueryDto, UpsertContentDto, ContentIdParamsDto } from './app-content.schemas.js';
export type ContentSurface = 'onboarding' | 'home' | 'faq' | 'help' | 'legal' | 'profile' | 'credit';
