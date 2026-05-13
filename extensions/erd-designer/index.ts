import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'
import { Type } from 'typebox'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

type Column = { name: string; type: string; pk?: boolean; fk?: { table: string; column: string }; unique?: boolean; nullable?: boolean }
type Table = { name: string; columns: Column[] }
type Model = { tables: Table[] }

const Dialect = Type.Union([Type.Literal('postgres'), Type.Literal('mysql'), Type.Literal('sqlite')])
const Format = Type.Union([Type.Literal('mermaid'), Type.Literal('svg'), Type.Literal('png')])

function slug(input: string) {
  return input.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'schema-proposal'
}

function cleanIdent(input: string) {
  return input.trim().replace(/^['"`\[]|['"`\]]$/g, '')
}

function splitTopLevel(input: string) {
  const out: string[] = []
  let depth = 0, quote = '', buf = ''
  for (const ch of input) {
    if (quote) { buf += ch; if (ch === quote) quote = ''; continue }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; buf += ch; continue }
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) { out.push(buf.trim()); buf = ''; continue }
    buf += ch
  }
  if (buf.trim()) out.push(buf.trim())
  return out
}

function findCreateTables(sql: string) {
  const out: Array<{ name: string; body: string }> = []
  const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?([\w."`\[\]-]+)\s*\(/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(sql))) {
    let i = re.lastIndex, depth = 1, quote = '', body = ''
    for (; i < sql.length; i++) {
      const ch = sql[i]
      if (quote) { body += ch; if (ch === quote) quote = ''; continue }
      if (ch === '"' || ch === "'" || ch === '`') { quote = ch; body += ch; continue }
      if (ch === '(') depth++
      if (ch === ')') { depth--; if (depth === 0) break }
      body += ch
    }
    out.push({ name: match[1], body })
    re.lastIndex = i + 1
  }
  return out
}

function parseSql(sql: string): Model {
  const tables: Table[] = []
  for (const found of findCreateTables(sql)) {
    const tableName = cleanIdent(found.name.split('.').pop() || found.name)
    const table: Table = { name: tableName, columns: [] }
    const pendingPk = new Set<string>()
    const pendingUnique = new Set<string>()
    const pendingFk: Array<{ column: string; table: string; refColumn: string }> = []

    for (const part of splitTopLevel(found.body)) {
      const lower = part.toLowerCase()
      const pk = part.match(/primary\s+key\s*\(([^)]+)\)/i)
      const fk = part.match(/foreign\s+key\s*\(([^)]+)\)\s+references\s+([\w."`\[\]-]+)\s*\(([^)]+)\)/i)
      const uq = part.match(/unique\s*\(([^)]+)\)/i)
      if (pk) { splitTopLevel(pk[1]).map(cleanIdent).forEach(c => pendingPk.add(c)); continue }
      if (uq) { splitTopLevel(uq[1]).map(cleanIdent).forEach(c => pendingUnique.add(c)); continue }
      if (fk) { pendingFk.push({ column: cleanIdent(fk[1]), table: cleanIdent(fk[2].split('.').pop() || fk[2]), refColumn: cleanIdent(fk[3]) }); continue }
      if (/^(constraint|key|index|check)\b/i.test(lower)) continue

      const bits = part.trim().split(/\s+/)
      if (bits.length < 2) continue
      const name = cleanIdent(bits[0])
      const type = bits[1].replace(/,$/, '')
      const inlineFk = part.match(/references\s+([\w."`\[\]-]+)\s*(?:\(([^)]+)\))?/i)
      table.columns.push({
        name,
        type,
        pk: /primary\s+key/i.test(part),
        unique: /\bunique\b/i.test(part),
        nullable: !/not\s+null/i.test(part) && !/primary\s+key/i.test(part),
        fk: inlineFk ? { table: cleanIdent(inlineFk[1].split('.').pop() || inlineFk[1]), column: cleanIdent(inlineFk[2] || 'id') } : undefined,
      })
    }
    for (const col of table.columns) {
      if (pendingPk.has(col.name)) col.pk = true
      if (pendingUnique.has(col.name)) col.unique = true
      const fk = pendingFk.find(f => f.column === col.name)
      if (fk) col.fk = { table: fk.table, column: fk.refColumn }
    }
    tables.push(table)
  }
  return { tables }
}

function parseDbml(dbml: string): Model {
  const tables: Table[] = []
  const tableRe = /Table\s+([\w."`\[\]-]+)\s*\{([\s\S]*?)\}/gi
  let match: RegExpExecArray | null
  while ((match = tableRe.exec(dbml))) {
    const table: Table = { name: cleanIdent(match[1]), columns: [] }
    for (const raw of match[2].split('\n')) {
      const line = raw.trim()
      if (!line || line.startsWith('//')) continue
      const m = line.match(/^([\w."`\[\]-]+)\s+([^\s\[]+)(?:\s+\[(.+)\])?/) 
      if (!m) continue
      const settings = m[3] || ''
      const ref = settings.match(/ref:\s*>\s*([\w."`\[\]-]+)\.([\w."`\[\]-]+)/i)
      table.columns.push({ name: cleanIdent(m[1]), type: m[2], pk: /\bpk\b/i.test(settings), unique: /\bunique\b/i.test(settings), nullable: !/not\s+null/i.test(settings), fk: ref ? { table: cleanIdent(ref[1]), column: cleanIdent(ref[2]) } : undefined })
    }
    tables.push(table)
  }
  return { tables }
}

function toMermaid(model: Model) {
  const lines = ['erDiagram']
  for (const table of model.tables) {
    lines.push(`  ${table.name} {`)
    for (const col of table.columns) {
      const flags = [col.pk && 'PK', col.fk && 'FK', col.unique && 'UK'].filter(Boolean).join(',')
      lines.push(`    ${col.type.replace(/[^\w]/g, '_')} ${col.name}${flags ? ` ${flags}` : ''}`)
    }
    lines.push('  }', '')
  }
  const seen = new Set<string>()
  for (const table of model.tables) for (const col of table.columns) if (col.fk) {
    const key = `${col.fk.table}->${table.name}.${col.name}`
    if (!seen.has(key)) { seen.add(key); lines.push(`  ${col.fk.table} ||--o{ ${table.name} : "${col.name}"`) }
  }
  return lines.join('\n') + '\n'
}

function toSql(model: Model) {
  return model.tables.map(t => `CREATE TABLE ${t.name} (\n${t.columns.map(c => `  ${c.name} ${c.type}${c.pk ? ' PRIMARY KEY' : ''}${c.unique ? ' UNIQUE' : ''}${c.nullable === false ? ' NOT NULL' : ''}${c.fk ? ` REFERENCES ${c.fk.table}(${c.fk.column})` : ''}`).join(',\n')}\n);`).join('\n\n') + '\n'
}

function review(name: string, model: Model, warnings: string[]) {
  const rels = model.tables.flatMap(t => t.columns.filter(c => c.fk).map(c => `- ${c.fk!.table} 1:N ${t.name} via ${t.name}.${c.name}`))
  return `# ${name} schema proposal\n\n## Entities\n${model.tables.map(t => `- ${t.name} (${t.columns.length} columns)`).join('\n')}\n\n## Relationships\n${rels.length ? rels.join('\n') : '- None detected'}\n\n## Review warnings\n${warnings.length ? warnings.map(w => `- ${w}`).join('\n') : '- None'}\n\n## Open questions\n- Are relationship cardinalities correct?\n- Do nullable foreign keys match lifecycle rules?\n- Are unique constraints/indexes sufficient for expected queries?\n`
}

function inspect(model: Model) {
  const names = new Set(model.tables.map(t => t.name))
  const warnings: string[] = []
  for (const t of model.tables) {
    if (!t.columns.some(c => c.pk)) warnings.push(`${t.name}: no primary key detected`)
    for (const c of t.columns) {
      if (c.name.endsWith('_id') && !c.fk && c.name !== 'id') warnings.push(`${t.name}.${c.name}: looks like FK but no reference`)
      if (c.fk && !names.has(c.fk.table)) warnings.push(`${t.name}.${c.name}: references missing table ${c.fk.table}`)
      if (c.fk && c.nullable) warnings.push(`${t.name}.${c.name}: nullable foreign key; confirm optional lifecycle`)
    }
  }
  return warnings
}

async function renderMermaid(mmdPath: string, outPath: string) {
  await execFileAsync('npx', ['-y', '@mermaid-js/mermaid-cli', '-i', mmdPath, '-o', outPath, '-b', 'transparent'], { timeout: 120000 })
}

async function writeBundle(ctx: { cwd: string }, params: any, model: Model, sourceKind: 'sql' | 'dbml') {
  const name = slug(params.name)
  const outDir = resolve(ctx.cwd, params.outputDir || join('research/database-proposals', name))
  await mkdir(outDir, { recursive: true })
  const warnings = inspect(model)
  const mmd = toMermaid(model)
  const paths: Record<string, string> = { outputDir: outDir }
  if (sourceKind === 'sql') { paths.schemaSql = join(outDir, 'schema.sql'); await writeFile(paths.schemaSql, params.sql.trim() + '\n') }
  else { paths.schemaDbml = join(outDir, 'schema.dbml'); await writeFile(paths.schemaDbml, params.dbml.trim() + '\n'); paths.schemaSql = join(outDir, 'schema.sql'); await writeFile(paths.schemaSql, toSql(model)) }
  paths.erdMmd = join(outDir, 'erd.mmd'); await writeFile(paths.erdMmd, mmd)
  paths.reviewMd = join(outDir, 'review.md'); await writeFile(paths.reviewMd, review(params.name, model, warnings))
  paths.metadataJson = join(outDir, 'metadata.json'); await writeFile(paths.metadataJson, JSON.stringify({ name: params.name, dialect: params.dialect, sourceKind, tables: model.tables.length, warnings, generatedAt: new Date().toISOString() }, null, 2) + '\n')
  const format = params.format || 'mermaid'
  if (format === 'svg' || format === 'png') {
    const rendered = join(outDir, `erd.${format}`)
    try { await renderMermaid(paths.erdMmd, rendered); paths[`erd${format.toUpperCase()}`] = rendered }
    catch (e: any) { warnings.push(`render failed (${format}); kept erd.mmd: ${e.message || e}`) }
  }
  return { paths, warnings }
}

export default function erdDesigner(pi: ExtensionAPI) {
  pi.registerTool({
    name: 'generate_erd_from_sql', label: 'Generate ERD from SQL',
    description: 'Create a review bundle from CREATE TABLE SQL: schema.sql, erd.mmd, optional SVG/PNG, review.md.',
    promptSnippet: 'Use when proposing a database schema for user review. Prefer deterministic CREATE TABLE SQL with explicit PK/FK constraints.',
    parameters: Type.Object({ name: Type.String(), dialect: Dialect, sql: Type.String(), outputDir: Type.Optional(Type.String()), format: Type.Optional(Format) }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const model = parseSql(params.sql)
      if (!model.tables.length) return { content: [{ type: 'text', text: 'No CREATE TABLE statements detected.' }], details: {} }
      const result = await writeBundle(ctx, params, model, 'sql')
      return { content: [{ type: 'text', text: `ERD bundle written:\n${Object.values(result.paths).join('\n')}\nWarnings: ${result.warnings.length}` }], details: result }
    },
  })

  pi.registerTool({
    name: 'generate_erd_from_dbml', label: 'Generate ERD from DBML',
    description: 'Create a review bundle from DBML: schema.dbml, generated schema.sql, erd.mmd, optional SVG/PNG, review.md.',
    promptSnippet: 'Use DBML for agent-authored database design proposals; include refs for all relationships.',
    parameters: Type.Object({ name: Type.String(), dialect: Dialect, dbml: Type.String(), outputDir: Type.Optional(Type.String()), format: Type.Optional(Format) }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const model = parseDbml(params.dbml)
      if (!model.tables.length) return { content: [{ type: 'text', text: 'No DBML Table blocks detected.' }], details: {} }
      const result = await writeBundle(ctx, params, model, 'dbml')
      return { content: [{ type: 'text', text: `ERD bundle written:\n${Object.values(result.paths).join('\n')}\nWarnings: ${result.warnings.length}` }], details: result }
    },
  })

  pi.registerCommand('erd-proposal', {
    description: 'Show ERD proposal usage.',
    handler: async (_args, ctx) => ctx.ui.notify('Ask agent to call generate_erd_from_dbml or generate_erd_from_sql. Output: research/database-proposals/{name}/', 'info'),
  })
}
