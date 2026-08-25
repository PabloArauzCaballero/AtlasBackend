/**
 * @file Módulo NestJS: declara el límite de inyección y sus dependencias.
 * @business Esta pieza pone la voz de la marca en el momento en que alguien entra a la app.
 * @system declara el límite de inyección de la locución de bienvenida del móvil.
 */
import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module.js';
import { EngineAudioClient } from './engine-audio.client.js';
import { MobileWelcomeAudioController } from './mobile-welcome-audio.controller.js';
import { MobileWelcomeAudioService } from './mobile-welcome-audio.service.js';

/**
 * Módulo propio y no una ruta dentro de `customers`.
 *
 * Lo que hace no es leer un cliente: es hablar con el worker de locución de OTRO sistema, con su
 * credencial, su presupuesto y su modo de fallar. Metido dentro de `customers` habría arrastrado
 * esa integración —y su llave— a un módulo que hoy sólo toca la base de datos propia, y habría
 * dejado el coste de una síntesis de voz escondido detrás de algo que parece una consulta.
 *
 * Importa `CustomersModule` únicamente para leer el nombre de pila del perfil vigente.
 */
@Module({
  imports: [CustomersModule],
  controllers: [MobileWelcomeAudioController],
  providers: [EngineAudioClient, MobileWelcomeAudioService],
  exports: [MobileWelcomeAudioService],
})
export class MobileWelcomeAudioModule {}
