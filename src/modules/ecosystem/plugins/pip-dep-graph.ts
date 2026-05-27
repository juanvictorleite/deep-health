export interface PythonPackageNode {
  version: string;
  directDependency: boolean;
  dependsOn: Array<{ name: string; constraint?: string }>;
  requiredBy: Array<{ name: string; constraint?: string }>;
  editable?: boolean;
}

export type PythonDependencyGraph = Map<string, PythonPackageNode>;

function normalizeName(name: string): string {
  return name.toLowerCase().trim();
}

function parseEditableName(line: string): string | undefined {
  // -e ./path  or  -e git+https://...#egg=name
  const eggMatch = line.match(/[#&]egg=([A-Za-z0-9_.-]+)/i);
  if (eggMatch) return normalizeName(eggMatch[1]!);
  // fall back to last path segment
  const pathMatch = line.match(/-e\s+(?:\.\/|\/)?([^@\s#]+)/);
  if (pathMatch) {
    const parts = pathMatch[1]!.replace(/\/$/, '').split('/');
    const last = parts[parts.length - 1];
    return last ? normalizeName(last) : undefined;
  }
  return undefined;
}

function parsePinLine(line: string): { name: string; version: string } | undefined {
  // Handles: name==version, name===version, name[extra]==version, markers after semicolon
  const stripped = line.split(';')[0]!.trim();
  const match = stripped.match(/^([A-Za-z0-9_.-]+(?:\[[^\]]*\])?)\s*===?\s*([^\s,]+)/);
  if (!match) return undefined;
  const rawName = match[1]!.replace(/\[.*\]/, '');
  return { name: normalizeName(rawName), version: match[2]!.trim() };
}

interface RawEntry {
  name: string;
  version: string;
  editable: boolean;
  viaSources: string[];
}

export function parseViaAnnotations(content: string): PythonDependencyGraph {
  const graph: PythonDependencyGraph = new Map();
  if (!content.trim()) return graph;

  const lines = content.split('\n');
  const entries: RawEntry[] = [];
  let current: RawEntry | null = null;
  let inVia = false;

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (!line.trim() || (line.trim().startsWith('#') && !line.trim().startsWith('#   ') && !line.trim().startsWith('# via'))) {
      // standalone comment (not a via block) or blank — end current block
      if (!line.trim().startsWith('# via') && !line.trim().startsWith('#   ')) {
        inVia = false;
      }
      continue;
    }

    const trimmed = line.trim();

    // Editable install
    if (trimmed.startsWith('-e ')) {
      if (current) entries.push(current);
      const name = parseEditableName(trimmed);
      current = { name: name ?? trimmed, version: '', editable: true, viaSources: [] };
      inVia = false;
      continue;
    }

    // Pinned package line (not indented, not starting with #)
    if (!line.startsWith(' ') && !line.startsWith('\t') && !trimmed.startsWith('#')) {
      if (current) entries.push(current);
      const pin = parsePinLine(trimmed);
      if (pin) {
        current = { name: pin.name, version: pin.version, editable: false, viaSources: [] };
        inVia = false;
      } else {
        current = null;
        inVia = false;
      }
      continue;
    }

    // Via block — indented comment lines
    if (trimmed === '# via') {
      inVia = true;
      continue;
    }

    if (trimmed.startsWith('# via ')) {
      inVia = false;
      if (current) {
        const source = trimmed.replace(/^#\s*via\s+/, '').trim();
        current.viaSources.push(source);
      }
      continue;
    }

    if (inVia && trimmed.startsWith('#   ')) {
      if (current) {
        const source = trimmed.replace(/^#\s+/, '').trim();
        current.viaSources.push(source);
      }
      continue;
    }
  }

  if (current) entries.push(current);

  // Build nodes
  for (const entry of entries) {
    const hasOnlyReqFile = entry.viaSources.length > 0 && entry.viaSources.every((s) => s.startsWith('-r '));
    const hasDirect = entry.viaSources.some((s) => s.startsWith('-r '));
    const isDirect = entry.viaSources.length === 0 || hasDirect;

    const node: PythonPackageNode = {
      version: entry.version,
      directDependency: isDirect || hasOnlyReqFile,
      dependsOn: [],
      requiredBy: [],
    };

    if (entry.editable) node.editable = true;

    graph.set(entry.name, node);
  }

  // Build bidirectional edges from via sources
  for (const entry of entries) {
    const node = graph.get(entry.name)!;
    for (const source of entry.viaSources) {
      if (source.startsWith('-r ')) continue;
      const parentName = normalizeName(source);
      node.requiredBy.push({ name: parentName });

      const parentNode = graph.get(parentName);
      if (parentNode) {
        const alreadyLinked = parentNode.dependsOn.some((d) => d.name === entry.name);
        if (!alreadyLinked) {
          parentNode.dependsOn.push({ name: entry.name });
        }
      }
    }
  }

  return graph;
}

export function hasViaAnnotations(content: string): boolean {
  return /^\s*#\s*via\b/m.test(content);
}
