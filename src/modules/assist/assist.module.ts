/**
 * @file Módulo NestJS: declara el límite de inyección y sus dependencias.
 * @business Esta pieza responde dudas de uso de la app sin hacer esperar a una persona del equipo.
 * @system declara el límite de inyección del asistente de IA del canal móvil.
 */
import { Module } from '@nestjs/common';
import { AiAssistClient } from './ai-assist.client.js';
import { AssistController } from './assist.controller.js';
import { AssistService } from './assist.service.js';

/**
 * Módulo propio y no una ruta dentro de `support`.
 *
 * Lo que hace no es abrir casos: es hablar con OTRO sistema (AtlasAIService), con su credencial,
 * su coste por llamada y su modo de fallar. Metido en `support` habría arrastrado esa integración
 * —y su clave— a un módulo que hoy sólo toca la base propia, y el día en que el asistente se
 * apague o se despegue, lo que hay que tocar estaría enredado con el chat humano, que es
 * exactamente el respaldo que debe seguir en pie.
 *
 * No importa nada: el cliente y el servicio leen su configuración de `env` y la identidad del
 * cliente llega resuelta por los guards.
 */
@Module({
  controllers: [AssistController],
  providers: [AiAssistClient, AssistService],
})
export class AssistModule {}
