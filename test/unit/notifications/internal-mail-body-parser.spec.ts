import { describe, expect, it } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { internalMailBodyParser, internalMailRoutes } from '../../../src/modules/notifications/internal-mail-body-parser.js';

describe('internalMailBodyParser', () => {
  function buildApp() {
    const app = express();
    app.use(internalMailRoutes('api/v1'), internalMailBodyParser(() => undefined));
    app.use(express.json({ limit: '2mb' }));
    app.post('*path', (req, res) => {
      res.json({ ok: true, size: JSON.stringify(req.body).length });
    });
    return app;
  }
  const big = { contentBase64: 'A'.repeat(3 * 1024 * 1024) };

  it('acepta un cuerpo de 3 MB en las rutas de correo interno', async () => {
    const app = buildApp();
    await request(app).post('/api/v1/internal/integration/erp/mail').send(big).expect(200);
    await request(app).post('/api/v1/operations/notifications/internal-mail').send(big).expect(200);
  });

  it('el resto de rutas conserva el límite global', async () => {
    await request(buildApp()).post('/api/v1/customers').send(big).expect(413);
  });
});
