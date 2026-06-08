import { parseViaAnnotations, hasViaAnnotations } from '@modules/ecosystem/plugins/pip-dep-graph';
import { describe, it, expect } from 'vitest';


const BASIC_PIP_TOOLS_OUTPUT = `
django==3.0.8
    # via
    #   -r requirements.in
    #   djangorestframework
    #   django-cors-headers
asgiref==3.2.10
    # via django
certifi==2024.2.2
    # via requests
requests==2.31.0
    # via
    #   -r requirements.in
`;

const EDITABLE_OUTPUT = `
requests==2.31.0
    # via
    #   -r requirements.in
-e ./mypackage
    # via -r requirements.in
`;

const MULTI_VIA_OUTPUT = `
sqlparse==0.4.4
    # via
    #   django
    #   django-debug-toolbar
    #   another-pkg
django==3.0.8
    # via -r requirements.in
django-debug-toolbar==4.0.0
    # via -r requirements.in
another-pkg==1.0.0
    # via -r requirements.in
`;

const INLINE_VIA_OUTPUT = `
certifi==2024.2.2
    # via requests
requests==2.31.0
    # via -r requirements.in
`;

describe('parseViaAnnotations — AC4: type shape', () => {
  it('returns a Map', () => {
    const result = parseViaAnnotations(BASIC_PIP_TOOLS_OUTPUT);
    expect(result).toBeInstanceOf(Map);
  });

  it('nodes have correct shape', () => {
    const result = parseViaAnnotations(BASIC_PIP_TOOLS_OUTPUT);
    const django = result.get('django');
    expect(django).toBeDefined();
    expect(typeof django!.version).toBe('string');
    expect(typeof django!.directDependency).toBe('boolean');
    expect(Array.isArray(django!.dependsOn)).toBe(true);
    expect(Array.isArray(django!.requiredBy)).toBe(true);
  });
});

describe('parseViaAnnotations — AC6: basic pip-tools output', () => {
  it('parses 3 packages from basic output', () => {
    const result = parseViaAnnotations(BASIC_PIP_TOOLS_OUTPUT);
    expect(result.has('django')).toBe(true);
    expect(result.has('asgiref')).toBe(true);
    expect(result.has('certifi')).toBe(true);
    expect(result.has('requests')).toBe(true);
  });

  it('captures correct versions', () => {
    const result = parseViaAnnotations(BASIC_PIP_TOOLS_OUTPUT);
    expect(result.get('django')!.version).toBe('3.0.8');
    expect(result.get('asgiref')!.version).toBe('3.2.10');
    expect(result.get('certifi')!.version).toBe('2024.2.2');
  });

  it('marks -r requirements.in as directDependency', () => {
    const result = parseViaAnnotations(BASIC_PIP_TOOLS_OUTPUT);
    expect(result.get('django')!.directDependency).toBe(true);
    expect(result.get('requests')!.directDependency).toBe(true);
  });

  it('marks transitive packages as not directDependency', () => {
    const result = parseViaAnnotations(BASIC_PIP_TOOLS_OUTPUT);
    expect(result.get('asgiref')!.directDependency).toBe(false);
    expect(result.get('certifi')!.directDependency).toBe(false);
  });

  it('builds requiredBy for asgiref (required by django)', () => {
    const result = parseViaAnnotations(BASIC_PIP_TOOLS_OUTPUT);
    const asgiref = result.get('asgiref')!;
    expect(asgiref.requiredBy.some((r) => r.name === 'django')).toBe(true);
  });

  it('builds dependsOn for django (depends on asgiref)', () => {
    const result = parseViaAnnotations(BASIC_PIP_TOOLS_OUTPUT);
    const django = result.get('django')!;
    expect(django.dependsOn.some((d) => d.name === 'asgiref')).toBe(true);
  });

  it('builds requiredBy for certifi (required by requests)', () => {
    const result = parseViaAnnotations(BASIC_PIP_TOOLS_OUTPUT);
    const certifi = result.get('certifi')!;
    expect(certifi.requiredBy.some((r) => r.name === 'requests')).toBe(true);
  });
});

describe('parseViaAnnotations — AC6: editable installs', () => {
  it('marks editable installs with editable: true', () => {
    const result = parseViaAnnotations(EDITABLE_OUTPUT);
    const pkg = result.get('mypackage');
    expect(pkg).toBeDefined();
    expect(pkg!.editable).toBe(true);
  });

  it('marks editable install as directDependency when via -r', () => {
    const result = parseViaAnnotations(EDITABLE_OUTPUT);
    const pkg = result.get('mypackage');
    expect(pkg!.directDependency).toBe(true);
  });

  it('normal packages are not marked editable', () => {
    const result = parseViaAnnotations(EDITABLE_OUTPUT);
    const requests = result.get('requests');
    expect(requests).toBeDefined();
    expect(requests!.editable).toBeUndefined();
  });
});

describe('parseViaAnnotations — AC6: multiple via sources', () => {
  it('sqlparse has 3 requiredBy entries', () => {
    const result = parseViaAnnotations(MULTI_VIA_OUTPUT);
    const sqlparse = result.get('sqlparse');
    expect(sqlparse).toBeDefined();
    expect(sqlparse!.requiredBy.length).toBe(3);
    expect(sqlparse!.requiredBy.map((r) => r.name)).toContain('django');
    expect(sqlparse!.requiredBy.map((r) => r.name)).toContain('django-debug-toolbar');
    expect(sqlparse!.requiredBy.map((r) => r.name)).toContain('another-pkg');
  });

  it('parents each get dependsOn entry for sqlparse', () => {
    const result = parseViaAnnotations(MULTI_VIA_OUTPUT);
    const django = result.get('django');
    const toolbar = result.get('django-debug-toolbar');
    const another = result.get('another-pkg');
    expect(django!.dependsOn.some((d) => d.name === 'sqlparse')).toBe(true);
    expect(toolbar!.dependsOn.some((d) => d.name === 'sqlparse')).toBe(true);
    expect(another!.dependsOn.some((d) => d.name === 'sqlparse')).toBe(true);
  });

  it('sqlparse is not a direct dependency', () => {
    const result = parseViaAnnotations(MULTI_VIA_OUTPUT);
    expect(result.get('sqlparse')!.directDependency).toBe(false);
  });
});

describe('parseViaAnnotations — AC6: inline via (single line format)', () => {
  it('parses inline via line correctly', () => {
    const result = parseViaAnnotations(INLINE_VIA_OUTPUT);
    expect(result.get('certifi')).toBeDefined();
    expect(result.get('requests')).toBeDefined();
  });

  it('certifi is required by requests', () => {
    const result = parseViaAnnotations(INLINE_VIA_OUTPUT);
    const certifi = result.get('certifi')!;
    expect(certifi.requiredBy.some((r) => r.name === 'requests')).toBe(true);
  });

  it('requests is a direct dependency', () => {
    const result = parseViaAnnotations(INLINE_VIA_OUTPUT);
    expect(result.get('requests')!.directDependency).toBe(true);
  });
});

describe('parseViaAnnotations — AC6: empty/invalid content', () => {
  it('returns empty graph for empty string', () => {
    const result = parseViaAnnotations('');
    expect(result.size).toBe(0);
  });

  it('returns empty graph for whitespace-only content', () => {
    const result = parseViaAnnotations('   \n  \n  ');
    expect(result.size).toBe(0);
  });

  it('returns empty graph for comment-only content', () => {
    const result = parseViaAnnotations('# This is a comment\n# Another comment\n');
    expect(result.size).toBe(0);
  });

  it('ignores lines that are not valid pin lines', () => {
    const result = parseViaAnnotations('not-a-package\nrequests>=2.0\n');
    // "requests>=2.0" is a constraint, not a pin — should not parse
    expect(result.size).toBe(0);
  });
});

describe('hasViaAnnotations', () => {
  it('returns true when content has # via annotation', () => {
    expect(hasViaAnnotations('requests==2.0\n    # via django\n')).toBe(true);
  });

  it('returns true for multi-line via block', () => {
    expect(hasViaAnnotations('requests==2.0\n    # via\n    #   django\n')).toBe(true);
  });

  it('returns false for content with no via annotations', () => {
    expect(hasViaAnnotations('requests==2.0\n# just a comment\n')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(hasViaAnnotations('')).toBe(false);
  });
});
