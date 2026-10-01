import { describe, expect, it } from '@jest/globals';
import { federationCredentialWarnings } from '../../../src/config/env-federation-warnings.js';

describe('federationCredentialWarnings', () => {
  it('avisa del ERP cuando tiene dirección pero no credencial, nombrando las dos variables', () => {
    const [warning, ...rest] = federationCredentialWarnings({ ERP_BACKEND_BASE_URL: 'http://erp:3007' });
    expect(rest).toEqual([]);
    expect(warning).toContain('ERP_BACKEND_CATALOG_API_KEY');
    expect(warning).toContain('PLATFORM_CATALOG_API_KEY');
  });

  it('una credencial en blanco cuenta como ausente: Coolify deja las variables vacías', () => {
    expect(federationCredentialWarnings({ ERP_BACKEND_BASE_URL: 'http://erp:3007', ERP_BACKEND_CATALOG_API_KEY: '   ' })).toHaveLength(1);
  });

  it('avisa también de Tableros', () => {
    const [warning] = federationCredentialWarnings({ DASHBOARDS_BASE_URL: 'http://dash:3009' });
    expect(warning).toContain('DASHBOARDS_CATALOG_API_KEY');
  });

  it('no avisa si el bloque no está configurado (vacío = no configurado, que es honesto) ni si tiene credencial', () => {
    expect(federationCredentialWarnings({})).toEqual([]);
    expect(federationCredentialWarnings({ ERP_BACKEND_BASE_URL: 'http://erp:3007', ERP_BACKEND_CATALOG_API_KEY: 'k'.repeat(32) })).toEqual(
      [],
    );
  });
});
