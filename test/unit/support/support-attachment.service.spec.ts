import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { SupportAttachmentService } from '../../../src/modules/support/application/support-attachment.service.js';
import type { SupportActor } from '../../../src/modules/support/application/support-actor.service.js';
import type { SupportChannelRepository } from '../../../src/modules/support/support-channel.repository.js';
import type { SupportMessageRepository } from '../../../src/modules/support/support-message.repository.js';
import type { DocumentStorageService } from '../../../src/common/storage/document-storage.service.js';

/**
 * El ticket de subida y la verificación del adjunto se atan al canal y al tenant: antes bastaba un
 * channelId cualquiera para pedir permiso de escritura, y la clave del cuerpo se creía sin mirar.
 */
const CLIENTE = { actorType: 'CUSTOMER', actorId: '5', isInternal: false } as unknown as SupportActor;
const SHA = 'a'.repeat(64);

describe('SupportAttachmentService', () => {
  let storage: { isConfigured: jest.Mock; createUploadTicket: jest.Mock; verifyDeclaredObject: jest.Mock };
  let channels: { requireById: jest.Mock; findLiveParticipant: jest.Mock };
  let service: SupportAttachmentService;

  beforeEach(() => {
    storage = {
      isConfigured: jest.fn(() => true),
      createUploadTicket: jest.fn(async () => ({ uploadUrl: 'u' })),
      verifyDeclaredObject: jest.fn(async () => ({ ok: true, metadata: { contentType: 'image/png', sha256Hex: SHA } })),
    };
    channels = {
      requireById: jest.fn(async () => ({ id: 'ch-1', status: 'OPEN' })),
      findLiveParticipant: jest.fn(async () => ({ id: 'p-1' })),
    };
    service = new SupportAttachmentService(
      storage as unknown as DocumentStorageService,
      {} as unknown as SupportMessageRepository,
      channels as unknown as SupportChannelRepository,
    );
  });

  describe('createTicket', () => {
    const entrada = { tenantId: 't1', actor: CLIENTE, channelId: 'ch-1', contentType: 'image/png', sizeBytes: 100 };

    it('quien no está dentro del canal no recibe ticket', async () => {
      channels.findLiveParticipant.mockResolvedValueOnce(null as never);

      const fallo = await service.createTicket(entrada).catch((error: unknown) => error);

      expect((fallo as ForbiddenException).getResponse()).toMatchObject({ code: 'SUPPORT_CHANNEL_NOT_PARTICIPANT' });
      expect(storage.createUploadTicket).not.toHaveBeenCalled();
    });

    it('un participante vivo recibe el ticket de la carpeta del canal', async () => {
      await service.createTicket(entrada);

      expect(channels.findLiveParticipant).toHaveBeenCalledWith('ch-1', 'CUSTOMER', '5');
      expect(storage.createUploadTicket).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1', subjectId: 'support-ch-1' }));
    });
  });

  describe('verify', () => {
    const adjunto = (over: Record<string, unknown> = {}) =>
      ({ storageObjectKey: 't1/support-ch-1/support-attachment/x.png', filename: 'x.png', declaredMime: 'image/png', sizeBytes: 100, sha256: SHA, ...over }) as never;
    const alcance = { tenantId: 't1', channelId: 'ch-1' };

    it('una clave de otro canal o de otro tenant se rechaza sin tocar el almacenamiento', async () => {
      for (const key of ['t1/support-ch-9/support-attachment/x.png', 't2/support-ch-1/support-attachment/x.png']) {
        const fallo = await service.verify(adjunto({ storageObjectKey: key }), alcance).catch((error: unknown) => error);
        expect((fallo as BadRequestException).getResponse()).toMatchObject({ code: 'SUPPORT_ATTACHMENT_KEY_NOT_ISSUED' });
      }
      expect(storage.verifyDeclaredObject).not.toHaveBeenCalled();
    });

    it('sin sha256 responde un 400 que lo dice, no un EVIDENCE_HASH_MISMATCH contra la cadena vacía', async () => {
      const fallo = await service.verify(adjunto({ sha256: undefined }), alcance).catch((error: unknown) => error);

      expect((fallo as BadRequestException).getResponse()).toMatchObject({ code: 'SUPPORT_ATTACHMENT_SHA256_REQUIRED' });
      expect(storage.verifyDeclaredObject).not.toHaveBeenCalled();
    });

    it('una clave emitida para el canal y con hash pasa la verificación', async () => {
      await expect(service.verify(adjunto(), alcance)).resolves.toMatchObject({ scanStatus: 'clean', sha256: SHA });
      expect(storage.verifyDeclaredObject).toHaveBeenCalledWith(expect.objectContaining({ declaredSha256: SHA }));
    });
  });
});
