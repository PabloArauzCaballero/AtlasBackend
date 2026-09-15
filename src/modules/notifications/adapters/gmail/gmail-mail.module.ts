/**
 * @file Módulo NestJS: declara el límite de inyección y sus dependencias.
 * @business Esta pieza entrega comunicaciones transaccionales indispensables para verificación y recuperación de acceso.
 * @system aísla el adaptador de Gmail y su configuración para que un módulo ajeno a notificaciones pueda enviar correo.
 */
import { Module } from '@nestjs/common';
import { NotificationProviderConfigService } from '../notification-provider-config.service.js';
import { GmailOAuthTokenService } from './gmail-oauth-token.service.js';
import { GmailApiAdapter } from './gmail.adapter.js';

/**
 * El adaptador de Gmail, aislado de `NotificationsModule`.
 *
 * Existe por un ciclo real, no por gusto: el segundo factor de login vive en `AuthModule`, y para
 * enviar el PIN por Gmail necesitaba el adaptador. Pero `NotificationsModule` importa
 * `InternalUsersModule`, que importa `AuthModule` — así que `AuthModule → NotificationsModule`
 * cerraba el círculo y Nest sólo lo habría tolerado a base de `forwardRef`, que convierte un
 * problema de diseño en un problema de orden de arranque.
 *
 * Los tres proveedores que se mueven aquí no dependen de nada del dominio de notificaciones (leen el
 * entorno y hacen HTTP con el ejecutor resiliente, que es `@Global()`), así que sacarlos no parte
 * nada. Se declaran en UN solo módulo a propósito: `GmailOAuthTokenService` cachea el access token
 * del canje OAuth, y dos instancias significarían dos cachés y el doble de canjes contra Google.
 */
@Module({
  providers: [NotificationProviderConfigService, GmailOAuthTokenService, GmailApiAdapter],
  exports: [NotificationProviderConfigService, GmailOAuthTokenService, GmailApiAdapter],
})
export class GmailMailModule {}
