import { describe, expect, it } from '@jest/globals';
import { containsLikePattern } from '../../../../src/common/utils/strings/like-pattern.util.js';
import { isClosedIssueStatus, normalizeIssueStatus, pendingIssueSql } from '../../../../src/common/utils/data-quality-issue-status.util.js';

describe('containsLikePattern', () => {
  it('envuelve en % y escapa los comodines del usuario (y la barra)', () => {
    expect(containsLikePattern('dq_rule')).toBe('%dq\\_rule%');
    expect(containsLikePattern('50%')).toBe('%50\\%%');
    expect(containsLikePattern('a\\b')).toBe('%a\\\\b%');
    expect(containsLikePattern('')).toBe('%%');
  });
});

describe('estado de una incidencia de calidad', () => {
  it('sin estado es «open» y la comparación no distingue mayúsculas', () => {
    expect(normalizeIssueStatus(null)).toBe('open');
    expect(normalizeIssueStatus('  ')).toBe('open');
    expect(normalizeIssueStatus('ACKNOWLEDGED')).toBe('acknowledged');
  });

  it('cerradas: resolved, ignored y closed; reconocida y abierta siguen pendientes', () => {
    expect(['resolved', 'IGNORED', 'closed'].every(isClosedIssueStatus)).toBe(true);
    expect(isClosedIssueStatus('acknowledged')).toBe(false);
    expect(isClosedIssueStatus('open')).toBe(false);
    expect(isClosedIssueStatus(null)).toBe(false);
  });

  it('el predicado SQL de pendiente excluye sólo los estados cerrados', () => {
    expect(pendingIssueSql('i')).toBe("LOWER(COALESCE(i.issue_status, 'open')) NOT IN ('resolved','ignored','closed')");
  });
});
